import { fetchJson, RateLimiter } from './http';

/**
 * Client de l'API GraphQL AnimeThemes (https://rs.animethemes.moe/graphql).
 * L'ancienne API JSON:API (api.animethemes.moe) est dépréciée.
 */

export interface AtAnime {
  id: number;
  slug: string;
  year: number | null;
  season: string | null;
  format: string | null;
  title: { romaji: string; english: string | null };
  synonyms: { text: string }[];
  series: { nodes: { id: number; slug: string; title: { romaji: string } }[] };
  resources: { nodes: { site: string; externalId: number | null }[] };
  themes: AtTheme[];
}

export interface AtTheme {
  id: number;
  type: string;
  sequence: number | null;
  slug: string;
  group: { slug: string } | null;
  song: {
    title: { romaji: string | null };
    staff: { role: string; relevance: number; artist: { name: { main: string } } }[];
  } | null;
  entries: AtEntry[];
}

export interface AtEntry {
  version: number;
  nsfw: boolean;
  spoiler: boolean;
  videos: { nodes: AtVideo[] };
}

export interface AtVideo {
  basename: string;
  link: string;
  resolution: number | null;
  nc: boolean;
  overlap: string;
  audio: { link: string } | null;
}

const ENDPOINT = 'https://rs.animethemes.moe/graphql';

const QUERY = `query ($first: Int!, $after: String) {
  animeConnection(pagination: { first: $first, after: $after }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id slug year season format
      title { romaji english }
      synonyms { text }
      series { nodes { id slug title { romaji } } }
      resources { nodes { site externalId } }
      themes {
        id type sequence slug
        group { slug }
        song { title { romaji } staff { role relevance artist { name { main } } } }
        entries {
          version nsfw spoiler
          videos { nodes { basename link resolution nc overlap audio { link } } }
        }
      }
    }
  }
}`;

interface PageResponse {
  data?: {
    animeConnection: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: AtAnime[];
    };
  };
  errors?: { message: string }[];
}

/** Récupère tous les animes par pages de 100 (limite : 90 requêtes/min). */
export async function fetchAllAnime(onPage?: (page: number, count: number) => void) {
  const limiter = new RateLimiter(80);
  const all: AtAnime[] = [];
  let after: string | null = null;
  for (let page = 1; ; page++) {
    const body: PageResponse = await fetchJson<PageResponse>(ENDPOINT, {
      limiter,
      label: `AnimeThemes page ${page}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { first: 100, after } }),
      },
    });
    if (body.errors?.length || !body.data) {
      throw new Error(`AnimeThemes : ${body.errors?.map((e) => e.message).join(', ')}`);
    }
    const { nodes, pageInfo } = body.data.animeConnection;
    all.push(...nodes);
    onPage?.(page, all.length);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return all;
}
