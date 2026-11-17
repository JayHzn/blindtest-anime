import {
  MODE_TIMINGS,
  type AnswerPayload,
  type GameEnd,
  type GamePhase,
  type GameSettings,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
  type ServerToClientEvents,
  type StartGameError,
} from '@blindtest/shared';
import { AudioPlayer } from '../lib/audioPlayer';
import { VideoPreloader } from '../lib/videoPreloader';
import { serverNow, syncClock } from '../lib/clock';
import { recordGame, settingsKey } from '../lib/history';
import { sfx } from '../lib/sfx';
import { ensureConnected, socket } from '../lib/socket';

export type AnswerFeedback =
  | { status: 'idle' | 'pending'; wrongCount: number }
  | { status: 'wrong'; wrongCount: number }
  | {
      status: 'correct';
      wrongCount: number;
      points: number;
      seasonExact: boolean;
      sequenceExact: boolean;
    };

export interface SessionState {
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
  private disposed = false;

  constructor(
    settings: GameSettings,
    private readonly pseudo: string,
  ) {
    this.state = {
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
      end: null,
      previousBest: null,
    };
    this.handlers = {
      'round:prepare': (audio) => this.onPrepare(audio),
      'round:countdown': ({ round, phaseEndsAt }) => this.onCountdown(round, phaseEndsAt),
      'round:start': ({ round, startedAt, phaseEndsAt, videoUrl }) =>
        this.onStart(round, startedAt, phaseEndsAt, videoUrl),
      'player:found': ({ players }) => this.update({ players }),
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

    for (const [event, handler] of Object.entries(this.handlers)) {
      socket.on(event as keyof ServerToClientEvents, handler as never);
    }
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

  async submitAnswer(payload: AnswerPayload): Promise<void> {
    if (this.state.phase !== 'listening' || this.state.answer.status === 'correct') return;
    const round = this.state.round;
    const wrongCount = this.state.answer.wrongCount;
    this.update({ answer: { status: 'pending', wrongCount } });

    const result = await socket
      .timeout(5000)
      .emitWithAck('game:answer', payload)
      .catch(() => null);
    if (this.disposed || this.state.round !== round) return;

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
      this.update({ answer: { status: 'wrong', wrongCount: wrongCount + 1 } });
    } else {
      this.update({ answer: { status: 'idle', wrongCount } });
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
    if (this.state.status === 'playing') socket.emit('game:leave');
    this.detach();
    this.audio.stopAll();
    this.video.release();
  }

  // ─── Événements du serveur ────────────────────────────────────────────────

  private onPrepare({ round, url, startRatio }: RoundAudio): void {
    void this.audio.prepare(round, url, startRatio).then((ok) => {
      if (this.disposed) return;
      socket.emit(ok ? 'audio:ready' : 'audio:failed', { round, url });
    });
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
    this.audio.play(round, startedAt);
    // La vidéo se précharge à l'endroit où l'extrait sera à la fin de l'écoute.
    const listenS = MODE_TIMINGS[this.state.settings.mode].listenMs / 1000;
    const startTime = this.audio.startTime(round);
    this.video.preload(round, videoUrl, startTime === null ? 0 : startTime + listenS - 1);
    this.update({ phase: 'listening', round, phaseEndsAt });
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

  private update(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
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
