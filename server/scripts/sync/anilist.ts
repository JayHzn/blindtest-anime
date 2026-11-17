import { fetchJson, RateLimiter } from './http';

export interface AnilistMedia {
  id: number;
  popularity: number | null;
  title: { romaji: string | null; english: string | null };
  /** Jaquette (repli de la vidéo à la révélation) et sa couleur dominante. */
  coverImage?: { extraLarge: string | null; color: string | null } | null;
}

const QUERY = `query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id popularity title { romaji english } coverImage { extraLarge color }
    }
  }
}`;

const BATCH_SIZE = 50;

/** Popularité et titres AniList, par lots de 50 (limite actuelle : 30 req/min). */
export async function fetchAnilist(
  ids: number[],
  onBatch?: (done: number, total: number) => void,
): Promise<AnilistMedia[]> {
  const limiter = new RateLimiter(28);
  const unique = [...new Set(ids)];
  const results: AnilistMedia[] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const body = await fetchJson<{ data: { Page: { media: AnilistMedia[] } } }>(
      'https://graphql.anilist.co',
      {
        limiter,
        label: `AniList lot ${i / BATCH_SIZE + 1}`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: QUERY, variables: { ids: batch } }),
        },
      },
    );
    results.push(...body.data.Page.media);
    onBatch?.(Math.min(i + BATCH_SIZE, unique.length), unique.length);
  }
  return results;
}
