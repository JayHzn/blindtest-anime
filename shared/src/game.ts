import { THEME_TYPES, type PopularityTier, type ThemeFilters, type ThemeType } from './catalogue';

/** Modes de jeu. Seul « classic » existe pour l'instant (Progressif : étape 4). */
export type GameModeId = 'classic';

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
  rounds: number;
  filters: ThemeFilters;
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

  return { mode: 'classic', rounds, filters };
}

/** Pseudo nettoyé (espaces, longueur), « Joueur » par défaut. */
export function sanitizePseudo(input: unknown): string {
  const text = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, PSEUDO_MAX_LENGTH) || 'Joueur';
}

export type GamePhase = 'countdown' | 'listening' | 'reveal' | 'finished';

export interface PlayerScore {
  id: string;
  pseudo: string;
  score: number;
  /** A trouvé la bonne réponse pendant la manche en cours. */
  found: boolean;
  connected: boolean;
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
}

export interface PlayerRoundResult {
  playerId: string;
  correct: boolean;
  points: number;
  /** Temps de réponse depuis le début de l'écoute. */
  elapsedMs: number | null;
  seasonExact: boolean;
  sequenceExact: boolean;
}

export interface LocalizedTitle {
  fr: string;
  en: string;
}

export interface RoundReveal {
  round: number;
  phaseEndsAt: number;
  anime: { id: number; title: LocalizedTitle; romaji: string; year: number | null };
  franchise: { id: number; title: LocalizedTitle };
  theme: {
    type: ThemeType;
    sequence: number;
    slug: string;
    song: string | null;
    artists: string | null;
  };
  /** Vidéo de l'opening (CDN AnimeThemes), révélée seulement maintenant. */
  videoUrl: string | null;
  results: PlayerRoundResult[];
  players: PlayerScore[];
}

export type AnswerResult =
  | { accepted: false; reason: 'not_listening' | 'already_found' | 'not_in_game' }
  | {
      accepted: true;
      correct: boolean;
      points: number;
      seasonExact: boolean;
      sequenceExact: boolean;
    };

export type GameEndReason = 'completed' | 'audio_unavailable';

export interface GameEnd {
  reason: GameEndReason;
  players: PlayerScore[];
}

export type StartGameError = 'invalid_settings' | 'not_enough_themes' | 'catalogue_unavailable';
