/**
 * Mode Plus ou moins (v2, solo et multi) : la nouvelle chanson vient-elle d'un anime
 * plus ou moins populaire (membres AniList) que la référence ? Au tour 1, deux
 * chansons inconnues (A puis B) ; ensuite, la chanson du tour devient la référence.
 * Une erreur (ou un silence) élimine ; en solo, elle termine la série.
 */
import type { ThemeType } from './catalogue';
import type { LocalizedTitle, PlayerScore } from './game';

export const HIGHER_LOWER = {
  /** Durée de chaque extrait. */
  snippetMs: 10_000,
  /** Temps pour choisir après la fin de l'extrait de la nouvelle chanson. */
  chooseMs: 10_000,
  /** Nombre maximal de tours : au-delà, les joueurs encore en jeu finissent ex æquo. */
  maxTours: 30,
  /** Écart minimal entre deux popularités (jamais deux animes à égalité). */
  minRatio: 1.1,
  /** Tolérance sur l'ouverture du choix (décalage d'horloge entre navigateur et serveur). */
  pickToleranceMs: 300,
} as const;

/** Choix d'un joueur : la nouvelle chanson est plus (`higher`) ou moins (`lower`) populaire. */
export type HigherLowerPick = 'higher' | 'lower';

export function isHigherLowerPick(value: unknown): value is HigherLowerPick {
  return value === 'higher' || value === 'lower';
}

/** Écart de popularité autorisé pour un tour (`max` null : pas de plafond). */
export interface RatioWindow {
  min: number;
  max: number | null;
}

/**
 * Écart entre la référence et la nouvelle chanson, de plus en plus serré :
 * ≥ ×1,5 (tours 1 à 3), ×1,3 à ×3 (4 à 6), ×1,2 à ×2 (7 à 9), ×1,1 à ×1,5 (10 et plus).
 */
export function ratioWindow(tour: number): RatioWindow {
  if (tour <= 3) return { min: 1.5, max: null };
  if (tour <= 6) return { min: 1.3, max: 3 };
  if (tour <= 9) return { min: 1.2, max: 2 };
  return { min: 1.1, max: 1.5 };
}

/** Rapport entre deux popularités (≥ 1), ou 0 si l'une est inconnue. */
export function popularityRatio(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.max(a, b) / Math.min(a, b);
}

export function inRatioWindow(ratio: number, window: RatioWindow): boolean {
  return ratio >= window.min && (window.max === null || ratio <= window.max);
}

/** Durée d'un tour : A puis B puis le choix (tour 1), ou la nouvelle chanson puis le choix. */
export function higherLowerListenMs(tour: number): number {
  const snippets = tour === 1 ? 2 : 1;
  return snippets * HIGHER_LOWER.snippetMs + HIGHER_LOWER.chooseMs;
}

/** Le choix s'ouvre dès que la nouvelle chanson commence (au tour 1 : quand B commence). */
export function pickOpensAfterMs(tour: number): number {
  return tour === 1 ? HIGHER_LOWER.snippetMs : 0;
}

/** Une chanson et la popularité de son anime, telles qu'on les montre. */
export interface HigherLowerCard {
  title: LocalizedTitle;
  romaji: string;
  year: number | null;
  coverUrl: string | null;
  coverColor: string | null;
  type: ThemeType;
  sequence: number;
  song: string | null;
  artists: string | null;
  /** Membres AniList de l'anime. */
  popularity: number;
}

/** Tour en cours vu par un joueur. */
export interface HigherLowerView {
  /** Numéro du tour (1 = A contre B). */
  tour: number;
  /** Référence affichée en clair (null au tour 1 : A et B sont inconnues). */
  reference: HigherLowerCard | null;
  window: RatioWindow;
  /** Choix envoyé par le joueur (définitif). */
  yourPick: HigherLowerPick | null;
}

export interface HigherLowerPickResult {
  playerId: string;
  /** null : pas de réponse à temps (compte comme une erreur). */
  pick: HigherLowerPick | null;
  correct: boolean;
}

/** Révélation d'un tour. */
export interface HigherLowerReveal {
  tour: number;
  /** Référence du tour (A au tour 1). */
  reference: HigherLowerCard;
  /** Nouvelle chanson (B au tour 1) : elle devient la référence du tour suivant. */
  challenger: HigherLowerCard;
  ratio: number;
  /** Bonne réponse pour la nouvelle chanson. */
  answer: HigherLowerPick;
  /** Choix des joueurs encore en jeu au début du tour. */
  picks: HigherLowerPickResult[];
  /** Joueurs éliminés à ce tour. */
  eliminated: string[];
  /** Tout le monde s'est trompé : personne n'est éliminé (multi). */
  allWrong: boolean;
  /** Dernier tour de la partie. */
  gameOver: boolean;
}

/** Joueur encore en jeu (ni éliminé, ni arrivé en cours de partie). */
export const isAlive = (player: Pick<PlayerScore, 'eliminatedAt'>): boolean =>
  player.eliminatedAt === undefined || player.eliminatedAt === null;

/**
 * Classement : encore en jeu d'abord, puis selon le tour d'élimination (le plus
 * tardif d'abord), puis le nombre de bonnes réponses.
 */
export function compareHigherLower(a: PlayerScore, b: PlayerScore): number {
  const outA = isAlive(a) ? Number.POSITIVE_INFINITY : a.eliminatedAt!;
  const outB = isAlive(b) ? Number.POSITIVE_INFINITY : b.eliminatedAt!;
  if (outA !== outB) return outB > outA ? 1 : -1;
  return b.score - a.score;
}
