import { randomUUID } from 'node:crypto';
import {
  BONUS_POINTS,
  MODE_TIMINGS,
  INITIAL_PROGRESS,
  PLAYLIST,
  PROGRESSIVE,
  PROGRESSIVE_LAST_TIER,
  chooserPoints,
  classicPoints,
  type AnswerPayload,
  type AnswerResult,
  type GameEndReason,
  type GamePhase,
  type GameSettings,
  type GameSnapshot,
  type LocalizedTitle,
  type ModeTiming,
  type PlayerRoundResult,
  type PlayerScore,
  type PlaylistReveal,
  type PlaylistRoundView,
  type RoundAudio,
  type RoundReveal,
  type ServerToClientEvents,
  type TierProgress,
} from '@blindtest/shared';
import { audioPath, videoPath, type MediaRegistry } from '../media/MediaRegistry';
import type { Catalogue } from '../catalogue/Catalogue';
import type { ThemeRow } from '../catalogue/types';
import { AuctionRound } from './AuctionRound';

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
/** Enchères : longueur maximale d'une proposition tapée, montrée aux autres joueurs. */
const GUESS_MAX_LENGTH = 80;

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
  /** Playlist : joueurs qui ont choisi la chanson (vide : tirée au hasard). Ils ne répondent pas. */
  choosers: string[];
  /** Playlist : paris « Devine qui l'a choisie » (`null` : personne). */
  guesses: Map<string, string | null>;
  /** Playlist : fin de la fenêtre pour deviner, ouverte quand tout le monde a trouvé. */
  guessWindowEndsAt: number | null;
  /** Mode Enchères : annonces, ordre de passage et réponses (créé à la fin du compte à rebours). */
  auction: AuctionRound | null;
}

export interface GameOptions {
  id?: string;
  settings: GameSettings;
  catalogue: Catalogue;
  media: MediaRegistry;
  emitter: GameEmitter;
  /** Musiques tirées : les premières sont jouées, le reste sert de remplaçantes. */
  themes: ThemeRow[];
  /**
   * Playlist : joueurs qui ont choisi chaque manche (aligné sur `themes`). Fixe le
   * nombre de manches ; les musiques suivantes servent de remplaçantes.
   */
  choosers?: string[][];
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
  /** Pseudos de tous les joueurs passés par la partie (révélation d'un joueur parti). */
  private readonly pseudos = new Map<string, string>();
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

