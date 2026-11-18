import {
  HIGHER_LOWER,
  INITIAL_PROGRESS,
  MODE_TIMINGS,
  PROGRESSIVE,
  type AnswerPayload,
  type AuctionView,
  type HigherLowerPick,
  type HigherLowerView,
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
  /** Mode Progressif : le joueur a abandonné au dernier palier. */
  | { status: 'gaveUp'; wrongCount: number }
  | {
      status: 'correct';
      wrongCount: number;
      points: number;
      seasonExact: boolean;
      sequenceExact: boolean;
    };

/** Mode Playlist : ce que le joueur sait de la manche en cours. */
export interface PlaylistState {
  /** Il a choisi cette chanson : il écoute sans répondre. */
  ownSong: boolean;
  /** Nombre anonyme de joueurs qui ont trouvé. */
  found: number;
  /** Son pari (`null` : personne, tirée au hasard ; `undefined` : pas encore parié). */
  guess: string | null | undefined;
  /** Tout le monde a trouvé : fin de la fenêtre pour deviner. */
  guessWindowEndsAt: number | null;
}

const NO_PLAYLIST: PlaylistState = {
  ownSong: false,
  found: 0,
  guess: undefined,
  guessWindowEndsAt: null,
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
  /** Un extrait est en cours de lecture (modes Progressif et Enchères). */
  snippetPlaying: boolean;
  /** Mode Playlist : rôle, compteur, pari. */
  playlist: PlaylistState;
  /** Mode Enchères : manche en cours (annonces, ordre de passage, extrait programmé). */
  auction: AuctionView | null;
  /** Mode Plus ou moins : tour en cours (référence, écart, choix envoyé). */
  higherLower: HigherLowerView | null;
  /** Mode Plus ou moins : extrait en cours de lecture (index de la chanson, fin en heure serveur). */
  clip: { index: number; endsAt: number } | null;
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
  /** Enchères : extrait déjà programmé (« manche:tour »), et sa minuterie. */
  private scheduledSnippet: string | null = null;
  private snippetTimer: number | null = null;
  /** Plus ou moins : extraits programmés du tour (A puis B, ou la nouvelle chanson). */
  private clipTimers: number[] = [];
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
      playlist: NO_PLAYLIST,
      auction: null,
      higherLower: null,
      clip: null,
      soundBlocked: false,
      end: null,
      previousBest: null,
    };
    this.audio.onBlocked = () => this.update({ soundBlocked: true });
    this.handlers = {
      'game:state': (snapshot) => this.onSnapshot(snapshot),
      'round:prepare': (audio) => this.onPrepare(audio),
      'round:countdown': ({ round, phaseEndsAt }) => this.onCountdown(round, phaseEndsAt),
      'round:start': ({ round, startedAt, phaseEndsAt, videoUrl, ownSong, higherLower }) => {
        if (higherLower) this.update({ higherLower });
        this.onStart(round, startedAt, phaseEndsAt, videoUrl, ownSong ?? false);
      },
      'player:found': ({ players }) => this.update({ players }),
      'playlist:found': ({ found }) => this.update({ playlist: { ...this.state.playlist, found } }),
      'playlist:guessWindow': ({ endsAt }) =>
        this.update({
          phaseEndsAt: endsAt,
          playlist: { ...this.state.playlist, guessWindowEndsAt: endsAt },
        }),
      'game:players': (players) => this.update({ players }),
      'auction:state': ({ round, view }) => this.onAuctionState(round, view),
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
    if (this.isAuction) return this.submitAuctionAnswer(payload);
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

  /** Enchères : annonce secrète (index de `AUCTION.bidsMs`), modifiable pendant l'annonce. */
  async bid(bid: number): Promise<void> {
    const { auction, round } = this.state;
    if (!auction || auction.step !== 'bidding') return;
    // Affichée tout de suite ; le serveur confirme avec le nouvel état.
    this.update({ auction: { ...auction, yourBid: bid } });
    const ok = await socket
      .timeout(5000)
      .emitWithAck('auction:bid', { bid })
      .catch(() => false);
    if (!ok && !this.disposed && this.state.round === round && this.state.auction) {
      this.update({ auction: { ...this.state.auction, yourBid: auction.yourBid } });
    }
  }

  /** Enchères : celui qui a la main réécoute son extrait (lui seul, 3 fois au plus). */
  async replayAuction(): Promise<void> {
    const { auction, round } = this.state;
    const snippet = auction?.snippet;
    if (!auction || !snippet || auction.step !== 'answering' || auction.replaysLeft <= 0) return;
    const left = await socket
      .timeout(5000)
      .emitWithAck('auction:replay')
      .catch(() => null);
    if (left === null || this.disposed || this.state.round !== round || !this.state.auction) return;
    this.update({ auction: { ...this.state.auction, replaysLeft: left } });
    void this.playSnippet(snippet.durationMs);
  }

  /**
   * Plus ou moins : choix définitif pour la nouvelle chanson (au tour 1 : `higher` =
   * B plus populaire que A). Affiché tout de suite, annulé si le serveur refuse.
   */
  async pickHigherLower(pick: HigherLowerPick): Promise<void> {
    const { higherLower, round, phase } = this.state;
    if (!higherLower || higherLower.yourPick || phase !== 'listening') return;
    this.update({ higherLower: { ...higherLower, yourPick: pick } });
    const ok = await socket
      .timeout(5000)
      .emitWithAck('higherLower:pick', { pick })
      .catch(() => false);
    if (!ok && !this.disposed && this.state.round === round && this.state.higherLower) {
      this.update({ higherLower: { ...this.state.higherLower, yourPick: null } });
    }
  }

  /** Plus ou moins : réécoute libre d'une chanson du tour (la référence ou la nouvelle). */
  replayClip(index: number): void {
    const { round, phase } = this.state;
    const allowed = round === 1 ? [0, 1] : [round - 1, round];
    if (phase !== 'listening' || !this.isHigherLower || !allowed.includes(index)) return;
    void this.playClip(index, 0);
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

  /** Mode Progressif : abandonner la manche au dernier palier (0 point). */
  async giveUp(): Promise<void> {
    if (!this.isProgressive || this.state.phase !== 'listening' || !this.canAnswer()) return;
    const round = this.state.round;
    const progress = await socket
      .timeout(5000)
      .emitWithAck('game:giveUp')
      .catch(() => null);
    if (this.disposed || this.state.round !== round || !progress?.eliminated) return;
    this.snippetCount++;
    this.audio.fadeOut(round, 300);
    this.update({
      progress,
      snippetPlaying: false,
      answer: { status: 'gaveUp', wrongCount: this.state.answer.wrongCount },
    });
  }

  /**
   * Playlist : « Devine qui l'a choisie », une fois la chanson trouvée.
   * Un seul pari ; `null` = personne (chanson tirée au hasard).
   */
  async guess(target: string | null): Promise<void> {
    const { phase, answer, playlist, round } = this.state;
    if (phase !== 'listening' || answer.status !== 'correct' || playlist.guess !== undefined)
      return;
    this.update({ playlist: { ...playlist, guess: target } });
    const ok = await socket
      .timeout(5000)
      .emitWithAck('game:guess', { target })
      .catch(() => false);
    if (!ok && !this.disposed && this.state.round === round && this.state.phase === 'listening') {
      this.update({ playlist: { ...this.state.playlist, guess: undefined } });
    }
  }

  /** Clic sur « Activer le son » : le navigateur autorise désormais la lecture. */
  enableSound(): void {
    unlockSfx();
    this.update({ soundBlocked: false });
    const listens = this.canAnswer() || this.state.playlist.ownSong;
    if (this.state.phase !== 'listening' || !listens) return;
    if (this.isProgressive) void this.playTier();
    else if (this.isHigherLower && this.listenStart?.round === this.state.round) {
      this.scheduleClips(this.state.round, this.listenStart.startedAt);
    } else if (this.listenStart?.round === this.state.round) {
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
    this.clearSnippetTimer();
    this.clearClipTimers();
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
        if (this.isHigherLower) this.scheduleClips(round, this.pendingResume.startedAt);
        else if (!this.isProgressive) this.audio.play(round, this.pendingResume.startedAt);
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
      playlist: snapshot.playlist ?? NO_PLAYLIST,
      // Déjà trouvé avant la coupure : on n'affiche plus le champ de réponse.
      answer: found
        ? { status: 'correct', wrongCount: 0, points: 0, seasonExact: false, sequenceExact: false }
        : { status: 'idle', wrongCount: 0 },
      auction: null,
      higherLower: snapshot.higherLower,
    });
    if (snapshot.auction) this.onAuctionState(snapshot.round, snapshot.auction);
    if (snapshot.phase === 'listening' && snapshot.listenStartedAt !== null) {
      this.pendingResume = { round: snapshot.round, startedAt: snapshot.listenStartedAt };
      this.video.preload(snapshot.round, snapshot.videoUrl);
    }
  }

  private onCountdown(round: number, phaseEndsAt: number): void {
    this.audio.fadeOut(this.state.round);
    if (this.state.clip) this.audio.fadeOut(this.state.clip.index);
    this.video.release();
    this.clearSnippetTimer();
    this.clearClipTimers();
    this.update({
      phase: 'countdown',
      round,
      phaseEndsAt,
      reveal: null,
      answer: { status: 'idle', wrongCount: 0 },
      progress: INITIAL_PROGRESS,
      snippetPlaying: false,
      playlist: NO_PLAYLIST,
      // Nouvelle manche : les coches « a trouvé » de la précédente disparaissent.
      players: this.state.players.map((player) => ({ ...player, found: false })),
      auction: null,
      higherLower: null,
      clip: null,
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
    ownSong: boolean,
  ): void {
    this.clearTicks();
    this.update({
      phase: 'listening',
      round,
      phaseEndsAt,
      playlist: { ...this.state.playlist, ownSong },
    });
    const startTime = this.audio.startTime(round) ?? 0;
    if (this.isHigherLower) {
      // Pas de vidéo : A puis B (tour 1), ou la nouvelle chanson, à l'heure du serveur.
      this.listenStart = { round, startedAt };
      this.scheduleClips(round, startedAt);
    } else if (this.isProgressive) {
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

  /**
   * Enchères : nouvel état de la manche. Chaque extrait est joué par tous les
   * navigateurs à l'heure serveur fixée (`snippet.startsAt`).
   */
  private onAuctionState(round: number, view: AuctionView): void {
    if (round !== this.state.round) return;
    const previous = this.state.auction;
    const phase =
      view.step === 'bidding' ? 'bidding' : view.step === 'answering' ? 'answering' : 'listening';
    this.update({
      auction: view,
      phase: view.step === 'done' ? this.state.phase : phase,
      phaseEndsAt: view.step === 'bidding' ? view.biddingEndsAt : (view.snippet?.answerEndsAt ?? 0),
    });

    // Vidéo de la révélation : préchargée dès l'annonce, au point de départ de l'extrait.
    if (!previous && this.video.get(round) === null) {
      this.video.preload(round, view.videoUrl, this.audio.startTime(round) ?? 0);
    }

    // Erreur ou bonne réponse de celui qui avait la main : effet sonore pour tous.
    for (const turn of view.order) {
      const before = previous?.order.find((entry) => entry.playerId === turn.playerId)?.status;
      if (before === turn.status || !previous || previous.order.length === 0) continue;
      if (turn.status === 'found') sfx.correct();
      else if (turn.status === 'wrong' || turn.status === 'silent') sfx.wrong();
    }

    const { snippet } = view;
    if (!snippet) return;
    const key = `${round}:${snippet.turn}`;
    if (key === this.scheduledSnippet) return;
    this.scheduledSnippet = key;
    this.clearSnippetTimer();
    const delay = snippet.startsAt - serverNow();
    // Arrivé après le début de l'extrait (reconnexion) : on ne le rattrape pas.
    if (delay < -100) return;
    this.snippetTimer = window.setTimeout(
      () => {
        this.snippetTimer = null;
        if (this.state.round === round) void this.playSnippet(snippet.durationMs);
      },
      Math.max(0, delay),
    );
  }

  /** Enchères : seul celui qui a la main répond, une seule fois. */
  private async submitAuctionAnswer(payload: AnswerPayload): Promise<void> {
    const { auction, round, you } = this.state;
    const holder = auction?.order[auction.turn];
    if (!auction || holder?.playerId !== you || holder.status !== 'playing') return;
    if (this.state.answer.status === 'pending') return;
    const wrongCount = this.state.answer.wrongCount;
    this.update({ answer: { status: 'pending', wrongCount } });
    const result = await socket
      .timeout(5000)
      .emitWithAck('game:answer', payload)
      .catch(() => null);
    if (this.disposed || this.state.round !== round) return;
    // Les effets sonores suivent l'état diffusé à tous (onAuctionState).
    if (result?.accepted && result.correct) {
      this.update({
        answer: {
          status: 'correct',
          wrongCount,
          points: result.points,
          seasonExact: false,
          sequenceExact: false,
        },
      });
    } else {
      this.update({
        answer: { status: result?.accepted ? 'wrong' : 'idle', wrongCount: wrongCount + 1 },
      });
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

  private get isAuction(): boolean {
    return this.state.settings.mode === 'auction';
  }

  private get isHigherLower(): boolean {
    return this.state.settings.mode === 'higherLower';
  }

  /**
   * Plus ou moins : programme les extraits du tour à partir de `startedAt` (heure
   * serveur) — A puis B au tour 1, sinon la nouvelle chanson. Un extrait déjà
   * commencé (arrivée en retard) reprend en cours de route.
   */
  private scheduleClips(round: number, startedAt: number): void {
    this.clearClipTimers();
    const clips = round === 1 ? [0, 1] : [round];
    clips.forEach((index, position) => {
      const delay = startedAt + position * HIGHER_LOWER.snippetMs - serverNow();
      const offsetMs = Math.max(0, -delay);
      if (offsetMs >= HIGHER_LOWER.snippetMs) return;
      this.clipTimers.push(
        window.setTimeout(
          () => {
            if (this.state.round === round && this.state.phase === 'listening') {
              void this.playClip(index, offsetMs);
            }
          },
          Math.max(0, delay),
        ),
      );
    });
  }

  /** Plus ou moins : joue l'extrait de 10 s d'une chanson (la référence reste chargée). */
  private async playClip(index: number, offsetMs: number): Promise<void> {
    const round = this.state.round;
    const snippet = ++this.snippetCount;
    this.update({
      snippetPlaying: true,
      clip: { index, endsAt: serverNow() + HIGHER_LOWER.snippetMs - offsetMs },
    });
    await this.audio.playSnippet(index, HIGHER_LOWER.snippetMs, {
      offsetMs,
      keepFrom: Math.max(0, round - 1),
    });
    if (!this.disposed && snippet === this.snippetCount && this.state.round === round) {
      this.update({ snippetPlaying: false, clip: null });
    }
  }

  private clearClipTimers(): void {
    for (const timer of this.clipTimers) window.clearTimeout(timer);
    this.clipTimers = [];
  }

  /** Le joueur peut encore répondre (pas trouvé, pas éliminé, pas abandonné, pas sa chanson). */
  private canAnswer(): boolean {
    const { status } = this.state.answer;
    if (this.state.playlist.ownSong) return false;
    return status !== 'correct' && status !== 'eliminated' && status !== 'gaveUp';
  }

  /** Joue l'extrait du palier en cours. */
  private playTier(): Promise<void> {
    return this.playSnippet(PROGRESSIVE.tiersMs[this.state.progress.tier] ?? 0);
  }

  /** Joue `duration` ms depuis le point de départ de l'extrait (Progressif, Enchères). */
  private async playSnippet(duration: number): Promise<void> {
    const round = this.state.round;
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

  private clearSnippetTimer(): void {
    if (this.snippetTimer !== null) window.clearTimeout(this.snippetTimer);
    this.snippetTimer = null;
  }

  private clearTicks(): void {
    for (const timer of this.tickTimers) window.clearTimeout(timer);
    this.tickTimers = [];
  }
}
