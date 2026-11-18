/**
 * Mode « Le bon OP » : on voit un anime (titre, jaquette, OP ou ED), on écoute
 * 4 courts extraits du même type, et on retrouve le sien. Les 3 autres viennent
 * de séries proches (même type, même époque, popularité voisine).
 */
import type { ThemeType } from './catalogue';
import { classicPoints, type LocalizedTitle } from './game';

export const RIGHT_OP = {
  /** Extraits proposés par manche. */
  options: 4,
  /** Durée de chaque extrait, joués à la suite au début de la manche. */
  snippetMs: 4000,
  /** Décompte après les extraits (réécoute libre), pendant lequel les points baissent. */
  chooseMs: 15_000,
} as const;

/** Écoute des 4 extraits à la suite : pas de décompte pendant ce temps. */
export const RIGHT_OP_LISTEN_MS = RIGHT_OP.options * RIGHT_OP.snippetMs;

/** Durée totale d'une manche : écoute des extraits, puis décompte. */
export const RIGHT_OP_ROUND_MS = RIGHT_OP_LISTEN_MS + RIGHT_OP.chooseMs;

/**
 * Points d'une bonne réponse selon le moment du choix (depuis le début de l'écoute) :
 * 200 pendant l'écoute des extraits, puis de 200 à 50 pendant le décompte.
 */
export function rightOpPoints(elapsedMs: number): number {
  return classicPoints(Math.max(0, elapsedMs - RIGHT_OP_LISTEN_MS), RIGHT_OP.chooseMs);
}

/** Index audio d'un extrait (le client et le serveur indexent l'audio par ce numéro). */
export const rightOpAudioKey = (round: number, slot: number): number =>
  round * RIGHT_OP.options + slot;

/** Manche et extrait d'un index audio. */
export const rightOpSlotOf = (key: number): { round: number; slot: number } => ({
  round: Math.floor(key / RIGHT_OP.options),
  slot: key % RIGHT_OP.options,
});

export const isRightOpSlot = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < RIGHT_OP.options;

/** L'anime de la manche, montré pendant l'écoute. */
export interface RightOpAnime {
  title: LocalizedTitle;
  coverUrl: string | null;
  coverColor: string | null;
  type: ThemeType;
}

/** Manche en cours vue par un joueur (rien sur l'extrait juste avant la révélation). */
export interface RightOpView {
  anime: RightOpAnime;
  /** Joueurs qui ont déjà répondu (pas leur choix). */
  answered: string[];
  /** Son choix (index de l'extrait), `null` s'il n'a pas encore choisi. */
  yourPick: number | null;
  /** Son résultat, connu de lui seul dès qu'il a choisi. */
  yourResult: { correct: boolean; points: number } | null;
}

/** Réponse au choix d'un extrait (`null` : refusé). */
export type RightOpPickResult = { correct: boolean; points: number } | null;

/** Un extrait à la révélation. */
export interface RightOpOption {
  title: LocalizedTitle;
  song: string | null;
  artists: string | null;
  year: number | null;
  correct: boolean;
}

export interface RightOpReveal {
  options: RightOpOption[];
  /** Index de l'extrait juste. */
  answer: number;
  /** Choix de chaque joueur qui a répondu. */
  picks: { playerId: string; index: number }[];
}
