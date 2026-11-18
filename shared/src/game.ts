import { AUCTION, type AuctionResult, type AuctionTurn, type AuctionView } from './auction';
import { THEME_TYPES, type PopularityTier, type ThemeFilters, type ThemeType } from './catalogue';
import { IMPOSTOR, isVoteDuration, type ImpostorReveal, type ImpostorView } from './impostor';
import {
  HIGHER_LOWER,
  type HigherLowerPick,
  type HigherLowerReveal,
  type HigherLowerView,
} from './higherLower';
import { PLAYLIST, type PlaylistReveal } from './playlist';

/**
 * Modes de jeu :
 * - `classic` : 15 s d'écoute continue, points selon la rapidité ;
 * - `progressive` : extraits de plus en plus longs (façon Songspot), points selon le palier ;
 * - `playlist` : (multi) les joueurs choisissent les chansons, jouées avec les règles du Classique ;
 * - `auction` : (multi) chacun annonce la durée d'extrait qu'il lui faut, le plus audacieux répond ;
 * - `higherLower` : la nouvelle chanson vient-elle d'un anime plus ou moins populaire ? (élimination) ;
 * - `impostor` : (multi) 1 ou 2 imposteurs ont une autre chanson ; un mot chacun, puis on vote.
 */
export type GameModeId =
  'classic' | 'progressive' | 'playlist' | 'auction' | 'higherLower' | 'impostor';
export const GAME_MODES: readonly GameModeId[] = [
  'classic',
  'progressive',
  'higherLower',
  'playlist',
  'auction',
  'impostor',
];
export const SOLO_MODES: readonly GameModeId[] = ['classic', 'progressive', 'higherLower'];
export const ROOM_MODES: readonly GameModeId[] = GAME_MODES;

/** Joueurs connectés nécessaires pour lancer une partie dans ce mode. */
export function minPlayers(mode: GameModeId): number {
  if (mode === 'playlist') return PLAYLIST.minPlayers;
  if (mode === 'impostor') return IMPOSTOR.minPlayers;
  return mode === 'auction' ? AUCTION.minPlayers : 1;
}

export interface ModeTiming {
  /** Compte à rebours avant l'écoute (son de cloche). */
  countdownMs: number;
  /** Durée d'écoute / de réponse. */
  listenMs: number;
  /** Révélation et débrief. */
  revealMs: number;
}

export const MODE_TIMINGS: Record<GameModeId, ModeTiming> = {
  classic: { countdownMs: 3000, listenMs: 15_000, revealMs: 10_000 },
  progressive: { countdownMs: 3000, listenMs: 60_000, revealMs: 10_000 },
  playlist: { countdownMs: 3000, listenMs: 15_000, revealMs: 10_000 },
  // Enchères : `listenMs` = temps de réponse de celui qui a la main (voir AUCTION).
  auction: { countdownMs: 3000, listenMs: AUCTION.answerMs, revealMs: 10_000 },
  // Plus ou moins : `listenMs` = un tour après le premier (10 s d'extrait + 10 s pour choisir).
  higherLower: {
    countdownMs: 3000,
    listenMs: HIGHER_LOWER.snippetMs + HIGHER_LOWER.chooseMs,
    revealMs: 6000,
  },
  // Imposteur : `listenMs` = extrait de début de manche (la manche dure jusqu'à la victoire d'un camp).
  impostor: { countdownMs: 3000, listenMs: IMPOSTOR.listenMs, revealMs: 14_000 },
};

/**
 * Index de la première manche. En Plus ou moins, la manche N est le tour N : la
 * chanson 0 (A) ne sert que de première référence.
 */
export const firstRound = (mode: GameModeId): number => (mode === 'higherLower' ? 1 : 0);

/** Mode Progressif : durée des extraits, points et essais par palier. */
export const PROGRESSIVE = {
  tiersMs: [500, 1000, 5000, 15_000],
  tierPoints: [200, 150, 100, 50],
  attemptsPerTier: 3,
} as const;

export const PROGRESSIVE_LAST_TIER = PROGRESSIVE.tiersMs.length - 1;

/** Où en est un joueur dans la manche en mode Progressif. */
export interface TierProgress {
  /** Palier en cours (0 = 0,5 s). */
  tier: number;
  /** Essais restants sur ce palier. */
  attemptsLeft: number;
  /** Trois erreurs au dernier palier : plus de réponse possible pour cette manche. */
  eliminated: boolean;
}

export const INITIAL_PROGRESS: TierProgress = {
  tier: 0,
  attemptsLeft: PROGRESSIVE.attemptsPerTier,
  eliminated: false,
};

/** Barème du mode Classique : de 200 points (instantané) à 50 (dernière seconde). */
export const CLASSIC_SCORING = { max: 200, min: 50 } as const;
/** Bonus de précision (saison exacte, bon numéro d'OP/ED). */
export const BONUS_POINTS = 25;

