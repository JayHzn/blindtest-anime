import {
  INITIAL_PROGRESS,
  MODE_TIMINGS,
  PROGRESSIVE,
  type AnswerPayload,
  type GameEnd,
  type GamePhase,
  type GameSnapshot,
  type GameSettings,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
  type ServerToClientEvents,
  type StartGameError,
  type TierProgress,
} from '@blindtest/shared';
import { AudioPlayer } from '../lib/audioPlayer';
import { VideoPreloader } from '../lib/videoPreloader';
import { serverNow, syncClock } from '../lib/clock';
import { recordGame, settingsKey } from '../lib/history';
import { sfx, unlockSfx } from '../lib/sfx';
import { ensureConnected, socket } from '../lib/socket';

export type AnswerFeedback =
  | { status: 'idle' | 'pending'; wrongCount: number }
  | { status: 'wrong'; wrongCount: number }
  /** Mode Progressif : trois erreurs au dernier palier. */
  | { status: 'eliminated'; wrongCount: number }
  | {
      status: 'correct';
      wrongCount: number;
      points: number;
      seasonExact: boolean;
      sequenceExact: boolean;
    };

export interface SessionState {
  /** Partie solo, ou partie d'une room (écran d'intro au lancement). */
  kind: 'solo' | 'room';
  status: 'starting' | 'playing' | 'ended' | 'error';
  error: StartGameError | 'connection' | null;
  you: string;
  settings: GameSettings;
  totalRounds: number;
  phase: GamePhase | null;
  round: number;
  phaseEndsAt: number;
  players: PlayerScore[];
  reveal: RoundReveal | null;
  /** Révélations des manches terminées, dans l'ordre. */
  history: RoundReveal[];
  answer: AnswerFeedback;
  /** Mode Progressif : palier et essais restants du joueur pour la manche. */
  progress: TierProgress;
  /** Un extrait est en cours de lecture (mode Progressif). */
  snippetPlaying: boolean;
  /** Le navigateur a bloqué le son (pas de clic depuis le chargement de la page). */
  soundBlocked: boolean;
  end: GameEnd | null;
  /** Ancien record pour ces réglages (renseigné en fin de partie). */
  previousBest: number | null;
}

type Handlers = { [E in keyof ServerToClientEvents]?: ServerToClientEvents[E] };

/**
 * Une partie côté navigateur, indépendante de React : écoute les événements
 * du serveur, pilote l'audio et les effets sonores, et expose un état
 * immuable (lu avec `useSyncExternalStore`).
 */
export class GameSession {
  readonly audio = new AudioPlayer();
  readonly video = new VideoPreloader();
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly handlers: Handlers;
  private tickTimers: number[] = [];
  private snippetCount = 0;
  /** Arrivée en cours d'écoute : l'extrait sera lancé dès que l'audio sera prêt. */
  private pendingResume: { round: number; startedAt: number } | null = null;
  /** Début d'écoute de la manche en cours, pour relancer l'extrait au bon endroit. */
  private listenStart: { round: number; startedAt: number } | null = null;
  private disposed = false;

  constructor(
    settings: GameSettings,
    private readonly pseudo: string,
    /** `solo` : la session lance la partie ; `room` : la partie est lancée par l'hôte. */
    private readonly kind: 'solo' | 'room' = 'solo',
  ) {
    this.state = {
      kind,
      status: 'starting',
      error: null,
      you: '',
      settings,
      totalRounds: settings.rounds,
      phase: null,
      round: 0,
      phaseEndsAt: 0,
      players: [],
      reveal: null,
      history: [],
      answer: { status: 'idle', wrongCount: 0 },
      progress: INITIAL_PROGRESS,
      snippetPlaying: false,
      soundBlocked: false,
      end: null,
      previousBest: null,
    };
    this.audio.onBlocked = () => this.update({ soundBlocked: true });
    this.handlers = {
      'game:state': (snapshot) => this.onSnapshot(snapshot),
      'round:prepare': (audio) => this.onPrepare(audio),
      'round:countdown': ({ round, phaseEndsAt }) => this.onCountdown(round, phaseEndsAt),
      'round:start': ({ round, startedAt, phaseEndsAt, videoUrl }) =>
        this.onStart(round, startedAt, phaseEndsAt, videoUrl),
      'player:found': ({ players }) => this.update({ players }),
      'game:players': (players) => this.update({ players }),
      'round:reveal': (reveal) => this.onReveal(reveal),
      'game:end': (end) => this.onEnd(end),
    };
  }

  // ─── Lecture de l'état (React) ────────────────────────────────────────────

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ─── Actions ──────────────────────────────────────────────────────────────

