import type {
  AnimeRow,
  CatalogueData,
  FranchiseRow,
  ThemeRow,
  TitleRow,
} from '../../src/catalogue/types';
import { THEME_TYPES, type ThemeType } from '@blindtest/shared';
import { parseFrenchLabel } from '../../src/catalogue/titles';
import type { AnilistMedia } from './anilist';
import type { AtAnime, AtTheme, AtVideo } from './animethemes';
import type { WikidataLabel } from './wikidata';

export interface SyncSources {
  generatedAt: string;
  anime: AtAnime[];
  anilist: AnilistMedia[];
  wikidata: WikidataLabel[];
}

/**
 * Préférence de vidéo : sans scènes d'épisode, puis 720p ou moins, puis sans crédits,
 * puis la plus légère. La vidéo est chargée par chaque navigateur au moment de la
 * révélation : un fichier 2 à 3 fois plus léger compte plus que des crédits à l'écran.
 */
function videoScore(video: AtVideo): number {
  let score = 0;
  if (video.overlap === 'NONE') score += 8;
  if ((video.resolution ?? 1080) <= 720) score += 4;
  if (video.nc) score += 2;
  // Départage : résolution la plus basse (au moins 360p).
  const resolution = video.resolution ?? 1080;
  if (resolution >= 360) score += (1080 - resolution) / 1000;
  return score;
}

/** Convertit les thèmes AnimeThemes en musiques jouables (version originale avec audio). */
export function mapThemes(animeId: number, themes: AtTheme[]): ThemeRow[] {
  const rows: ThemeRow[] = [];
  for (const theme of themes) {
    const type = theme.type;
    if (!isThemeType(type)) continue;
    // Les groupes correspondent aux doublages / versions alternatives : on garde l'original.
    if (theme.group) continue;

    const entries = theme.entries
      .filter((entry) => !entry.nsfw)
      .sort((a, b) => a.version - b.version);

    for (const entry of entries) {
      const videos = entry.videos.nodes.filter((video) => video.audio?.link);
      if (videos.length === 0) continue;
      const video = videos.reduce(
        (best, v) => (videoScore(v) > videoScore(best) ? v : best),
        videos[0]!,
      );
      const sequence = theme.sequence ?? 1;
      const artists = (theme.song?.staff ?? [])
        .filter((staff) => staff.role === 'Performance')
        .sort((a, b) => a.relevance - b.relevance)
        .map((staff) => staff.artist.name.main)
        .join(', ');
      rows.push({
        id: theme.id,
        animeId,
        type,
        sequence,
        slug: theme.slug || `${type}${sequence}`,
        songTitle: theme.song?.title.romaji ?? null,
        artists: artists || null,
        audioUrl: video.audio!.link,
        videoUrl: video.link,
        videoResolution: video.resolution,
        spoiler: entry.spoiler,
      });
      break;
    }
  }
  return rows;
}

const isThemeType = (type: string): type is ThemeType =>
  (THEME_TYPES as readonly string[]).includes(type);

export const externalId = (anime: AtAnime, site: 'ANILIST' | 'MAL'): number | null =>
  anime.resources.nodes.find((resource) => resource.site === site)?.externalId ?? null;