/** Points du mode Classique selon le temps de réponse (décroissance linéaire). */
export function classicPoints(elapsedMs: number, listenMs: number): number {
  const ratio = Math.min(1, Math.max(0, elapsedMs / listenMs));
  return Math.round(CLASSIC_SCORING.max - (CLASSIC_SCORING.max - CLASSIC_SCORING.min) * ratio);
}

export const ROUNDS_MIN = 5;
export const ROUNDS_MAX = 30;
export const PSEUDO_MAX_LENGTH = 20;
export const POPULARITY_TIERS: readonly PopularityTier[] = [100, 500, 2000, 'all'];

export interface GameSettings {
  mode: GameModeId;
  /**
   * Nombre de manches (ignoré en Playlist, où toutes les chansons choisies sont jouées,
   * et en Plus ou moins, qui dure jusqu'à l'élimination).
   */
  rounds: number;
  /** Filtres du tirage (en Playlist : complément aléatoire ; seul le type s'applique aux choix). */
  filters: ThemeFilters;
  /** Playlist : chansons choisies par chaque joueur (1 à 10). */
  songsPerPlayer?: number;
  /** Imposteur : durée du vote (ms), au choix de l'hôte. */
  voteMs?: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'classic',
  rounds: 10,
  filters: { popularity: 500, types: ['OP', 'ED'] },
};

const YEAR_MIN = 1960;
const YEAR_MAX = 2100;

const toYear = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX
    ? value
    : undefined;

/**
 * Valide des réglages reçus d'un client (valeurs invalides → valeurs par défaut).
 * Renvoie `null` si l'objet est inexploitable.
 */
export function sanitizeSettings(input: unknown): GameSettings | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const rawFilters = (raw.filters ?? {}) as Record<string, unknown>;

  const rounds =
    typeof raw.rounds === 'number' && Number.isInteger(raw.rounds)
      ? Math.min(ROUNDS_MAX, Math.max(ROUNDS_MIN, raw.rounds))
      : DEFAULT_SETTINGS.rounds;

  const popularity = POPULARITY_TIERS.includes(rawFilters.popularity as PopularityTier)
    ? (rawFilters.popularity as PopularityTier)
    : DEFAULT_SETTINGS.filters.popularity;

  const types = Array.isArray(rawFilters.types)
    ? [...new Set(rawFilters.types.filter((t): t is ThemeType => THEME_TYPES.includes(t)))]
    : DEFAULT_SETTINGS.filters.types;

  let yearFrom = toYear(rawFilters.yearFrom);
  let yearTo = toYear(rawFilters.yearTo);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
    [yearFrom, yearTo] = [yearTo, yearFrom];
  }

  const filters: ThemeFilters = {
    popularity,
    types: types.length > 0 ? types : DEFAULT_SETTINGS.filters.types,
  };
  if (yearFrom !== undefined) filters.yearFrom = yearFrom;
  if (yearTo !== undefined) filters.yearTo = yearTo;

  const mode = GAME_MODES.includes(raw.mode as GameModeId)
    ? (raw.mode as GameModeId)
    : DEFAULT_SETTINGS.mode;
  const settings: GameSettings = { mode, rounds, filters };

  // Conservé hors Playlist pour ne pas perdre la valeur quand l'hôte change de mode.
  if (typeof raw.songsPerPlayer === 'number' && Number.isInteger(raw.songsPerPlayer)) {
    settings.songsPerPlayer = Math.min(
      PLAYLIST.songsMax,
      Math.max(PLAYLIST.songsMin, raw.songsPerPlayer),
    );
  } else if (mode === 'playlist') {
    settings.songsPerPlayer = PLAYLIST.songsDefault;
  }
  // Conservé hors Imposteur, comme `songsPerPlayer`.
  if (isVoteDuration(raw.voteMs)) settings.voteMs = raw.voteMs;
  else if (mode === 'impostor') settings.voteMs = IMPOSTOR.voteDefaultMs;
  return settings;
}

/** Pseudo nettoyé (espaces, longueur), « Joueur » par défaut. */
export function sanitizePseudo(input: unknown): string {
  const text = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, PSEUDO_MAX_LENGTH) || 'Joueur';
}

/** `bidding` et `answering` : mode Enchères (annonce secrète, réponse de celui qui a la main). */
export type GamePhase = 'countdown' | 'bidding' | 'listening' | 'answering' | 'reveal' | 'finished';

export interface PlayerScore {
  id: string;
  pseudo: string;
  score: number;
  /** A trouvé la bonne réponse pendant la manche en cours. */
  found: boolean;
  connected: boolean;
  /**
   * Plus ou moins : tour où le joueur a été éliminé (0 : arrivé en cours de partie,
   * il regarde) ; absent tant qu'il est en jeu. `score` compte ses bonnes réponses.
   */
  eliminatedAt?: number;
}

/** Audio d'une manche, envoyé à l'avance pour le préchargement. */
export interface RoundAudio {
  round: number;
  /** URL opaque du proxy audio (ne révèle rien sur la musique). */
  url: string;
  /** Point de départ, en fraction de la durée du morceau (0 à 1). */
  startRatio: number;
}