  /** Connexion, synchro d'horloge puis démarrage de la partie. Renvoie `false` en cas d'échec. */
  async start(): Promise<boolean> {
    try {
      await ensureConnected();
      await syncClock(socket);
    } catch {
      this.update({ status: 'error', error: 'connection' });
      return false;
    }
    if (this.disposed) return false;

    this.attachHandlers();
    const response = await socket
      .timeout(10_000)
      .emitWithAck('game:start', { pseudo: this.pseudo, settings: this.state.settings })
      .catch(() => null);

    if (!response || !response.ok) {
      this.update({ status: 'error', error: response?.error ?? 'connection' });
      this.detach();
      return false;
    }
    const { snapshot } = response;
    this.update({
      status: 'playing',
      you: snapshot.you,
      settings: snapshot.settings,
      totalRounds: snapshot.totalRounds,
      players: snapshot.players,
    });
    return true;
  }

  /**
   * Room : la partie vient d'être lancée par l'hôte. À appeler dès la réception
   * de `room:state` « en jeu », avant les événements de la partie.
   */
  attach(you: string): void {
    this.attachHandlers();
    this.update({ status: 'playing', you });
  }

  async submitAnswer(payload: AnswerPayload): Promise<void> {
    if (this.state.phase !== 'listening' || !this.canAnswer()) return;
    const round = this.state.round;
    const wrongCount = this.state.answer.wrongCount;
    this.update({ answer: { status: 'pending', wrongCount } });

    const result = await socket
      .timeout(5000)
      .emitWithAck('game:answer', payload)
      .catch(() => null);
    if (this.disposed || this.state.round !== round) return;

    const previousTier = this.state.progress.tier;
    if (result?.accepted && result.progress) this.update({ progress: result.progress });

    if (result?.accepted && result.correct) {
      sfx.correct();
      this.update({
        answer: {
          status: 'correct',
          wrongCount,
          points: result.points,
          seasonExact: result.seasonExact,
          sequenceExact: result.sequenceExact,
        },
      });
    } else if (result?.accepted) {
      sfx.wrong();
      const eliminated = result.progress?.eliminated ?? false;
      this.update({
        answer: { status: eliminated ? 'eliminated' : 'wrong', wrongCount: wrongCount + 1 },
      });
      // Trois erreurs : palier suivant joué automatiquement.
      if (result.progress && result.progress.tier > previousTier) void this.playTier();
    } else if (result?.reason === 'eliminated') {
      this.update({ answer: { status: 'eliminated', wrongCount } });
    } else {
      this.update({ answer: { status: 'idle', wrongCount } });
    }
  }

  /** Mode Progressif : réécouter l'extrait du palier en cours. */
  replay(): void {
    if (this.isProgressive && this.state.phase === 'listening' && this.canAnswer()) {
      void this.playTier();
    }
  }

  /** Mode Progressif : passer au palier suivant (extrait plus long, moins de points). */
  async nextTier(): Promise<void> {
    if (!this.isProgressive || this.state.phase !== 'listening' || !this.canAnswer()) return;
    const round = this.state.round;
    const before = this.state.progress.tier;
    const progress = await socket
      .timeout(5000)
      .emitWithAck('game:nextTier')
      .catch(() => null);
    if (this.disposed || this.state.round !== round || !progress) return;
    this.update({ progress });
    if (progress.tier > before) void this.playTier();
  }

  /** Clic sur « Activer le son » : le navigateur autorise désormais la lecture. */
  enableSound(): void {
    unlockSfx();
    this.update({ soundBlocked: false });
    if (this.state.phase !== 'listening' || !this.canAnswer()) return;
    if (this.isProgressive) void this.playTier();
    else if (this.listenStart?.round === this.state.round) {
      this.audio.play(this.state.round, this.listenStart.startedAt);
    }
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
    this.video.setVolume(volume);
  }

  /** Quitte la partie et libère tout (audio, écouteurs, minuteries). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.kind === 'solo' && this.state.status === 'playing') socket.emit('game:leave');
    this.detach();
    this.audio.stopAll();
    this.video.release();
  }

  // ─── Événements du serveur ────────────────────────────────────────────────

  private onPrepare({ round, url, startRatio }: RoundAudio): void {
    void this.audio.prepare(round, url, startRatio).then((ok) => {
      if (this.disposed) return;
      socket.emit(ok ? 'audio:ready' : 'audio:failed', { round, url });
      // Arrivée en cours d'écoute (Classique) : on rattrape l'extrait là où il en est.
      if (ok && this.pendingResume?.round === round && this.state.phase === 'listening') {
        this.listenStart = this.pendingResume;
        if (!this.isProgressive) this.audio.play(round, this.pendingResume.startedAt);
        this.pendingResume = null;
      }
    });
  }

  /** État complet de la partie (arrivée en cours de route, reconnexion). */
  private onSnapshot(snapshot: GameSnapshot): void {
    const found = snapshot.players.find((player) => player.id === snapshot.you)?.found ?? false;
    this.update({
      status: 'playing',
      you: snapshot.you,
      settings: snapshot.settings,
      totalRounds: snapshot.totalRounds,
      players: snapshot.players,
      phase: snapshot.phase,
      round: snapshot.round,
      phaseEndsAt: snapshot.phaseEndsAt,
      progress: snapshot.progress ?? INITIAL_PROGRESS,
      // Déjà trouvé avant la coupure : on n'affiche plus le champ de réponse.
      answer: found
        ? { status: 'correct', wrongCount: 0, points: 0, seasonExact: false, sequenceExact: false }
        : { status: 'idle', wrongCount: 0 },
    });
    if (snapshot.phase === 'listening' && snapshot.listenStartedAt !== null) {
      this.pendingResume = { round: snapshot.round, startedAt: snapshot.listenStartedAt };
      this.video.preload(snapshot.round, snapshot.videoUrl);
    }
  }