    const wanted = options.choosers?.length ?? options.settings.rounds;
    const total = Math.min(wanted, options.themes.length);
    this.rounds = options.themes
      .slice(0, total)
      .map((theme, index) => this.createRound(theme, options.choosers?.[index] ?? []));
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
    this.pseudos.set(id, pseudo);
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
    this.afterPlayerLost(id, () => {
      // Plus personne : on laisse un délai pour revenir avant d'arrêter la partie.
      this.clearAbandonTimer();
      this.abandonTimer = setTimeout(() => this.close(), ABANDON_GRACE_MS);
    });
  }

  /** Le joueur quitte volontairement la partie. */
  leave(id: string): void {
    if (!this.players.delete(id)) return;
    this.dropChooser(id);
    this.afterPlayerLost(id, () => this.close());
  }

  /** Playlist : les chansons pas encore jouées d'un joueur parti deviennent des chansons sans joueur. */
  private dropChooser(id: string): void {
    this.rounds.forEach((round, index) => {
      const upcoming =
        index > this.roundIndex || (index === this.roundIndex && this.phase === 'countdown');
      if (upcoming) round.choosers = round.choosers.filter((chooser) => chooser !== id);
    });
  }

  private afterPlayerLost(id: string, whenEmpty: () => void): void {
    if (this.closed) return;
    if (this.connectedPlayers().length === 0) {
      whenEmpty();
      return;
    }
    this.broadcastPlayers();
    // Enchères : la main passe s'il l'avait, l'annonce se termine si les autres ont annoncé.
    const auction = this.rounds[this.roundIndex]?.auction;
    if (auction) {
      auction.playerLost(id);
      return;
    }
    // Les joueurs restants n'attendent pas celui qui est parti.
    if (this.phase === 'listening' && this.everyoneDone()) this.onEveryoneDone();
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
      players: this.scoreboard(forPlayer),
      // Début d'écoute propre au joueur (null s'il n'a pas encore démarré cette manche).
      listenStartedAt: round?.starts.get(forPlayer) ?? null,
      videoUrl: round?.videoToken ? videoPath(round.videoToken) : null,
      progress: this.isProgressive && round ? { ...this.progressOf(round, forPlayer) } : null,
      playlist: this.isPlaylist && round ? this.playlistView(round, forPlayer) : null,
      auction:
        round?.auction && this.phase !== 'reveal' && this.phase !== 'finished'
          ? round.auction.view(forPlayer)
          : null,
    };
  }

  private playlistView(round: RoundState, playerId: string): PlaylistRoundView {
    return {
      ownSong: round.choosers.includes(playerId),
      found: this.foundCount(round),
      guess: round.guesses.has(playerId) ? round.guesses.get(playerId)! : undefined,
      guessWindowEndsAt: round.guessWindowEndsAt,
    };
  }

  /** Le navigateur du joueur a préchargé l'audio de la manche. */
  audioReady(playerId: string, round: number, url: string): void {
    const player = this.players.get(playerId);
    const target = this.rounds[round];
    if (!player || !target || url !== audioPath(target.token)) return;
    player.ready.set(round, url);
    if (this.isAuction) {
      if (round === this.roundIndex) this.rounds[round]!.auction?.audioReady(playerId);
      return;
    }
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
    // Enchères : seul celui qui a la main répond, une fois (arbitrage dans AuctionRound).
    if (this.isAuction) {
      return (
        round.auction?.answer(playerId, payload) ?? { accepted: false, reason: 'not_listening' }
      );
    }
    if (this.isPlaylist && round.choosers.includes(playerId)) {
      return { accepted: false, reason: 'own_song' };
    }
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
      if (progress?.eliminated && this.everyoneDone()) this.onEveryoneDone();
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
    // Playlist : les scores ne bougent qu'à la révélation (rien ne trahit qui a trouvé).
    if (!this.isPlaylist) player.score += points;
    round.results.set(playerId, {
      playerId,
      correct: true,
      points,
      elapsedMs,
      seasonExact: verdict.seasonExact,
      sequenceExact: verdict.sequenceExact,
      tier: progress?.tier ?? null,
    });

    this.announceFound(round, playerId);
    // Tout le monde a fini : révélation tout de suite (après l'accusé de réception).
    if (this.everyoneDone()) this.onEveryoneDone();

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

  /**
   * Mode Progressif : le joueur abandonne la manche au dernier palier (0 point).
   * Il compte comme ayant fini : la révélation arrive dès que tout le monde a fini.
   */
  giveUp(playerId: string): TierProgress | null {
    const round = this.rounds[this.roundIndex];
    if (!this.isProgressive || this.phase !== 'listening' || !round) return null;
    if (!this.players.get(playerId)?.connected || round.results.get(playerId)?.correct) return null;
    const progress = this.progressOf(round, playerId);
    if (progress.tier < PROGRESSIVE_LAST_TIER) return { ...progress };
    progress.eliminated = true;
    progress.attemptsLeft = 0;
    if (this.everyoneDone()) this.onEveryoneDone();
    return { ...progress };
  }

  /**
   * Playlist : « Devine qui l'a choisie », pour un joueur qui a trouvé.
   * Un seul pari ; `null` = personne (chanson tirée au hasard).
   */
  guess(playerId: string, target: string | null): boolean {
    const round = this.rounds[this.roundIndex];
    if (!this.isPlaylist || this.phase !== 'listening' || !round) return false;
    if (!round.results.get(playerId)?.correct || round.guesses.has(playerId)) return false;
    if (target !== null && (target === playerId || !this.players.has(target))) return false;
    round.guesses.set(playerId, target);
    if (round.guessWindowEndsAt !== null && this.everyoneGuessed(round)) {
      this.schedule(0, () => this.endRound());
    }
    return true;
  }

  /** Enchères : annonce secrète d'un joueur pendant la phase d'annonce. */
  bid(playerId: string, bid: number): boolean {
    const round = this.rounds[this.roundIndex];
    if (!this.players.get(playerId)?.connected) return false;
    return round?.auction?.bid(playerId, bid) ?? false;
  }

  /** Enchères : celui qui a la main réécoute l'extrait (réécoutes restantes, ou null). */
  replay(playerId: string): number | null {
    if (!this.players.get(playerId)?.connected) return null;
    return this.rounds[this.roundIndex]?.auction?.replay(playerId) ?? null;
  }

  private get isProgressive(): boolean {
    return this.settings.mode === 'progressive';
  }

  private get isPlaylist(): boolean {
    return this.settings.mode === 'playlist';
  }

  /** Un joueur a trouvé : en Playlist, seul qui a choisi la chanson sait qui ; les autres, combien. */
  private announceFound(round: RoundState, playerId: string): void {
    if (!this.isPlaylist) {
      this.broadcast('player:found', { playerId, players: this.scoreboard() });
      return;
    }
    for (const chooser of round.choosers) {
      if (this.players.has(chooser)) {
        this.emitter.toPlayer(chooser, 'player:found', {
          playerId,
          players: this.scoreboard(chooser),
        });
      }
    }
    this.broadcast('playlist:found', { found: this.foundCount(round) });
  }

  /**
   * Tout le monde a fini : révélation tout de suite. En Playlist, une fenêtre
   * s'ouvre d'abord pour deviner qui a choisi la chanson (sauf si c'est déjà fait).
   */
  private onEveryoneDone(): void {
    const round = this.rounds[this.roundIndex]!;
    if (!this.isPlaylist || this.foundCount(round) === 0 || this.everyoneGuessed(round)) {
      this.schedule(0, () => this.endRound());
      return;
    }
    if (round.guessWindowEndsAt !== null) return;
    round.guessWindowEndsAt = Date.now() + PLAYLIST.guessWindowMs;
    this.phaseEndsAt = round.guessWindowEndsAt;
    this.broadcast('playlist:guessWindow', { endsAt: round.guessWindowEndsAt });
    this.schedule(PLAYLIST.guessWindowMs, () => this.endRound());
  }

  private foundCount(round: RoundState): number {
    let found = 0;
    for (const result of round.results.values()) if (result.correct) found++;
    return found;
  }

  /** Tous les joueurs présents qui ont trouvé ont parié. */
  private everyoneGuessed(round: RoundState): boolean {
    return this.connectedPlayers()
      .filter((player) => round.results.get(player.id)?.correct)
      .every((player) => round.guesses.has(player.id));
  }

  private get isAuction(): boolean {
    return this.settings.mode === 'auction';
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
    if (this.isAuction) {
      this.startAuction();
      return;
    }
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

  /**
   * Enchères : l'annonce s'ouvre directement après le compte à rebours ; ses 8 s
   * laissent à l'audio le temps de finir de charger (chaque extrait attend
   * ensuite, au plus `audioWaitMs`, le son de celui qui a la main).
   */
  private startAuction(): void {
    const index = this.roundIndex;
    const round = this.rounds[index]!;
    const anime = this.catalogue.getAnime(round.theme.animeId);
    if (round.theme.videoUrl && !round.videoToken) {
      round.videoToken = this.media.register(round.theme.videoUrl, 'video');
    }
    for (const player of this.connectedPlayers()) round.participants.add(player.id);
    round.auction = new AuctionRound(
      [...round.participants],
      { type: round.theme.type, year: anime?.year ?? null, genre: anime?.genre ?? null },
      round.videoToken ? videoPath(round.videoToken) : null,
      {
        isConnected: (id) => this.players.get(id)?.connected ?? false,
        isAudioReady: (id) => this.players.get(id)?.ready.get(index) === audioPath(round.token),
        schedule: (delayMs, action) => this.schedule(delayMs, action),
        setPhase: (phase, endsAt) => {
          this.phase = phase;
          this.phaseEndsAt = endsAt;
        },
        broadcastState: () => {
          for (const id of this.players.keys()) {
            this.emitter.toPlayer(id, 'auction:state', {
              round: index,
              view: round.auction!.view(id),
            });
          }
        },
        isCorrect: (payload) => this.catalogue.validate(round.theme.id, payload).correct,
        guessTitle: (payload) => this.guessTitle(payload),
        addScore: (id, delta) => {
          const player = this.players.get(id);
          if (player) player.score += delta;
          this.broadcastPlayers();
        },
        endRound: () => this.endRound(),
      },
      this.audioWaitMs,
    );
    // Préchargement de la manche suivante pendant celle-ci.
    if (!this.preparedRounds.has(index + 1)) this.emitPrepare(index + 1);
    round.auction.start();
  }

  /** Proposition d'un joueur telle qu'on l'affiche aux autres (titre choisi, ou texte tapé). */
  private guessTitle(payload: AnswerPayload): LocalizedTitle {
    const { pick } = payload;
    if (pick?.kind === 'anime') {
      const anime = this.catalogue.getAnime(pick.id);
      if (anime) {
        return {
          fr: this.catalogue.animeTitle(anime, 'fr'),
          en: this.catalogue.animeTitle(anime, 'en'),
        };
      }
    } else if (pick?.kind === 'franchise') {
      const franchise = this.catalogue.getFranchise(pick.id);
      if (franchise) {
        return {
          fr: this.catalogue.franchiseTitle(franchise, 'fr'),
          en: this.catalogue.franchiseTitle(franchise, 'en'),
        };
      }
    }
    const text = payload.text.replace(/\s+/g, ' ').trim().slice(0, GUESS_MAX_LENGTH) || '…';
    return { fr: text, en: text };
  }

  /** Lance l'écoute pour un joueur (début commun, ou plus tard pour un retardataire). */
  private startPlayer(round: RoundState, playerId: string, startedAt: number): void {
    round.starts.set(playerId, startedAt);
    this.emitter.toPlayer(playerId, 'round:start', {
      round: this.roundIndex,
      startedAt,
      phaseEndsAt: startedAt + this.timing.listenMs,
      videoUrl: round.videoToken ? videoPath(round.videoToken) : null,
      ...(this.isPlaylist && { ownSong: round.choosers.includes(playerId) }),
    });
  }

  private endRound(): void {
    const round = this.rounds[this.roundIndex]!;
    const playlist = this.isPlaylist ? this.settlePlaylist(round) : undefined;
    this.phase = 'reveal';
    this.phaseEndsAt = Date.now() + this.timing.revealMs;
    this.lastReveal = this.buildReveal();
    if (playlist) this.lastReveal.playlist = playlist;
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

  /**
   * Playlist : points de la manche, comptés à la révélation.
   * - qui a trouvé : points normaux, +50 si un joueur a choisi la chanson, +50 s'il a deviné qui ;
   * - qui a choisi : +50 par joueur qui n'a pas trouvé (0 si tout le monde ou personne n'a trouvé).
   */
  private settlePlaylist(round: RoundState): PlaylistReveal {
    const chosen = round.choosers.length > 0;
    const answerers = [...round.participants].filter((id) => {
      const player = this.players.get(id);
      if (!player || round.choosers.includes(id)) return false;
      return player.connected || round.results.get(id)?.correct === true;
    });
    const found = answerers.filter((id) => round.results.get(id)?.correct).length;
    const points = chosen ? chooserPoints(answerers.length, found) : 0;

    const guesses: PlaylistReveal['guesses'] = [];
    for (const [playerId, guess] of round.guesses) {
      const correct = guess === null ? !chosen : round.choosers.includes(guess);
      guesses.push({ playerId, guess, correct });
    }
    for (const result of round.results.values()) {
      if (!result.correct) continue;
      const foundBonus = chosen ? PLAYLIST.foundBonus : 0;
      const guessedRight = guesses.some((g) => g.playerId === result.playerId && g.correct);
      const guessBonus = guessedRight ? PLAYLIST.guessBonus : 0;
      result.points += foundBonus + guessBonus;
      result.playlist = { ownSong: false, foundBonus, guessBonus, chooserPoints: 0 };
      const player = this.players.get(result.playerId);
      if (player) player.score += result.points;
    }
    for (const id of round.choosers) {
      const player = this.players.get(id);
      if (!player) continue;
      player.score += points;
      round.results.set(id, {
        playerId: id,
        correct: false,
        points,
        elapsedMs: null,
        seasonExact: false,
        sequenceExact: false,
        tier: null,
        playlist: { ownSong: true, foundBonus: 0, guessBonus: 0, chooserPoints: points },
      });
    }
    return {
      choosers: round.choosers.map((id) => ({ id, pseudo: this.pseudos.get(id) ?? '?' })),
      answerers: answerers.length,
      found,
      chooserPoints: points,
      guesses,
    };
  }

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  private createRound(theme: ThemeRow, choosers: string[] = []): RoundState {
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
      choosers: [...choosers],
      guesses: new Map(),
      guessWindowEndsAt: null,
      auction: null,
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
    const { auction } = round;
    const results = [...this.players.values()].map(
      (player): PlayerRoundResult =>
        auction?.resultFor(player.id) ??
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
      ...(auction && { auction: auction.turns() }),
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
    if (!this.started) return;
    for (const id of this.players.keys()) {
      this.emitter.toPlayer(id, 'game:players', this.scoreboard(id));
    }
  }

  private clearAbandonTimer(): void {
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.abandonTimer = null;
  }

  /**
   * Classement. En Playlist, pendant la manche, qui a trouvé reste secret
   * (sauf pour qui a choisi la chanson, `forPlayer`).
   */
  private scoreboard(forPlayer?: string): PlayerScore[] {
    const round = this.rounds[this.roundIndex];
    const hideFound =
      this.isPlaylist &&
      (this.phase === 'countdown' || this.phase === 'listening') &&
      !(forPlayer && round?.choosers.includes(forPlayer));
    return [...this.players.values()]
      .map((player) => ({
        id: player.id,
        pseudo: player.pseudo,
        score: player.score,
        // Sa propre coche n'a rien de secret (et sert à la reconnexion).
        found:
          (!hideFound || player.id === forPlayer) &&
          (round?.auction
            ? round.auction.hasFound(player.id)
            : (round?.results.get(player.id)?.correct ?? false)),
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

  /**
   * Tous les participants connectés ont trouvé (ou sont éliminés, en Progressif).
   * En Playlist, qui a choisi la chanson ne répond pas : il n'est pas attendu.
   */
  private everyoneDone(): boolean {
    const round = this.rounds[this.roundIndex]!;
    return this.connectedPlayers()
      .filter((player) => round.participants.has(player.id) && !round.choosers.includes(player.id))
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