export interface GameSnapshot {
  gameId: string;
  /** Identifiant du joueur qui reçoit l'état. */
  you: string;
  settings: GameSettings;
  phase: GamePhase;
  /** Index de la manche en cours (0 = première). */
  round: number;
  totalRounds: number;
  /** Fin de la phase en cours (heure serveur, ms). */
  phaseEndsAt: number;
  players: PlayerScore[];
  /** Début de l'écoute de la manche en cours (pour reprendre l'extrait en cours de route). */
  listenStartedAt: number | null;
  /** Vidéo (opaque) de la manche en cours, si l'écoute a commencé. */
  videoUrl: string | null;
  /** Mode Progressif : progression du joueur dans la manche en cours. */
  progress: TierProgress | null;
  /** Mode Playlist : ce que le joueur voit de la manche en cours. */
  playlist: PlaylistRoundView | null;
  /** Mode Enchères : manche en cours vue par le joueur. */
  auction: AuctionView | null;
  /** Mode Plus ou moins : tour en cours vu par le joueur. */
  higherLower: HigherLowerView | null;
  /** Mode Imposteur : manche en cours vue par le joueur. */
  impostor: ImpostorView | null;
}

/** Manche en cours du mode Playlist, vue par un joueur (rien sur les choix des autres). */
export interface PlaylistRoundView {
  /** Le joueur a choisi cette chanson : il ne répond pas. */
  ownSong: boolean;
  /** Nombre anonyme de joueurs qui ont trouvé. */
  found: number;
  /** Son pari « Devine qui l'a choisie » (`null` : personne, tirée au hasard). */
  guess: string | null | undefined;
  /** Fenêtre pour deviner, ouverte quand tout le monde a trouvé. */
  guessWindowEndsAt: number | null;
}

/** Mode Playlist : détail des points d'un joueur pour la manche (le total est dans `points`). */
export interface PlaylistPoints {
  /** Le joueur avait choisi la chanson. */
  ownSong: boolean;
  /** Bonus « Chanson d'un joueur ». */
  foundBonus: number;
  /** Bonus « Devine qui l'a choisie ». */
  guessBonus: number;
  /** Points de qui a choisi la chanson. */
  chooserPoints: number;
}

export interface PlayerRoundResult {
  playerId: string;
  correct: boolean;
  points: number;
  /** Temps de réponse depuis le début de l'écoute. */
  elapsedMs: number | null;
  seasonExact: boolean;
  sequenceExact: boolean;
  /** Mode Progressif : palier auquel la réponse a été trouvée. */
  tier: number | null;
  /** Mode Playlist : détail des points. */
  playlist?: PlaylistPoints;
  /** Mode Enchères : annonce et issue (`points` est alors négatif en cas d'erreur). */
  auction?: AuctionResult;
  /** Mode Plus ou moins : choix du joueur (null : pas de réponse). */
  higherLower?: { pick: HigherLowerPick | null };
}

export interface LocalizedTitle {
  fr: string;
  en: string;
}

export interface RoundReveal {
  round: number;
  phaseEndsAt: number;
  /**
   * Vidéo de la chanson, lien direct AnimeThemes : chargée par le navigateur à la
   * révélation seulement (la réponse est donnée, le nom du fichier ne trahit plus rien),
   * sans passer par notre serveur, dont la bande passante est limitée.
   */
  video: string | null;
  anime: {
    id: number;
    title: LocalizedTitle;
    romaji: string;
    year: number | null;
    /** Jaquette (affichée tant que la vidéo charge, ou à sa place). */
    coverUrl: string | null;
    coverColor: string | null;
  };
  franchise: { id: number; title: LocalizedTitle };
  theme: {
    type: ThemeType;
    sequence: number;
    slug: string;
    song: string | null;
    artists: string | null;
  };
  results: PlayerRoundResult[];
  players: PlayerScore[];
  /** Mode Playlist : qui a choisi la chanson, paris, points. */
  playlist?: PlaylistReveal;
  /** Mode Enchères : ordre de passage final, avec les propositions fausses. */
  auction?: AuctionTurn[];
  /** Mode Plus ou moins : les deux chansons, l'écart, les choix et les éliminations. */
  higherLower?: HigherLowerReveal;
  /** Mode Imposteur : les deux chansons, les rôles, les mots et les points. */
  impostor?: ImpostorReveal;
}

export type AnswerResult =
  | {
      accepted: false;
      reason:
        | 'not_listening'
        | 'already_found'
        | 'not_in_game'
        | 'eliminated'
        | 'own_song'
        | 'not_your_turn';
    }
  | {
      accepted: true;
      correct: boolean;
      points: number;
      seasonExact: boolean;
      sequenceExact: boolean;
      /** Mode Progressif : progression après cette réponse (palier, essais restants…). */
      progress?: TierProgress;
    };

export type GameEndReason = 'completed' | 'audio_unavailable';

export interface GameEnd {
  reason: GameEndReason;
  players: PlayerScore[];
}

export type StartGameError = 'invalid_settings' | 'not_enough_themes' | 'catalogue_unavailable';
