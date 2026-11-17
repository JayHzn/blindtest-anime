import { randomUUID } from 'node:crypto';
import {
  BONUS_POINTS,
  MODE_TIMINGS,
  INITIAL_PROGRESS,
  PROGRESSIVE,
  PROGRESSIVE_LAST_TIER,
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
  type TierProgress,
} from '@blindtest/shared';
import { audioPath, videoPath, type MediaRegistry } from '../media/MediaRegistry';
import type { Catalogue } from '../catalogue/Catalogue';
import type { ThemeRow } from '../catalogue/types';

type Events = ServerToClientEvents;

/**
 * Envoi d'événements à un joueur (Socket.IO en production, espion en test).
 * Les diffusions passent joueur par joueur : un joueur qui se reconnecte
 * (nouveau socket, même identifiant) continue de tout recevoir.
 */
export interface GameEmitter {
  toPlayer<E extends keyof Events>(
    playerId: string,
    event: E,
    ...args: Parameters<Events[E]>
  ): void;
}

/** Attente maximale de l'audio des joueurs après le compte à rebours. */
export const AUDIO_WAIT_MS = 10_000;
/** Délai avant d'arrêter une partie dont tous les joueurs sont déconnectés. */
export const ABANDON_GRACE_MS = 30_000;
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
  /** Début commun de l'écoute (pour les joueurs dont le son était prêt). */
  listenStartedAt: number | null;
  /** Joueurs présents au début de l'écoute : eux seuls jouent cette manche. */
  participants: Set<string>;
  /**
   * Début d'écoute de chaque joueur. Un retardataire (son pas encore chargé)
   * démarre dès que son son est prêt, avec son propre chrono, sans pénalité.
   */
  starts: Map<string, number>;
  results: Map<string, PlayerRoundResult>;
  /** Mode Progressif : palier et essais de chaque joueur. */
  progress: Map<string, TierProgress>;
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
  /** Durée du compte à rebours de la première manche (écran d'intro en room). */
  introMs?: number;
  /** Attente maximale des retardataires avant de démarrer l'écoute. */
  audioWaitMs?: number;
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
  private readonly introMs: number;
  private readonly audioWaitMs: number;

  private readonly players = new Map<string, PlayerState>();
  private readonly rounds: RoundState[];
  private readonly spares: ThemeRow[];
  private phase: GamePhase = 'countdown';
  private roundIndex = 0;
  private phaseEndsAt = 0;
  private waitingForAudio = false;
  private timer: NodeJS.Timeout | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;
  /** Manches dont l'audio a déjà été envoyé (pour les joueurs qui arrivent en cours de route). */
  private readonly preparedRounds = new Set<number>();
  private lastReveal: RoundReveal | null = null;
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
    this.introMs = options.introMs ?? this.timing.countdownMs;
    this.audioWaitMs = options.audioWaitMs ?? AUDIO_WAIT_MS;

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

  get playerIds(): string[] {
    return [...this.players.keys()];
  }

  /** Ajoute un joueur ; en cours de partie, il reçoit l'état et joue dès que possible. */
  addPlayer(id: string, pseudo: string): void {
    if (this.players.has(id)) {
      this.reconnect(id);
      return;
    }
    this.players.set(id, { id, pseudo, score: 0, connected: true, ready: new Map() });
    if (this.started) {
      this.syncPlayer(id);
      this.broadcastPlayers();
    }
  }

  /** Le joueur revient (nouveau socket) : on lui renvoie l'état complet. */
  reconnect(id: string): void {
    const player = this.players.get(id);
    if (!player || this.closed) return;
    player.connected = true;
    this.clearAbandonTimer();
    this.syncPlayer(id);
    this.broadcastPlayers();
  }

  /** Coupure réseau : le joueur garde sa place et son score ; la partie continue. */
  disconnect(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = false;
    this.afterPlayerLost(() => {
      // Plus personne : on laisse un délai pour revenir avant d'arrêter la partie.
      this.clearAbandonTimer();
      this.abandonTimer = setTimeout(() => this.close(), ABANDON_GRACE_MS);
    });
  }

  /** Le joueur quitte volontairement la partie. */
  leave(id: string): void {
    if (!this.players.delete(id)) return;
    this.afterPlayerLost(() => this.close());
  }

  private afterPlayerLost(whenEmpty: () => void): void {
    if (this.closed) return;
    if (this.connectedPlayers().length === 0) {
      whenEmpty();
      return;
    }
    this.broadcastPlayers();
    // Les joueurs restants n'attendent pas celui qui est parti.
    if (this.phase === 'listening' && this.everyoneDone()) this.schedule(0, () => this.endRound());
    if (this.waitingForAudio && this.everyoneReady()) this.startListening();
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    // Chacun reçoit l'état initial (joueurs, nombre de manches) avant la première manche.
    for (const id of this.players.keys())
      this.emitter.toPlayer(id, 'game:state', this.snapshot(id));
    // Les chansons 1 et 2 se chargent pendant le compte à rebours / l'écran d'intro.
    this.emitPrepare(0);
    this.emitPrepare(1);
    this.enterCountdown(0);
  }

  snapshot(forPlayer: string): GameSnapshot {
    const round = this.rounds[this.roundIndex];
    return {
      gameId: this.id,
      you: forPlayer,
      settings: this.settings,
      phase: this.phase,
      round: this.roundIndex,
      totalRounds: this.totalRounds,
      phaseEndsAt: this.phaseEndsAt,
      players: this.scoreboard(),
      // Début d'écoute propre au joueur (null s'il n'a pas encore démarré cette manche).
      listenStartedAt: round?.starts.get(forPlayer) ?? null,
      videoUrl: round?.videoToken ? videoPath(round.videoToken) : null,
      progress: this.isProgressive && round ? { ...this.progressOf(round, forPlayer) } : null,
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
      return;
    }
    // Retardataire : l'écoute a commencé sans lui ; il démarre maintenant, avec tout son temps.
    const current = this.rounds[this.roundIndex]!;
    if (
      this.phase === 'listening' &&
      round === this.roundIndex &&
      current.participants.has(playerId) &&
      !current.starts.has(playerId)
    ) {
      this.startPlayer(current, playerId, Date.now());
      const deadline = Date.now() + this.timing.listenMs;
      if (deadline > this.phaseEndsAt) {
        this.phaseEndsAt = deadline;
        this.schedule(this.timing.listenMs, () => this.endRound());
      }
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
    // Chaque joueur répond pendant SON temps d'écoute (les retardataires ont le leur).
    const startedAt = round.starts.get(playerId);
    if (
      this.phase !== 'listening' ||
      startedAt === undefined ||
      Date.now() > startedAt + this.timing.listenMs
    ) {
      return { accepted: false, reason: 'not_listening' };
    }
    if (round.results.get(playerId)?.correct) return { accepted: false, reason: 'already_found' };
    const progress = this.isProgressive ? this.progressOf(round, playerId) : null;
    if (progress?.eliminated) return { accepted: false, reason: 'eliminated' };

    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const verdict = this.catalogue.validate(round.theme.id, payload);

    if (!verdict.correct) {
      if (progress) this.registerMistake(progress);
      // Éliminé au dernier palier : la manche peut se terminer si tout le monde a fini.
      if (progress?.eliminated && this.everyoneDone()) this.schedule(0, () => this.endRound());
      return {
        accepted: true,
        correct: false,
        points: 0,
        seasonExact: false,
        sequenceExact: false,
        ...(progress && { progress: { ...progress } }),
      };
    }

    const basePoints = progress
      ? PROGRESSIVE.tierPoints[progress.tier]!
      : classicPoints(elapsedMs, this.timing.listenMs);
    const points =
      basePoints +
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
      tier: progress?.tier ?? null,
    });

    this.broadcast('player:found', { playerId, players: this.scoreboard() });
    // Tout le monde a fini : révélation tout de suite (après l'accusé de réception).
    if (this.everyoneDone()) this.schedule(0, () => this.endRound());

    return {
      accepted: true,
      correct: true,
      points,
      seasonExact: verdict.seasonExact,
      sequenceExact: verdict.sequenceExact,
      ...(progress && { progress: { ...progress } }),
    };
  }

  /** Mode Progressif : le joueur demande l'extrait suivant (plus long, moins de points). */
  nextTier(playerId: string): TierProgress | null {
    const round = this.rounds[this.roundIndex];
    if (!this.isProgressive || this.phase !== 'listening' || !round) return null;
    if (!this.players.get(playerId)?.connected || round.results.get(playerId)?.correct) return null;
    const progress = this.progressOf(round, playerId);
    if (!progress.eliminated && progress.tier < PROGRESSIVE_LAST_TIER) {
      progress.tier++;
      progress.attemptsLeft = PROGRESSIVE.attemptsPerTier;
    }
    return { ...progress };
  }

  private get isProgressive(): boolean {
    return this.settings.mode === 'progressive';
  }

  private progressOf(round: RoundState, playerId: string): TierProgress {
    let progress = round.progress.get(playerId);
    if (!progress) {
      progress = { ...INITIAL_PROGRESS };
      round.progress.set(playerId, progress);
    }
    return progress;
  }

  /** Trois erreurs sur un palier : palier suivant, ou élimination au dernier. */
  private registerMistake(progress: TierProgress): void {
    progress.attemptsLeft--;
    if (progress.attemptsLeft > 0) return;
    if (progress.tier < PROGRESSIVE_LAST_TIER) {
      progress.tier++;
      progress.attemptsLeft = PROGRESSIVE.attemptsPerTier;
    } else {
      progress.eliminated = true;
    }
  }

  /** Arrête la partie sans prévenir les joueurs (plus personne, ou serveur qui s'arrête). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.clearAbandonTimer();
    for (const round of this.rounds) this.revokeRound(round);
    this.onFinished?.(this);
  }

  // ─── Déroulement ──────────────────────────────────────────────────────────

  private enterCountdown(index: number): void {
    this.roundIndex = index;
    this.phase = 'countdown';
    this.waitingForAudio = false;
    // Première manche : écran d'intro (plus long en room) pendant que les chansons 1 et 2 chargent.
    const duration = index === 0 ? this.introMs : this.timing.countdownMs;
    this.phaseEndsAt = Date.now() + duration;
    this.broadcast('round:countdown', { round: index, phaseEndsAt: this.phaseEndsAt });
    this.schedule(duration, () => this.afterCountdown());
  }

  private afterCountdown(): void {
    if (this.everyoneReady()) {
      this.startListening();
      return;
    }
    // Quelqu'un charge encore l'audio : on l'attend un peu, puis on démarre quand même.
    this.waitingForAudio = true;
    this.schedule(this.audioWaitMs, () => this.startListening());
  }

  private startListening(): void {
    const round = this.rounds[this.roundIndex]!;
    const now = Date.now();
    this.waitingForAudio = false;
    this.phase = 'listening';
    round.listenStartedAt = now;
    this.phaseEndsAt = now + this.timing.listenMs;
    // La vidéo de révélation se précharge pendant l'écoute, derrière une URL opaque.
    if (round.theme.videoUrl && !round.videoToken) {
      round.videoToken = this.media.register(round.theme.videoUrl, 'video');
    }
    // Les joueurs dont le son est prêt démarrent ensemble ; les autres dès qu'il le sera.
    const url = audioPath(round.token);
    for (const player of this.connectedPlayers()) {
      round.participants.add(player.id);
      if (player.ready.get(this.roundIndex) === url) this.startPlayer(round, player.id, now);
    }
    // Préchargement de la manche suivante pendant l'écoute.
    if (!this.preparedRounds.has(this.roundIndex + 1)) this.emitPrepare(this.roundIndex + 1);
    this.schedule(this.timing.listenMs, () => this.endRound());
  }

  /** Lance l'écoute pour un joueur (début commun, ou plus tard pour un retardataire). */
  private startPlayer(round: RoundState, playerId: string, startedAt: number): void {
    round.starts.set(playerId, startedAt);
    this.emitter.toPlayer(playerId, 'round:start', {
      round: this.roundIndex,
      startedAt,
      phaseEndsAt: startedAt + this.timing.listenMs,
      videoUrl: round.videoToken ? videoPath(round.videoToken) : null,
    });
  }

  private endRound(): void {
    this.phase = 'reveal';
    this.phaseEndsAt = Date.now() + this.timing.revealMs;
    this.lastReveal = this.buildReveal();
    this.broadcast('round:reveal', this.lastReveal);
    this.schedule(this.timing.revealMs, () => {
      if (this.roundIndex + 1 < this.totalRounds) this.enterCountdown(this.roundIndex + 1);
      else this.finish('completed');
    });
  }

  private finish(reason: GameEndReason): void {
    this.phase = 'finished';
    this.phaseEndsAt = Date.now();
    this.broadcast('game:end', { reason, players: this.scoreboard() });
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
      participants: new Set(),
      starts: new Map(),
      results: new Map(),
      progress: new Map(),
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
    this.preparedRounds.add(index);
    this.broadcast('round:prepare', audio);
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
          tier: null,
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
        coverUrl: anime.coverUrl,
        coverColor: anime.coverColor,
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

  /** État, audio déjà annoncé et révélation en cours, pour un joueur qui (re)arrive. */
  private syncPlayer(id: string): void {
    this.emitter.toPlayer(id, 'game:state', this.snapshot(id));
    for (const index of [...this.preparedRounds].sort((a, b) => a - b)) {
      const round = this.rounds[index];
      if (index < this.roundIndex || !round) continue;
      this.emitter.toPlayer(id, 'round:prepare', {
        round: index,
        url: audioPath(round.token),
        startRatio: round.startRatio,
      });
    }
    if (this.phase === 'reveal' && this.lastReveal) {
      this.emitter.toPlayer(id, 'round:reveal', { ...this.lastReveal, players: this.scoreboard() });
    }
  }

  private broadcast<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void {
    for (const id of this.players.keys()) this.emitter.toPlayer(id, event, ...args);
  }

  private broadcastPlayers(): void {
    if (this.started) this.broadcast('game:players', this.scoreboard());
  }

  private clearAbandonTimer(): void {
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
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

  /** Tous les joueurs connectés ont trouvé (ou sont éliminés, en Progressif). */
  /** Tous les participants connectés ont trouvé (ou sont éliminés, en Progressif). */
  private everyoneDone(): boolean {
    const round = this.rounds[this.roundIndex]!;
    return this.connectedPlayers()
      .filter((player) => round.participants.has(player.id))
      .every(
        (player) =>
          round.results.get(player.id)?.correct || round.progress.get(player.id)?.eliminated,
      );
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