  private onCountdown(round: number, phaseEndsAt: number): void {
    this.audio.fadeOut(this.state.round);
    this.video.release();
    this.update({
      phase: 'countdown',
      round,
      phaseEndsAt,
      reveal: null,
      answer: { status: 'idle', wrongCount: 0 },
      progress: INITIAL_PROGRESS,
      snippetPlaying: false,
    });
    // Cloche « attention », puis un tic à chaque seconde restante.
    sfx.bell();
    this.clearTicks();
    const remaining = phaseEndsAt - serverNow();
    for (let second = Math.floor(remaining / 1000); second >= 1; second--) {
      const delay = remaining - second * 1000;
      if (delay > 300) this.tickTimers.push(window.setTimeout(() => sfx.tick(), delay));
    }
  }

  private onStart(
    round: number,
    startedAt: number,
    phaseEndsAt: number,
    videoUrl: string | null,
  ): void {
    this.clearTicks();
    this.update({ phase: 'listening', round, phaseEndsAt });
    const startTime = this.audio.startTime(round) ?? 0;
    if (this.isProgressive) {
      // Premier palier joué automatiquement ; la vidéo se précharge au début de l'extrait.
      void this.playTier();
      this.video.preload(round, videoUrl, startTime);
    } else {
      this.listenStart = { round, startedAt };
      this.audio.play(round, startedAt);
      // La vidéo se précharge à l'endroit où l'extrait sera à la fin de l'écoute.
      const listenS = MODE_TIMINGS.classic.listenMs / 1000;
      this.video.preload(round, videoUrl, startTime + listenS - 1);
    }
  }

  private onReveal(reveal: RoundReveal): void {
    this.update({
      phase: 'reveal',
      round: reveal.round,
      phaseEndsAt: reveal.phaseEndsAt,
      reveal,
      players: reveal.players,
      history: [...this.state.history, reveal],
    });
  }

  private onEnd(end: GameEnd): void {
    this.clearTicks();
    const { history, you, settings } = this.state;
    const score = end.players.find((player) => player.id === you)?.score ?? 0;
    const found = history.filter(
      (reveal) => reveal.results.find((result) => result.playerId === you)?.correct,
    ).length;
    // Une partie interrompue ne compte pas pour les records.
    const previousBest =
      end.reason === 'completed'
        ? recordGame({
            date: new Date().toISOString(),
            score,
            found,
            rounds: history.length,
            settingsKey: settingsKey(settings),
          })
        : null;
    this.update({ status: 'ended', phase: 'finished', end, players: end.players, previousBest });
    this.detach();
    // La vidéo de la dernière révélation s'arrête avec l'écran ; l'audio restant est coupé.
    this.audio.fadeOut(this.state.round, 1500);
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private get isProgressive(): boolean {
    return this.state.settings.mode === 'progressive';
  }

  /** Le joueur peut encore répondre (pas trouvé, pas éliminé). */
  private canAnswer(): boolean {
    return this.state.answer.status !== 'correct' && this.state.answer.status !== 'eliminated';
  }

  /** Joue l'extrait du palier en cours. */
  private async playTier(): Promise<void> {
    const round = this.state.round;
    const duration = PROGRESSIVE.tiersMs[this.state.progress.tier] ?? 0;
    const snippet = ++this.snippetCount;
    this.update({ snippetPlaying: true });
    await this.audio.playSnippet(round, duration);
    // Un extrait relancé entre-temps reste « en cours ».
    if (!this.disposed && snippet === this.snippetCount && this.state.round === round) {
      this.update({ snippetPlaying: false });
    }
  }

  private update(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private attachHandlers(): void {
    for (const [event, handler] of Object.entries(this.handlers)) {
      socket.on(event as keyof ServerToClientEvents, handler as never);
    }
  }

  private detach(): void {
    this.clearTicks();
    for (const [event, handler] of Object.entries(this.handlers)) {
      socket.off(event as keyof ServerToClientEvents, handler as never);
    }
  }

  private clearTicks(): void {
    for (const timer of this.tickTimers) window.clearTimeout(timer);
    this.tickTimers = [];
  }
}
