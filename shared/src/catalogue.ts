/**
 * Types du catalogue partagés entre le serveur et le client.
 */

/** Opening, ending ou insert song. */
export type ThemeType = 'OP' | 'ED' | 'IN';

export const THEME_TYPES: readonly ThemeType[] = ['OP', 'ED', 'IN'];

/**
 * Index des titres envoyé au client pour une autocomplétion instantanée,
 * sans requête réseau à chaque frappe. Format compact (clés courtes).
 */
export interface TitleIndex {
  /** Version du catalogue (change à chaque synchro). */
  version: string;
  entries: TitleEntry[];
}

export interface TitleEntry {
  /** `a` = un anime (une saison), `f` = une franchise regroupant plusieurs animes. */
  k: 'a' | 'f';
  /** Identifiant de l'anime ou de la franchise selon `k`. */
  id: number;
  /** Franchise de rattachement. */
  f: number;
  /** Titre affiché en français (repli : anglais puis romaji). */
  fr: string;
  /** Titre affiché en anglais (repli : romaji). */
  en: string;
  /** Titres acceptés, normalisés (voir `normalize`). */
  t: string[];
  /** Popularité (sert à départager les suggestions). */
  p: number;
  /** 1 si l'anime appartient à une franchise de plusieurs saisons (bonus saison possible). */
  s?: 1;
  /**
   * 1 si l'anime n'a qu'un opening et qu'un ending : le numéro d'OP/ED n'apporte rien,
   * le champ « N° OP/ED » est masqué une fois l'anime choisi.
   */
  u?: 1;
}

/** Réponse envoyée par un joueur. */
export interface AnswerPayload {
  /** Texte tapé. */
  text: string;
  /** Suggestion choisie dans l'autocomplétion, si le joueur en a sélectionné une. */
  pick?: { kind: 'anime' | 'franchise'; id: number };
  /** Numéro d'OP/ED facultatif (bonus). */
  sequence?: number;
}

/** Résultat de la validation d'une réponse. */
export interface AnswerVerdict {
  correct: boolean;
  /** La saison exacte a été donnée (et la franchise en a plusieurs). */
  seasonExact: boolean;
  /** Le bon numéro d'OP/ED a été donné. */
  sequenceExact: boolean;
}

/** Palier de popularité : top N animes selon AniList, ou tout le catalogue. */
export type PopularityTier = 100 | 500 | 2000 | 'all';

/** Filtres choisis pour une partie. */
export interface ThemeFilters {
  popularity: PopularityTier;
  types: ThemeType[];
  yearFrom?: number;
  yearTo?: number;
}

export interface CatalogueStats {
  version: string;
  generatedAt: string;
  anime: number;
  franchises: number;
  themes: number;
}
