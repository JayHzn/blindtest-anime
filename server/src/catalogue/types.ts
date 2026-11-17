import type { ThemeType } from '@blindtest/shared';

/**
 * Données du catalogue telles que produites par la synchro et stockées en SQLite.
 */
export interface CatalogueData {
  generatedAt: string;
  franchises: FranchiseRow[];
  anime: AnimeRow[];
  themes: ThemeRow[];
  titles: TitleRow[];
}

/** Une franchise = une série AnimeThemes, ou un anime isolé sans série. */
export interface FranchiseRow {
  id: number;
  seriesId: number | null;
  name: string;
  nameFr: string | null;
}

export interface AnimeRow {
  /** Identifiant AnimeThemes. */
  id: number;
  slug: string;
  franchiseId: number;
  /** Titre principal AnimeThemes (en général romaji). */
  name: string;
  titleRomaji: string | null;
  titleEn: string | null;
  titleFr: string | null;
  year: number | null;
  season: string | null;
  mediaFormat: string | null;
  anilistId: number | null;
  malId: number | null;
  /** Nombre de membres AniList (0 si inconnu). */
  popularity: number;
  /** 1 = le plus populaire. */
  popularityRank: number;
  /** Jaquette AniList (repli de la vidéo à la révélation). */
  coverUrl: string | null;
  /** Couleur dominante de la jaquette (ex. « #e4a15d »). */
  coverColor: string | null;
  /**
   * Indice du mode Enchères : public cible AniList (« Shounen »…) sinon genre
   * (« Romance »…), en anglais tel qu'AniList le donne ; traduit par le client.
   */
  genre: string | null;
}

export interface ThemeRow {
  /** Identifiant AnimeThemes du thème. */
  id: number;
  animeId: number;
  type: ThemeType;
  /** Numéro de l'OP/ED (1 si AnimeThemes ne le précise pas). */
  sequence: number;
  /** Ex. « OP1 », « ED2 ». */
  slug: string;
  songTitle: string | null;
  artists: string | null;
  audioUrl: string;
  videoUrl: string | null;
  videoResolution: number | null;
  spoiler: boolean;
}

/** Titre accepté comme réponse, rattaché à un anime ou à une franchise. */
export interface TitleRow {
  ownerKind: 'anime' | 'franchise';
  ownerId: number;
  title: string;
}
