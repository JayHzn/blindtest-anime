import { randomUUID } from 'node:crypto';
import {
  BONUS_POINTS,
  MODE_TIMINGS,
  classicPoints,
  type AnswerPayload,
  type AnswerResult,
  type GameEndReason,
  type GamePhase,
  type GameSettings,
  type GameSnapshot,
  type ModeTiming,
  type PlayerRoundResult,
  type PlayerScore,
  type RoundAudio,
  type RoundReveal,
  type ServerToClientEvents,
} from '@blindtest/shared';
import { audioPath, videoPath, type MediaRegistry } from '../media/MediaRegistry';
import type { Catalogue } from '../catalogue/Catalogue';
import type { ThemeRow } from '../catalogue/types';

type Events = ServerToClientEvents;

/** Diffusion des événements d'une partie (Socket.IO en production, espion en test). */
export interface GameEmitter {
  toPlayer<E extends keyof Events>(
    playerId: string,
    event: E,
    ...args: Parameters<Events[E]>
  ): void;
  toAll<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void;
}

/** Attente maximale de l'audio des joueurs après le compte à rebours. */
export const AUDIO_WAIT_MS = 10_000;
/** Le point de départ est tiré entre 0 et 60 % du morceau (il reste toujours de quoi écouter). */
const START_RATIO_MAX = 0.6;

interface PlayerState {
  id: string;
  pseudo: string;
  score: number;
  connected: boolean;
  /** Manches dont l'audio est prêt chez ce joueur (index de manche → URL). */
  ready: Map<number, string>;
}

interface RoundState {
  theme: ThemeRow;
  /** Jeton opaque de l'audio. */
  token: string;
  /** Jeton opaque de la vidéo, créé au début de l'écoute. */
  videoToken: string | null;
  startRatio: number;
  listenStartedAt: number | null;
  results: Map<string, PlayerRoundResult>;
}

export interface GameOptions {
  id?: string;
  settings: GameSettings;
  catalogue: Catalogue;
  media: MediaRegistry;
  emitter: GameEmitter;
  /** Musiques tirées : les premières sont jouées, le reste sert de remplaçantes. */
  themes: ThemeRow[];
  random?: () => number;
  onFinished?: (game: Game) => void;
}

/**
 * Une partie, arbitrée entièrement par le serveur : tirage, chrono, validation
 * et score. Le solo est une partie à un joueur ; le multi réutilisera ce moteur.
 *
 * Déroulement d'une manche : compte à rebours → (attente de l'audio) → écoute → révélation.
 */
export class Game {
  readonly id: string;
  readonly settings: GameSettings;
  readonly timing: ModeTiming;
  private readonly catalogue: Catalogue;
  private readonly media: MediaRegistry;
  private readonly emitter: GameEmitter;
  private readonly random: () => number;
  private readonly onFinished?: (game: Game) => void;

  private readonly players = new Map<string, PlayerState>();
  private readonly rounds: RoundState[];
  private readonly spares: ThemeRow[];
  private phase: GamePhase = 'countdown';
  private roundIndex = 0;
  private phaseEndsAt = 0;
  private waitingForAudio = false;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private closed = false;

  constructor(options: GameOptions) {
    this.id = options.id ?? randomUUID();
    this.settings = options.settings;
    this.timing = MODE_TIMINGS[options.settings.mode];
    this.catalogue = options.catalogue;
    this.media = options.media;
    this.emitter = options.emitter;
    this.random = options.random ?? Math.random;
    this.onFinished = options.onFinished;

    const total = Math.min(options.settings.rounds, options.themes.length);
    this.rounds = options.themes.slice(0, total).map((theme) => this.createRound(theme));
    this.spares = options.themes.slice(total);
  }

  get totalRounds(): number {
    return this.rounds.length;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  addPlayer(id: string, pseudo: string): void {
    this.players.set(id, { id, pseudo, score: 0, connected: true, ready: new Map() });
  }

  /** Retire un joueur ; la partie se termine s'il n'en reste plus. */
  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    if (this.connectedPlayers().length === 0) {
      this.close();
      return;
    }
    if (this.phase === 'listening' && this.everyoneFound()) this.schedule(0, () => this.endRound());
    if (this.waitingForAudio && this.everyoneReady()) this.startListening();
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.emitPrepare(0);
    this.enterCountdown(0);
  }

