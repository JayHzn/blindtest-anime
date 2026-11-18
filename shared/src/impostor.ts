/**
 * Mode Imposteur (v2, multi uniquement, style Undercover) : la majorité (les civils)
 * a la chanson X, 1 ou 2 imposteurs une chanson Y proche. Personne ne connaît son
 * rôle. Chacun donne un mot à son tour, puis tout le monde vote ; le plus voté est
 * éliminé et son rôle révélé, jusqu'à la victoire d'un camp.
 */
import { normalize } from './text';
import type { ThemeType } from './catalogue';
import type { LocalizedTitle } from './game';

export const IMPOSTOR = {
  /** Joueurs connectés nécessaires pour lancer une partie. */
  minPlayers: 4,
  /** À partir de ce nombre de joueurs : 2 imposteurs. */
  twoImpostorsFrom: 6,
  /** Extrait du début de manche (réécoutable ensuite). */
  listenMs: 15_000,
  /** Temps pour donner son mot. */
  wordMs: 20_000,
  /** Durées de vote proposées à l'hôte, et celle par défaut. */
  voteOptionsMs: [15_000, 20_000, 30_000, 45_000],
  voteDefaultMs: 30_000,
  /** Revote entre les ex æquo. */
  revoteMs: 15_000,
  /** Affichage d'une élimination (ou de « personne n'est éliminé »). */
  eliminationMs: 6000,
  /** Civils gagnants : temps pour deviner la chanson de l'imposteur. */
  guessMs: 15_000,
  /** Tours d'indices au plus : au-delà, les imposteurs encore en jeu gagnent. */
  maxTours: 6,
  /** Longueur maximale d'un mot. */
  wordMaxLength: 24,
  /** Avance de l'heure de départ commune de l'extrait. */
  syncLeadMs: 800,
  /** Points : civils gagnants (chacun), chanson de l'imposteur devinée, imposteur gagnant. */
  civilWinPoints: 100,
  guessPoints: 100,
  impostorWinPoints: 300,
} as const;

/** Nombre d'imposteurs selon le nombre de joueurs de la manche. */
export const impostorCount = (players: number): number =>
  players >= IMPOSTOR.twoImpostorsFrom ? 2 : 1;

export function isVoteDuration(value: unknown): value is number {
  return typeof value === 'number' && (IMPOSTOR.voteOptionsMs as readonly number[]).includes(value);
}

export type ImpostorWordError = 'invalid' | 'title' | 'used' | 'not_your_turn';

/**
 * Mot proposé : un seul mot (lettres, chiffres, tiret, apostrophe), refusé s'il est
 * dans le titre de sa chanson ou déjà donné dans la manche (comparaison normalisée).
 * Renvoie le mot nettoyé, ou la raison du refus.
 */
export function checkWord(
  input: unknown,
  titleWords: ReadonlySet<string>,
  usedWords: ReadonlySet<string>,
): { ok: true; word: string; key: string } | { ok: false; reason: ImpostorWordError } {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid' };
  const word = input.trim();
  if (!word || word.length > IMPOSTOR.wordMaxLength || /\s/.test(word)) {
    return { ok: false, reason: 'invalid' };
  }
  const parts = normalize(word).split(' ').filter(Boolean);
  const key = parts.join('');
  if (!key) return { ok: false, reason: 'invalid' };
  // « Naruto », mais aussi « naruto-kun » : chaque morceau est comparé au titre.
  if (titleWords.has(key) || parts.some((part) => titleWords.has(part))) {
    return { ok: false, reason: 'title' };
  }
  if (usedWords.has(key)) return { ok: false, reason: 'used' };
  return { ok: true, word, key };
}

/** Mots d'un titre, normalisés (pour refuser « naruto » quand la chanson vient de Naruto). */
export function titleWordsOf(titles: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const title of titles) {
    // Les mots très courts (« no », « wa »…) ne sont pas interdits.
    for (const part of normalize(title).split(' ')) if (part.length >= 3) words.add(part);
  }
  return words;
}

/** Chanson telle qu'un joueur la voit (la sienne pendant la manche, les deux à la révélation). */
export interface ImpostorSong {
  title: LocalizedTitle;
  romaji: string;
  year: number | null;
  coverUrl: string | null;
  coverColor: string | null;
  type: ThemeType;
  sequence: number;
  song: string | null;
  artists: string | null;
}

/**
 * - `listening` : extrait de 15 s ;
 * - `words` : chacun son tour donne un mot ;
 * - `voting` / `revote` : vote (revote entre ex æquo) ;
 * - `elimination` : le plus voté est éliminé, son rôle révélé ;
 * - `guessing` : civils gagnants, ils devinent la chanson de l'imposteur ;
 * - `done` : manche terminée.
 */
export type ImpostorStep =
  'listening' | 'words' | 'voting' | 'revote' | 'elimination' | 'guessing' | 'done';

export interface ImpostorWord {
  playerId: string;
  tour: number;
  /** null : pas de mot à temps (ou joueur absent). */
  word: string | null;
}

export interface ImpostorElimination {
  playerId: string;
  tour: number;
  impostor: boolean;
}

export interface ImpostorTally {
  playerId: string;
  votes: number;
}

export type ImpostorWinner = 'civils' | 'impostors';

/** Manche vue par un joueur : jamais le rôle des autres avant leur élimination, ni l'autre chanson. */
export interface ImpostorView {
  step: ImpostorStep;
  stepEndsAt: number;
  /** Tour d'indices (1 = premier). */
  tour: number;
  /** Heure serveur de départ de l'extrait (écoute). */
  listenStartsAt: number;
  /** Sa chanson (null : arrivé en cours de manche, il regarde). */
  song: ImpostorSong | null;
  participants: string[];
  /** Joueurs encore en jeu dans la manche. */
  alive: string[];
  impostorCount: number;
  /** Ordre de passage du tour en cours, et le joueur qui a la parole. */
  order: string[];
  turn: number;
  words: ImpostorWord[];
  /** Joueurs qui ont voté (jamais contre qui). */
  voters: string[];
  yourVote: string | null;
  /** Revote : les ex æquo (ils ne votent pas). */
  candidates: string[];
  eliminations: ImpostorElimination[];
  /** Dernier vote : total par joueur, et le joueur éliminé (null : personne). */
  tally: ImpostorTally[];
  lastEliminated: string | null;
  winner: ImpostorWinner | null;
  /** Civils gagnants : joueurs qui ont déjà deviné, et son propre essai (null : pas encore). */
  guessers: string[];
  yourGuess: boolean | null;
}

/** Détail d'un joueur dans la révélation de fin de manche. */
export interface ImpostorPlayerResult {
  playerId: string;
  impostor: boolean;
  /** Tour d'élimination (null : encore en jeu à la fin). */
  eliminatedAt: number | null;
  /** Chanson de l'imposteur devinée (null : n'a pas essayé). */
  guessed: boolean | null;
  points: number;
}

export interface ImpostorReveal {
  winner: ImpostorWinner;
  civilSong: ImpostorSong;
  impostorSong: ImpostorSong;
  words: ImpostorWord[];
  players: ImpostorPlayerResult[];
  /** Audios (opaques) des deux chansons, pour les réécouter. */
  civilAudio: { url: string; startRatio: number };
  impostorAudio: { url: string; startRatio: number };
}
