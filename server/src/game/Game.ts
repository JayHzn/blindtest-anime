import { randomUUID } from 'node:crypto';
import {
  BONUS_POINTS,
  HIGHER_LOWER,
  IMPOSTOR,
  impostorCount,
  titleWordsOf,
  MODE_TIMINGS,
  INITIAL_PROGRESS,
  PLAYLIST,
  PROGRESSIVE,
  PROGRESSIVE_LAST_TIER,
  chooserPoints,
  classicPoints,
  compareHigherLower,
  firstRound,
  higherLowerListenMs,
  pickOpensAfterMs,
  popularityRatio,
  ratioWindow,
  type AnswerPayload,
  type AnswerResult,
  type GameEndReason,
  type GamePhase,
  type GameSettings,
  type GameSnapshot,
  type HigherLowerCard,
  type HigherLowerPick,
  type HigherLowerReveal,
  type HigherLowerView,
  type ImpostorSong,
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
import type { AudioMirror } from '../media/AudioMirror';
import { audioPath, videoPath, type MediaRegistry } from '../media/MediaRegistry';
import type { Catalogue } from '../catalogue/Catalogue';
import type { ThemeRow } from '../catalogue/types';
import { AuctionRound } from './AuctionRound';
import { ImpostorRound } from './ImpostorRound';

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
/**
 * Avance de l'heure de départ commune de l'écoute : chaque navigateur reçoit
 * `round:start` avant cette heure et lance l'extrait pile à ce moment, depuis sa
 * position préchargée (instantané, et synchronisé entre les joueurs).
 */
export const LISTEN_LEAD_MS = 500;
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
  /** Jeton opaque de l'audio (proxy du serveur). */
  token: string;
  /** Adresse de l'audio : miroir R2 si la chanson y est copiée, sinon le proxy. */
  audioUrl: string;
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
  /** Plus ou moins : choix définitifs des joueurs encore en jeu. */
  picks: Map<string, HigherLowerPick>;
  /** Imposteur : chanson de l'imposteur, son audio opaque et son point de départ. */
  impostorTheme: ThemeRow | null;
  impostorToken: string | null;
  impostorAudioUrl: string | null;
  impostorStartRatio: number;
  /** Imposteur : joueurs qui ont un rôle (tirés quand l'audio est envoyé), et les imposteurs. */
  roleHolders: string[] | null;
  impostors: string[];
  /** Imposteur : indices, votes, éliminations (créé à la fin du compte à rebours). */
  impostor: ImpostorRound | null;
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
  /** Imposteur : chanson de l'imposteur de chaque manche (aligné sur `themes`). */
  impostorThemes?: ThemeRow[];
  /** Miroir audio (R2) : l'audio des chansons copiées n'y passe plus par le serveur. */
  mirror?: AudioMirror | null;
  random?: () => number;
  onFinished?: (game: Game) => void;
  /** Durée du compte à rebours de la première manche (écran d'intro en room). */
  introMs?: number;
  /** Attente maximale des retardataires avant de démarrer l'écoute. */
  audioWaitMs?: number;
  /** Avance de l'heure de départ commune de l'écoute (`LISTEN_LEAD_MS` dans les vraies parties). */
  listenLeadMs?: number;
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
  private readonly mirror: AudioMirror | null;
  private readonly emitter: GameEmitter;
  private readonly random: () => number;
  private readonly onFinished?: (game: Game) => void;
  private readonly introMs: number;
  private readonly audioWaitMs: number;
  private readonly listenLeadMs: number;

  private readonly players = new Map<string, PlayerState>();
  /** Pseudos de tous les joueurs passés par la partie (révélation d'un joueur parti). */
  private readonly pseudos = new Map<string, string>();
  private readonly rounds: RoundState[];
  private readonly spares: ThemeRow[];
  /** Imposteur : chansons d'imposteur des musiques de rechange (alignées sur `spares`). */
  private readonly impostorSpares: ThemeRow[];
  private phase: GamePhase = 'countdown';
  private roundIndex = 0;
  private phaseEndsAt = 0;
  private waitingForAudio = false;
  private timer: NodeJS.Timeout | null = null;
  private abandonTimer: NodeJS.Timeout | null = null;
  /** Manches dont l'audio a déjà été envoyé (pour les joueurs qui arrivent en cours de route). */
  private readonly preparedRounds = new Set<number>();
  private lastReveal: RoundReveal | null = null;
  /** Plus ou moins : tour d'élimination de chaque joueur (0 : arrivé en cours de partie). */
  private readonly eliminatedAt = new Map<string, number>();
  /** Joueurs au lancement (en Plus ou moins, à plusieurs, le dernier en jeu gagne). */
  private startingPlayers = 0;
  private started = false;
  private closed = false;

  constructor(options: GameOptions) {
    this.id = options.id ?? randomUUID();
    this.settings = options.settings;
    this.timing = MODE_TIMINGS[options.settings.mode];
    this.catalogue = options.catalogue;
    this.media = options.media;
    this.mirror = options.mirror ?? null;
    this.emitter = options.emitter;
    this.random = options.random ?? Math.random;
    this.onFinished = options.onFinished;
    this.introMs = options.introMs ?? this.timing.countdownMs;
    this.audioWaitMs = options.audioWaitMs ?? AUDIO_WAIT_MS;
    this.listenLeadMs = options.listenLeadMs ?? 0;

    // Plus ou moins : toute la chaîne tirée est jouable (la partie s'arrête à l'élimination).
    const wanted =
      options.settings.mode === 'higherLower'
        ? options.themes.length
        : (options.choosers?.length ?? options.settings.rounds);
    const total = Math.min(wanted, options.themes.length);
    this.rounds = options.themes
      .slice(0, total)
      .map((theme, index) =>
        this.createRound(theme, options.choosers?.[index] ?? [], options.impostorThemes?.[index]),
      );
    this.spares = options.themes.slice(total);
    this.impostorSpares = options.impostorThemes?.slice(total) ?? [];
  }

  get totalRounds(): number {
    // Plus ou moins : la chanson 0 n'est que la première référence.
    return this.isHigherLower ? Math.max(0, this.rounds.length - 1) : this.rounds.length;
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
    // Plus ou moins : qui arrive en cours de partie regarde (il n'a pas joué les tours précédents).
    if (this.started && this.isHigherLower) this.eliminatedAt.set(id, 0);
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
    const impostor = this.rounds[this.roundIndex]?.impostor;
    if (impostor) {
      impostor.playerLost(id);
      return;
    }
    // Les joueurs restants n'attendent pas celui qui est parti.
    if (this.phase === 'listening' && this.everyoneDone()) this.onEveryoneDone();
    if (this.waitingForAudio && this.everyoneReady()) this.startListening();
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    this.startingPlayers = this.players.size;
    // Chacun reçoit l'état initial (joueurs, nombre de manches) avant la première manche.
    for (const id of this.players.keys())
      this.emitter.toPlayer(id, 'game:state', this.snapshot(id));
    // Les chansons 1 et 2 se chargent pendant le compte à rebours / l'écran d'intro
    // (Plus ou moins : A et B du tour 1, et la chanson du tour 2).
    this.emitPrepare(0);
    this.emitPrepare(1);
    if (this.isHigherLower) this.emitPrepare(2);
    this.enterCountdown(firstRound(this.settings.mode));
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
      higherLower: this.isHigherLower && round ? this.higherLowerView(round, forPlayer) : null,
      impostor:
        round?.impostor && this.phase !== 'reveal' && this.phase !== 'finished'
          ? round.impostor.view(forPlayer)
          : null,
    };
  }

  /** Plus ou moins : tour en cours vu par un joueur (référence en clair, écart, son choix). */
  private higherLowerView(round: RoundState, playerId: string): HigherLowerView {
    const tour = this.roundIndex;
    const reference = tour > 1 ? this.rounds[tour - 1] : undefined;
    return {
      tour,
      reference: reference ? this.higherLowerCard(reference.theme) : null,
      window: ratioWindow(tour),
      yourPick: round.picks.get(playerId) ?? null,
    };
  }

  private higherLowerCard(theme: ThemeRow): HigherLowerCard {
    const anime = this.catalogue.getAnime(theme.animeId)!;
    return {
      title: {
        fr: this.catalogue.animeTitle(anime, 'fr'),
        en: this.catalogue.animeTitle(anime, 'en'),
      },
      romaji: anime.titleRomaji ?? anime.name,
      year: anime.year,
      coverUrl: anime.coverUrl,
      coverColor: anime.coverColor,
      type: theme.type,
      sequence: theme.sequence,
      song: theme.songTitle,
      artists: theme.artists,
      popularity: anime.popularity,
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
    if (!player || !target || url !== this.audioUrlFor(target, playerId)) return;
    player.ready.set(round, url);
    if (this.isAuction || this.isImpostor) {
      if (round === this.roundIndex) this.rounds[round]!.auction?.audioReady(playerId);
      return;
    }
    if (!this.roundAudio().includes(round)) return;
    if (this.waitingForAudio && this.everyoneReady()) {
      this.startListening();
      return;
    }
    // Retardataire : l'écoute a commencé sans lui ; il démarre maintenant, avec tout son temps.
    // (Plus ou moins : les éliminés écoutent aussi, en spectateurs.)
    const current = this.rounds[this.roundIndex]!;
    if (
      this.phase === 'listening' &&
      (current.participants.has(playerId) || this.isHigherLower) &&
      !current.starts.has(playerId) &&
      this.isPlayerReady(player)
    ) {
      const startsAt = Date.now() + this.listenLeadMs;
      this.startPlayer(current, playerId, startsAt);
      const deadline = startsAt + this.listenMs;
      if (deadline > this.phaseEndsAt) {
        this.phaseEndsAt = deadline;
        this.schedule(deadline - Date.now(), () => this.endRound());
      }
    }
  }

  /** L'audio n'a pas pu être chargé : on remplace la musique tant que la manche n'a pas commencé. */
  audioFailed(playerId: string, round: number, url: string): void {
    const target = this.rounds[round];
    if (!this.players.has(playerId) || !target || url !== this.audioUrlFor(target, playerId)) {
      return;
    }
    // Plus ou moins : la chanson A (0) n'est jouée qu'au tour 1.
    const notStartedYet =
      round > this.roundIndex || (this.phase === 'countdown' && this.roundAudio().includes(round));
    if (!notStartedYet) return;
    // Fichier du miroir injoignable : même chanson, par le proxy du serveur.
    if (this.mirror?.isMirrorUrl(url)) {
      if (target.audioUrl === url) target.audioUrl = audioPath(target.token);
      if (target.impostorAudioUrl === url)
        target.impostorAudioUrl = audioPath(target.impostorToken!);
      for (const player of this.players.values()) player.ready.delete(round);
      this.emitPrepare(round);
      return;
    }
    if (this.isHigherLower) {
      this.replaceHigherLowerSong(round);
      return;
    }

    const replacement = this.spares.shift();
    const impostorReplacement = this.impostorSpares.shift();
    this.revokeRound(target);
    if (!replacement) {
      this.handleNoReplacement(round);
      return;
    }
    this.rounds[round] = this.createRound(replacement, [], impostorReplacement);
    for (const player of this.players.values()) player.ready.delete(round);
    this.emitPrepare(round);
  }

  answer(playerId: string, payload: AnswerPayload): AnswerResult {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return { accepted: false, reason: 'not_in_game' };
    const round = this.rounds[this.roundIndex]!;
    // Imposteur : seuls les civils gagnants devinent la chanson de l'imposteur (un essai).
    if (this.isImpostor) {
      return (
        round.impostor?.guess(playerId, payload) ?? { accepted: false, reason: 'not_listening' }
      );
    }
    // Plus ou moins : pas de réponse tapée, seulement un choix (voir `pick`).
    if (this.isHigherLower) return { accepted: false, reason: 'not_listening' };
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
      Date.now() > startedAt + this.listenMs
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
      if (progress?.eliminated) this.sendVideo(round, playerId);
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
      : classicPoints(elapsedMs, this.listenMs);
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
    this.sendVideo(round, playerId);
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
    this.sendVideo(round, playerId);
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

  /**
   * Plus ou moins : choix définitif d'un joueur encore en jeu, dès que la nouvelle
   * chanson commence (au tour 1 : quand B commence) et jusqu'à la fin de son temps.
   */
  pick(playerId: string, pick: HigherLowerPick): boolean {
    const round = this.rounds[this.roundIndex];
    if (!this.isHigherLower || this.phase !== 'listening' || !round) return false;
    if (!this.players.get(playerId)?.connected || !round.participants.has(playerId)) return false;
    const startedAt = round.starts.get(playerId);
    if (startedAt === undefined || round.picks.has(playerId)) return false;
    const now = Date.now();
    const opensAt = startedAt + pickOpensAfterMs(this.roundIndex) - HIGHER_LOWER.pickToleranceMs;
    if (now < opensAt || now > startedAt + this.listenMs) return false;
    round.picks.set(playerId, pick);
    // Tout le monde voit qui a répondu, jamais quoi.
    this.broadcast('player:found', { playerId, players: this.scoreboard() });
    if (this.everyoneDone()) this.schedule(0, () => this.endRound());
    return true;
  }

  /** Imposteur : le mot du joueur qui a la parole. */
  impostorWord(playerId: string, word: unknown): ReturnType<ImpostorRound['word']> {
    if (!this.players.get(playerId)?.connected) return { ok: false, reason: 'not_your_turn' };
    return (
      this.rounds[this.roundIndex]?.impostor?.word(playerId, word) ?? {
        ok: false,
        reason: 'not_your_turn',
      }
    );
  }

  /** Imposteur : vote d'un joueur encore en jeu. */
  impostorVote(playerId: string, target: string): boolean {
    if (!this.players.get(playerId)?.connected) return false;
    return this.rounds[this.roundIndex]?.impostor?.vote(playerId, target) ?? false;
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

  private get isHigherLower(): boolean {
    return this.settings.mode === 'higherLower';
  }

  private get isImpostor(): boolean {
    return this.settings.mode === 'impostor';
  }

  /** Imposteur : l'imposteur reçoit l'audio de sa chanson ; les autres celui des civils. */
  private audioUrlFor(round: RoundState, playerId: string): string {
    return this.isImpostorOf(round, playerId) ? round.impostorAudioUrl! : round.audioUrl;
  }

  private startRatioFor(round: RoundState, playerId: string): number {
    return this.isImpostorOf(round, playerId) ? round.impostorStartRatio : round.startRatio;
  }

  private isImpostorOf(round: RoundState, playerId: string): boolean {
    return round.impostorToken !== null && round.impostors.includes(playerId);
  }

  /** Temps d'écoute et de réponse de la manche en cours (Plus ou moins : 30 s au tour 1). */
  private get listenMs(): number {
    return this.isHigherLower ? higherLowerListenMs(this.roundIndex) : this.timing.listenMs;
  }

  /** Audios joués pendant la manche en cours (Plus ou moins, tour 1 : A et B). */
  private roundAudio(): number[] {
    return this.isHigherLower && this.roundIndex === 1 ? [0, 1] : [this.roundIndex];
  }

  private isPlayerReady(player: PlayerState): boolean {
    return this.roundAudio().every((index) => {
      const round = this.rounds[index];
      return round !== undefined && player.ready.get(index) === this.audioUrlFor(round, player.id);
    });
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
    const duration =
      index === firstRound(this.settings.mode) ? this.introMs : this.timing.countdownMs;
    this.phaseEndsAt = Date.now() + duration;
    this.broadcast('round:countdown', { round: index, phaseEndsAt: this.phaseEndsAt });
    this.schedule(duration, () => this.afterCountdown());
  }

  private afterCountdown(): void {
    if (this.isAuction) {
      this.startAuction();
      return;
    }
    if (this.isImpostor) {
      this.startImpostor();
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
    // Départ commun un peu dans le futur : le temps que `round:start` arrive partout.
    const startsAt = Date.now() + this.listenLeadMs;
    this.waitingForAudio = false;
    this.phase = 'listening';
    round.listenStartedAt = startsAt;
    this.phaseEndsAt = startsAt + this.listenMs;
    // La vidéo n'est plus préchargée pendant l'écoute : son lien direct arrive avec la
    // révélation (voir `RoundReveal.video`).
    // Les joueurs dont le son est prêt démarrent ensemble ; les autres dès qu'il le sera.
    for (const player of this.connectedPlayers()) {
      // Plus ou moins : les éliminés écoutent sans répondre.
      if (!this.eliminatedAt.has(player.id)) round.participants.add(player.id);
      if (this.isPlayerReady(player)) this.startPlayer(round, player.id, startsAt);
    }
    // Préchargement de la manche suivante pendant l'écoute.
    if (!this.preparedRounds.has(this.roundIndex + 1)) this.emitPrepare(this.roundIndex + 1);
    this.schedule(this.listenLeadMs + this.listenMs, () => this.endRound());
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
    for (const player of this.connectedPlayers()) round.participants.add(player.id);
    round.auction = new AuctionRound(
      [...round.participants],
      { type: round.theme.type, year: anime?.year ?? null, genre: anime?.genre ?? null },
      round.videoToken ? videoPath(round.videoToken) : null,
      {
        isConnected: (id) => this.players.get(id)?.connected ?? false,
        isAudioReady: (id) => this.players.get(id)?.ready.get(index) === round.audioUrl,
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

  /**
   * Imposteur : la manche commence par l'extrait commun (chacun le sien), puis les
   * indices. Jouent les joueurs qui ont reçu un rôle et sont encore là ; les autres regardent.
   */
  private startImpostor(): void {
    const index = this.roundIndex;
    const round = this.rounds[index]!;
    if (!round.roleHolders) this.drawRoles(round);
    const participants = round.roleHolders!.filter((id) => this.players.has(id));
    // L'imposteur est parti avant la manche : on en désigne un autre (il charge son audio).
    if (!participants.some((id) => round.impostors.includes(id)) && participants.length > 0) {
      const replacement = participants[Math.floor(this.random() * participants.length)]!;
      round.impostors = [replacement];
      this.emitter.toPlayer(replacement, 'round:prepare', {
        round: index,
        url: this.audioUrlFor(round, replacement),
        startRatio: this.startRatioFor(round, replacement),
      });
    }
    for (const id of participants) round.participants.add(id);
    const impostorTheme = round.impostorTheme!;
    const civilWords = this.titleWords(round.theme);
    const impostorWords = this.titleWords(impostorTheme);
    round.impostor = new ImpostorRound(
      participants,
      round.impostors.filter((id) => participants.includes(id)),
      this.settings.voteMs ?? IMPOSTOR.voteDefaultMs,
      {
        isConnected: (id) => this.players.get(id)?.connected ?? false,
        schedule: (delayMs, action) => this.schedule(delayMs, action),
        setPhase: (phase, endsAt) => {
          this.phase = phase;
          this.phaseEndsAt = endsAt;
        },
        broadcastState: () => {
          for (const id of this.players.keys()) {
            this.emitter.toPlayer(id, 'impostor:state', {
              round: index,
              view: round.impostor!.view(id),
            });
          }
        },
        songOf: (id) =>
          round.roleHolders!.includes(id)
            ? this.impostorSong(round.impostors.includes(id) ? impostorTheme : round.theme)
            : null,
        titleWordsOf: (id) => (round.impostors.includes(id) ? impostorWords : civilWords),
        isImpostorSong: (payload) => this.catalogue.validate(impostorTheme.id, payload).correct,
        addScore: (id, delta) => {
          const player = this.players.get(id);
          if (player) player.score += delta;
        },
        endRound: () => this.endRound(),
      },
      this.random,
    );
    // Préchargement de la manche suivante pendant celle-ci.
    if (!this.preparedRounds.has(index + 1)) this.emitPrepare(index + 1);
    round.impostor.start();
  }

  /** Imposteur : rôles de la manche, tirés parmi les joueurs connectés. */
  private drawRoles(round: RoundState): void {
    const holders = this.connectedPlayers().map((player) => player.id);
    const shuffled = [...holders];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    round.roleHolders = holders;
    round.impostors = shuffled.slice(0, impostorCount(holders.length));
  }

  /** Mots du titre d'une chanson (tous les titres de l'anime et de sa série), refusés comme indices. */
  private titleWords(theme: ThemeRow): Set<string> {
    const anime = this.catalogue.getAnime(theme.animeId)!;
    const franchise = this.catalogue.getFranchise(anime.franchiseId);
    return titleWordsOf(
      [
        anime.name,
        anime.titleRomaji,
        anime.titleEn,
        anime.titleFr,
        franchise?.name,
        franchise?.nameFr,
      ].filter((title): title is string => Boolean(title)),
    );
  }

  private impostorSong(theme: ThemeRow): ImpostorSong {
    const anime = this.catalogue.getAnime(theme.animeId)!;
    return {
      title: {
        fr: this.catalogue.animeTitle(anime, 'fr'),
        en: this.catalogue.animeTitle(anime, 'en'),
      },
      romaji: anime.titleRomaji ?? anime.name,
      year: anime.year,
      coverUrl: anime.coverUrl,
      coverColor: anime.coverColor,
      type: theme.type,
      sequence: theme.sequence,
      song: theme.songTitle,
      artists: theme.artists,
    };
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
      phaseEndsAt: startedAt + this.listenMs,
      videoUrl: round.videoToken ? videoPath(round.videoToken) : null,
      ...(this.isPlaylist && { ownSong: round.choosers.includes(playerId) }),
      ...(this.isHigherLower && { higherLower: this.higherLowerView(round, playerId) }),
    });
    // Playlist : qui a choisi la chanson la connaît déjà.
    if (this.isPlaylist && round.choosers.includes(playerId)) this.sendVideo(round, playerId);
  }

  /**
   * Lien direct de la vidéo pour un joueur qui ne peut plus répondre : il la précharge
   * (sans passer par notre serveur) et la révélation démarre sans attendre.
   */
  private sendVideo(round: RoundState, playerId: string): void {
    if (!round.theme.videoUrl || this.isHigherLower || this.isImpostor) return;
    this.emitter.toPlayer(playerId, 'round:video', {
      round: this.roundIndex,
      url: round.theme.videoUrl,
    });
  }

  private endRound(): void {
    const round = this.rounds[this.roundIndex]!;
    const playlist = this.isPlaylist ? this.settlePlaylist(round) : undefined;
    const higherLower = this.isHigherLower ? this.settleHigherLower(round) : undefined;
    this.phase = 'reveal';
    this.phaseEndsAt = Date.now() + this.timing.revealMs;
    this.lastReveal = this.buildReveal();
    if (playlist) this.lastReveal.playlist = playlist;
    if (higherLower) this.lastReveal.higherLower = higherLower;
    this.broadcast('round:reveal', this.lastReveal);
    this.schedule(this.timing.revealMs, () => {
      if (!higherLower?.gameOver && this.roundIndex + 1 < this.rounds.length) {
        this.enterCountdown(this.roundIndex + 1);
      } else {
        this.finish('completed');
      }
    });
  }

  private finish(reason: GameEndReason): void {
    this.phase = 'finished';
    this.phaseEndsAt = Date.now();
    this.broadcast('game:end', { reason, players: this.scoreboard() });
    this.close();
  }

  private handleNoReplacement(round: number): void {
    // Plus ou moins : sans A ou B, pas de tour 1.
    if (round === 0 || (this.isHigherLower && round <= 1)) {
      this.finish('audio_unavailable');
      return;
    }
    // Plus de musique de rechange : la partie s'arrête avant la manche injouable.
    for (const removed of this.rounds.splice(round)) this.revokeRound(removed);
    if (round === this.roundIndex) this.finish('completed');
  }

  /**
   * Plus ou moins : un audio injouable (pas encore joué) est remplacé en retirant la
   * suite de la chaîne à partir de lui, pour que chaque écart reste respecté.
   */
  private replaceHigherLowerSong(index: number): void {
    const failed = this.rounds[index]!;
    const exclude = new Set<number>();
    const franchise = this.catalogue.franchiseOfTheme(failed.theme.id);
    if (franchise !== undefined) exclude.add(franchise);
    const chain = this.catalogue.higherLowerChain(
      this.settings.filters,
      HIGHER_LOWER.maxTours + 1,
      this.random,
      this.rounds.slice(0, index).map((round) => round.theme),
      exclude,
    );
    for (const removed of this.rounds.splice(index)) this.revokeRound(removed);
    for (const theme of chain.slice(index)) this.rounds.push(this.createRound(theme));
    for (const player of this.players.values()) {
      for (const key of [...player.ready.keys()]) if (key >= index) player.ready.delete(key);
    }
    for (const prepared of [...this.preparedRounds].sort((a, b) => a - b)) {
      if (prepared < index) continue;
      if (this.rounds[prepared]) this.emitPrepare(prepared);
      else this.preparedRounds.delete(prepared);
    }
    if (this.rounds.length <= index) this.handleNoReplacement(index);
  }

  /**
   * Plus ou moins : résultat du tour, compté à la révélation.
   * - bonne réponse : +1 (le score compte les bonnes réponses) ;
   * - erreur ou silence : éliminé, sauf si tous les joueurs encore en jeu se sont trompés ;
   * - fin de partie : plus personne en jeu, un seul à plusieurs, ou dernier tour.
   */
  private settleHigherLower(round: RoundState): HigherLowerReveal {
    const tour = this.roundIndex;
    const reference = this.higherLowerCard(this.rounds[tour - 1]!.theme);
    const challenger = this.higherLowerCard(round.theme);
    const answer: HigherLowerPick =
      challenger.popularity > reference.popularity ? 'higher' : 'lower';
    const alive = [...this.players.keys()].filter((id) => !this.eliminatedAt.has(id));
    const picks = alive.map((playerId) => {
      const pick = round.picks.get(playerId) ?? null;
      return { playerId, pick, correct: pick === answer };
    });
    const wrong = picks.filter((entry) => !entry.correct).map((entry) => entry.playerId);
    const allWrong = alive.length >= 2 && wrong.length === alive.length;
    const eliminated = allWrong ? [] : wrong;

    for (const { playerId, pick, correct } of picks) {
      const player = this.players.get(playerId)!;
      if (correct) player.score += 1;
      round.results.set(playerId, {
        playerId,
        correct,
        points: correct ? 1 : 0,
        elapsedMs: null,
        seasonExact: false,
        sequenceExact: false,
        tier: null,
        higherLower: { pick },
      });
    }
    for (const id of eliminated) this.eliminatedAt.set(id, tour);

    const remaining = alive.length - eliminated.length;
    const gameOver =
      remaining === 0 ||
      (this.startingPlayers >= 2 && remaining <= 1) ||
      tour + 1 >= this.rounds.length;
    return {
      tour,
      reference,
      challenger,
      ratio: Math.round(popularityRatio(reference.popularity, challenger.popularity) * 100) / 100,
      answer,
      picks,
      eliminated,
      allWrong,
      gameOver,
    };
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

  private createRound(
    theme: ThemeRow,
    choosers: string[] = [],
    impostorTheme?: ThemeRow,
  ): RoundState {
    const token = this.media.register(theme.audioUrl);
    const impostorToken = impostorTheme ? this.media.register(impostorTheme.audioUrl) : null;
    return {
      theme,
      token,
      audioUrl: this.mirror?.urlFor(theme.id) ?? audioPath(token),
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
      picks: new Map(),
      impostorTheme: impostorTheme ?? null,
      impostorToken,
      impostorAudioUrl: impostorTheme
        ? (this.mirror?.urlFor(impostorTheme.id) ?? audioPath(impostorToken!))
        : null,
      impostorStartRatio: Math.round(this.random() * START_RATIO_MAX * 1000) / 1000,
      roleHolders: null,
      impostors: [],
      impostor: null,
    };
  }

  private revokeRound(round: RoundState): void {
    this.media.revoke(round.token);
    if (round.videoToken) this.media.revoke(round.videoToken);
    if (round.impostorToken) this.media.revoke(round.impostorToken);
  }

  private emitPrepare(index: number): void {
    const round = this.rounds[index];
    if (!round) return;
    this.preparedRounds.add(index);
    if (this.isImpostor) {
      // Les rôles sont tirés à l'envoi de l'audio : chacun reçoit celui de sa chanson.
      if (!round.roleHolders) this.drawRoles(round);
      for (const id of this.players.keys()) {
        this.emitter.toPlayer(id, 'round:prepare', {
          round: index,
          url: this.audioUrlFor(round, id),
          startRatio: this.startRatioFor(round, id),
        });
      }
      return;
    }
    const audio: RoundAudio = {
      round: index,
      url: round.audioUrl,
      startRatio: round.startRatio,
    };
    this.broadcast('round:prepare', audio);
  }

  private buildReveal(): RoundReveal {
    const round = this.rounds[this.roundIndex]!;
    const { theme } = round;
    const anime = this.catalogue.getAnime(theme.animeId)!;
    const franchise = this.catalogue.getFranchise(anime.franchiseId)!;
    const { auction, impostor } = round;
    const results = [...this.players.values()].map(
      (player): PlayerRoundResult =>
        auction?.resultFor(player.id) ??
        impostor?.resultFor(player.id) ??
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
      // Plus ou moins et Imposteur : révélation avec les jaquettes, sans vidéo.
      video: this.isHigherLower || this.isImpostor ? null : theme.videoUrl,
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
      ...(impostor &&
        round.impostorTheme &&
        round.impostorToken && {
          impostor: {
            winner: impostor.result ?? 'impostors',
            civilSong: this.impostorSong(round.theme),
            impostorSong: this.impostorSong(round.impostorTheme),
            words: impostor.allWords(),
            players: impostor.results(),
            civilAudio: { url: round.audioUrl, startRatio: round.startRatio },
            impostorAudio: {
              url: round.impostorAudioUrl!,
              startRatio: round.impostorStartRatio,
            },
          },
        }),
    };
  }

  /** État, audio déjà annoncé et révélation en cours, pour un joueur qui (re)arrive. */
  private syncPlayer(id: string): void {
    this.emitter.toPlayer(id, 'game:state', this.snapshot(id));
    // Plus ou moins : la référence du tour (chanson précédente) reste réécoutable.
    const from = this.isHigherLower ? this.roundIndex - 1 : this.roundIndex;
    for (const index of [...this.preparedRounds].sort((a, b) => a - b)) {
      const round = this.rounds[index];
      if (index < from || !round) continue;
      this.emitter.toPlayer(id, 'round:prepare', {
        round: index,
        url: this.audioUrlFor(round, id),
        startRatio: this.startRatioFor(round, id),
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
    const players = [...this.players.values()].map((player): PlayerScore => {
      const eliminatedAt = this.eliminatedAt.get(player.id);
      return {
        id: player.id,
        pseudo: player.pseudo,
        score: player.score,
        // Sa propre coche n'a rien de secret (et sert à la reconnexion).
        // Plus ou moins : la coche indique qui a répondu au tour, jamais quoi.
        found:
          (!hideFound || player.id === forPlayer) &&
          (round?.auction
            ? round.auction.hasFound(player.id)
            : this.isHigherLower
              ? (round?.picks.has(player.id) ?? false)
              : (round?.results.get(player.id)?.correct ?? false)),
        connected: player.connected,
        ...(eliminatedAt !== undefined && { eliminatedAt }),
      };
    });
    return players.sort(this.isHigherLower ? compareHigherLower : (a, b) => b.score - a.score);
  }

  private connectedPlayers(): PlayerState[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  private everyoneReady(): boolean {
    return this.connectedPlayers().every((player) => this.isPlayerReady(player));
  }

  /**
   * Tous les participants connectés ont trouvé (ou sont éliminés, en Progressif ;
   * ont choisi, en Plus ou moins). En Playlist, qui a choisi la chanson ne répond
   * pas : il n'est pas attendu.
   */
  private everyoneDone(): boolean {
    const round = this.rounds[this.roundIndex]!;
    return this.connectedPlayers()
      .filter((player) => round.participants.has(player.id) && !round.choosers.includes(player.id))
      .every(
        (player) =>
          round.results.get(player.id)?.correct ||
          round.progress.get(player.id)?.eliminated ||
          round.picks.has(player.id),
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