  snapshot(forPlayer: string): GameSnapshot {
    return {
      gameId: this.id,
      you: forPlayer,
      settings: this.settings,
      phase: this.phase,
      round: this.roundIndex,
      totalRounds: this.totalRounds,
      phaseEndsAt: this.phaseEndsAt,
      players: this.scoreboard(),
    };
  }

  /** Le navigateur du joueur a préchargé l'audio de la manche. */
  audioReady(playerId: string, round: number, url: string): void {
    const player = this.players.get(playerId);
    const target = this.rounds[round];
    if (!player || !target || url !== audioPath(target.token)) return;
    player.ready.set(round, url);
    if (this.waitingForAudio && round === this.roundIndex && this.everyoneReady()) {
      this.startListening();
    }
  }

  /** L'audio n'a pas pu être chargé : on remplace la musique tant que la manche n'a pas commencé. */
  audioFailed(playerId: string, round: number, url: string): void {
    const target = this.rounds[round];
    if (!this.players.has(playerId) || !target || url !== audioPath(target.token)) return;
    const notStartedYet =
      round > this.roundIndex || (round === this.roundIndex && this.phase === 'countdown');
    if (!notStartedYet) return;

    const replacement = this.spares.shift();
    this.media.revoke(target.token);
    if (!replacement) {
      this.handleNoReplacement(round);
      return;
    }
    this.rounds[round] = this.createRound(replacement);
    for (const player of this.players.values()) player.ready.delete(round);
    this.emitPrepare(round);
  }

  answer(playerId: string, payload: AnswerPayload): AnswerResult {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return { accepted: false, reason: 'not_in_game' };
    const round = this.rounds[this.roundIndex]!;
    if (this.phase !== 'listening' || round.listenStartedAt === null) {
      return { accepted: false, reason: 'not_listening' };
    }
    if (round.results.get(playerId)?.correct) return { accepted: false, reason: 'already_found' };

    const elapsedMs = Math.max(0, Date.now() - round.listenStartedAt);
    const verdict = this.catalogue.validate(round.theme.id, payload);
    if (!verdict.correct) {
      return {
        accepted: true,
        correct: false,
        points: 0,
        seasonExact: false,
        sequenceExact: false,
      };
    }

    const points =
      classicPoints(elapsedMs, this.timing.listenMs) +
      (verdict.seasonExact ? BONUS_POINTS : 0) +
      (verdict.sequenceExact ? BONUS_POINTS : 0);
    player.score += points;
    round.results.set(playerId, {
      playerId,
      correct: true,
      points,
      elapsedMs,
      seasonExact: verdict.seasonExact,
      sequenceExact: verdict.sequenceExact,
    });

    this.emitter.toAll('player:found', { playerId, players: this.scoreboard() });
    // Tout le monde a trouvé : révélation tout de suite (après l'accusé de réception).
    if (this.everyoneFound()) this.schedule(0, () => this.endRound());

    return {
      accepted: true,
      correct: true,
      points,
      seasonExact: verdict.seasonExact,
      sequenceExact: verdict.sequenceExact,
    };
  }