/** Choisit la valeur la plus fréquente (la première en cas d'égalité). */
function mostFrequent(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Public cible retenu s'il est jugé pertinent par AniList (rang du tag, en %). */
const DEMOGRAPHIC_MIN_RANK = 60;

/**
 * Genres AniList, du plus parlant au plus courant : AniList les liste par ordre
 * alphabétique, ce qui donnerait « Action » à la moitié du catalogue.
 */
const GENRE_PRIORITY = [
  'Mahou Shoujo',
  'Mecha',
  'Sports',
  'Music',
  'Horror',
  'Slice of Life',
  'Psychological',
  'Mystery',
  'Thriller',
  'Romance',
  'Ecchi',
  'Sci-Fi',
  'Supernatural',
  'Fantasy',
  'Drama',
  'Comedy',
  'Adventure',
  'Action',
];

/**
 * Genre affiché dans l'indice du mode Enchères : le public cible (Shounen, Seinen,
 * Shoujo, Josei, Kids) quand AniList le donne, sinon le genre le plus parlant.
 */
export function pickGenre(media: AnilistMedia | undefined): string | null {
  if (!media) return null;
  const demographic = (media.tags ?? [])
    .filter((tag) => tag.category === 'Demographic' && (tag.rank ?? 0) >= DEMOGRAPHIC_MIN_RANK)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
  if (demographic) return demographic.name;
  const genres = new Set(media.genres ?? []);
  return GENRE_PRIORITY.find((genre) => genres.has(genre)) ?? null;
}

/** Assemble les sources (AnimeThemes, AniList, Wikidata) en un catalogue. */
export function buildCatalogueData(sources: SyncSources): CatalogueData {
  const anilistById = new Map(sources.anilist.map((media) => [media.id, media]));
  const wikidataById = new Map<number, { label: string | null; seriesLabel: string | null }>();
  for (const row of sources.wikidata) {
    const current = wikidataById.get(row.anilistId) ?? { label: null, seriesLabel: null };
    wikidataById.set(row.anilistId, {
      label: current.label ?? row.label,
      seriesLabel: current.seriesLabel ?? row.seriesLabel,
    });
  }

  // 1. Animes jouables (au moins une musique avec audio)
  const playable = [...sources.anime]
    .sort((a, b) => a.id - b.id)
    .map((anime) => ({ anime, themes: mapThemes(anime.id, anime.themes) }))
    .filter((item) => item.themes.length > 0);

  // 2. Franchises : la plus grande série de l'anime, sinon l'anime seul
  const seriesSize = new Map<number, number>();
  for (const { anime } of playable) {
    for (const series of anime.series.nodes) {
      seriesSize.set(series.id, (seriesSize.get(series.id) ?? 0) + 1);
    }
  }

  const franchiseByKey = new Map<string, FranchiseRow>();
  const franchiseOfAnime = new Map<number, FranchiseRow>();
  for (const { anime } of playable) {
    const series = [...anime.series.nodes].sort(
      (a, b) => (seriesSize.get(b.id) ?? 0) - (seriesSize.get(a.id) ?? 0) || a.id - b.id,
    )[0];
    const key = series ? `s:${series.id}` : `a:${anime.id}`;
    let franchise = franchiseByKey.get(key);
    if (!franchise) {
      franchise = {
        id: franchiseByKey.size + 1,
        seriesId: series?.id ?? null,
        name: series?.title.romaji ?? anime.title.romaji,
        nameFr: null,
      };
      franchiseByKey.set(key, franchise);
    }
    franchiseOfAnime.set(anime.id, franchise);
  }

  // 3. Animes, titres et votes pour le nom français de chaque franchise
  const animeRows: AnimeRow[] = [];
  const titles: TitleRow[] = [];
  const frenchVotes = new Map<number, string[]>();

  for (const { anime } of playable) {
    const franchise = franchiseOfAnime.get(anime.id)!;
    const anilistId = externalId(anime, 'ANILIST');
    const media = anilistId ? anilistById.get(anilistId) : undefined;
    const wiki = anilistId ? wikidataById.get(anilistId) : undefined;
    const french = wiki?.label ? parseFrenchLabel(wiki.label) : null;

    const votes = frenchVotes.get(franchise.id) ?? [];
    const frenchBase = wiki?.seriesLabel ?? french?.base;
    if (frenchBase) votes.push(frenchBase);
    frenchVotes.set(franchise.id, votes);

    animeRows.push({
      id: anime.id,
      slug: anime.slug,
      franchiseId: franchise.id,
      name: anime.title.romaji,
      titleRomaji: media?.title.romaji ?? null,
      titleEn: media?.title.english ?? anime.title.english,
      titleFr: french?.display ?? null,
      year: anime.year,
      season: anime.season,
      mediaFormat: anime.format,
      anilistId,
      malId: externalId(anime, 'MAL'),
      popularity: media?.popularity ?? 0,
      popularityRank: 0,
      coverUrl: media?.coverImage?.extraLarge ?? null,
      coverColor: media?.coverImage?.color ?? null,
      genre: pickGenre(media),
    });

    const animeTitles = [
      anime.title.romaji,
      anime.title.english,
      media?.title.romaji,
      media?.title.english,
      french?.display,
      ...anime.synonyms.map((synonym) => synonym.text),
    ];
    for (const title of new Set(animeTitles)) {
      if (title && title.trim()) titles.push({ ownerKind: 'anime', ownerId: anime.id, title });
    }
  }

  const franchises = [...franchiseByKey.values()];
  for (const franchise of franchises) {
    franchise.nameFr = mostFrequent(frenchVotes.get(franchise.id) ?? []);
    for (const title of new Set([franchise.name, franchise.nameFr])) {
      if (title) titles.push({ ownerKind: 'franchise', ownerId: franchise.id, title });
    }
  }

  // 4. Rang de popularité (1 = le plus populaire)
  [...animeRows]
    .sort((a, b) => b.popularity - a.popularity || a.id - b.id)
    .forEach((row, index) => {
      row.popularityRank = index + 1;
    });

  return {
    generatedAt: sources.generatedAt,
    franchises,
    anime: animeRows,
    themes: playable.flatMap((item) => item.themes),
    titles,
  };
}
