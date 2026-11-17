import { fetchJson, RateLimiter } from './http';

export interface WikidataLabel {
  anilistId: number;
  /** Libellé français de l'anime, ex. « saison 3 de L'Attaque des Titans ». */
  label: string | null;
  /** Libellé français de la série parente (propriété P179), ex. « L'Attaque des Titans ». */
  seriesLabel: string | null;
}

// P8729 = identifiant AniList d'un anime ; P179 = fait partie de la série.
const QUERY = `
SELECT ?al ?label ?seriesLabel WHERE {
  ?item wdt:P8729 ?al .
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "fr") }
  OPTIONAL { ?item wdt:P179 ?series . ?series rdfs:label ?seriesLabel FILTER(LANG(?seriesLabel) = "fr") }
}`;

interface SparqlResponse {
  results: {
    bindings: {
      al: { value: string };
      label?: { value: string };
      seriesLabel?: { value: string };
    }[];
  };
}

/** Titres français de tous les animes Wikidata reliés à AniList, en une seule requête. */
export async function fetchWikidataLabels(): Promise<WikidataLabel[]> {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(QUERY)}`;
  const body = await fetchJson<SparqlResponse>(url, {
    limiter: new RateLimiter(10),
    label: 'Wikidata',
    init: { headers: { Accept: 'application/sparql-results+json' } },
  });
  const labels: WikidataLabel[] = [];
  for (const row of body.results.bindings) {
    const anilistId = Number.parseInt(row.al.value, 10);
    if (!Number.isFinite(anilistId)) continue;
    labels.push({
      anilistId,
      label: row.label?.value ?? null,
      seriesLabel: row.seriesLabel?.value ?? null,
    });
  }
  return labels;
}