  /** Arrête la partie sans prévenir les joueurs (plus personne, ou serveur qui s'arrête). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    for (const round of this.rounds) this.revokeRound(round);
    this.onFinished?.(this);
  }

  // ─── Déroulement ──────────────────────────────────────────────────────────

  private enterCountdown(index: number): void {
    this.roundIndex = index;
    this.phase = 'countdown';
    this.waitingForAudio = false;
    this.phaseEndsAt = Date.now() + this.timing.countdownMs;
    this.emitter.toAll('round:countdown', { round: index, phaseEndsAt: this.phaseEndsAt });
    this.schedule(this.timing.countdownMs, () => this.afterCountdown());
  }

  private afterCountdown(): void {
    if (this.everyoneReady()) {
      this.startListening();
      return;
    }
    // Quelqu'un charge encore l'audio : on l'attend un peu, puis on démarre quand même.
    this.waitingForAudio = true;
    this.schedule(AUDIO_WAIT_MS, () => this.startListening());
  }

  private startListening(): void {
    const round = this.rounds[this.roundIndex]!;
    this.waitingForAudio = false;
    this.phase = 'listening';
    round.listenStartedAt = Date.now();
    this.phaseEndsAt = round.listenStartedAt + this.timing.listenMs;
    // La vidéo de révélation se précharge pendant l'écoute, derrière une URL opaque.
    if (round.theme.videoUrl && !round.videoToken) {
      round.videoToken = this.media.register(round.theme.videoUrl, 'video');
    }
    this.emitter.toAll('round:start', {
      round: this.roundIndex,
      startedAt: round.listenStartedAt,
      phaseEndsAt: this.phaseEndsAt,
      videoUrl: round.videoToken ? videoPath(round.videoToken) : null,
    });
    // Préchargement de la manche suivante pendant l'écoute.
    if (this.roundIndex + 1 < this.totalRounds) this.emitPrepare(this.roundIndex + 1);
    this.schedule(this.timing.listenMs, () => this.endRound());
  }

  private endRound(): void {
    this.phase = 'reveal';
    this.phaseEndsAt = Date.now() + this.timing.revealMs;
    this.emitter.toAll('round:reveal', this.buildReveal());
    this.schedule(this.timing.revealMs, () => {
      if (this.roundIndex + 1 < this.totalRounds) this.enterCountdown(this.roundIndex + 1);
      else this.finish('completed');
    });
  }

  private finish(reason: GameEndReason): void {
    this.phase = 'finished';
    this.phaseEndsAt = Date.now();
    this.emitter.toAll('game:end', { reason, players: this.scoreboard() });
    this.close();
  }

  private handleNoReplacement(round: number): void {
    if (round === 0) {
      this.finish('audio_unavailable');
      return;
    }
    // Plus de musique de rechange : la partie s'arrête avant la manche injouable.
    for (const removed of this.rounds.splice(round)) this.revokeRound(removed);
    if (round === this.roundIndex) this.finish('completed');
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private createRound(theme: ThemeRow): RoundState {
    return {
      theme,
      token: this.media.register(theme.audioUrl),
      startRatio: Math.round(this.random() * START_RATIO_MAX * 1000) / 1000,
      videoToken: null,
      listenStartedAt: null,
      results: new Map(),
    };
  }

  private revokeRound(round: RoundState): void {
    this.media.revoke(round.token);
    if (round.videoToken) this.media.revoke(round.videoToken);
  }

  private emitPrepare(index: number): void {
    const round = this.rounds[index];
    if (!round) return;
    const audio: RoundAudio = {
      round: index,
      url: audioPath(round.token),
      startRatio: round.startRatio,
    };
    this.emitter.toAll('round:prepare', audio);
  }

  private buildReveal(): RoundReveal {
    const round = this.rounds[this.roundIndex]!;
    const { theme } = round;
    const anime = this.catalogue.getAnime(theme.animeId)!;
    const franchise = this.catalogue.getFranchise(anime.franchiseId)!;
    const results = [...this.players.values()].map(
      (player): PlayerRoundResult =>
        round.results.get(player.id) ?? {
          playerId: player.id,
          correct: false,
          points: 0,
          elapsedMs: null,
          seasonExact: false,
          sequenceExact: false,
        },
    );
    return {
      round: this.roundIndex,
      phaseEndsAt: this.phaseEndsAt,
      anime: {
        id: anime.id,
        title: {
          fr: this.catalogue.animeTitle(anime, 'fr'),
          en: this.catalogue.animeTitle(anime, 'en'),
        },
        romaji: anime.titleRomaji ?? anime.name,
        year: anime.year,
      },
      franchise: {
        id: franchise.id,
        title: {
          fr: this.catalogue.franchiseTitle(franchise, 'fr'),
          en: this.catalogue.franchiseTitle(franchise, 'en'),
        },
      },
      theme: {
        type: theme.type,
        sequence: theme.sequence,
        slug: theme.slug,
        song: theme.songTitle,
        artists: theme.artists,
      },
      results,
      players: this.scoreboard(),
    };
  }

  private scoreboard(): PlayerScore[] {
    const round = this.rounds[this.roundIndex];
    return [...this.players.values()]
      .map((player) => ({
        id: player.id,
        pseudo: player.pseudo,
        score: player.score,
        found: round?.results.get(player.id)?.correct ?? false,
        connected: player.connected,
      }))
      .sort((a, b) => b.score - a.score);
  }

  private connectedPlayers(): PlayerState[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  private everyoneReady(): boolean {
    const url = audioPath(this.rounds[this.roundIndex]!.token);
    return this.connectedPlayers().every((player) => player.ready.get(this.roundIndex) === url);
  }

  private everyoneFound(): boolean {
    const round = this.rounds[this.roundIndex]!;
    return this.connectedPlayers().every((player) => round.results.get(player.id)?.correct);
  }

  private schedule(delayMs: number, action: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed) action();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
