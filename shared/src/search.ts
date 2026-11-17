import type { TitleEntry } from './catalogue';
import { compact, normalize, withinOneEdit } from './text';

export interface SearchResult {
  entry: TitleEntry;
  score: number;
}

/** Index de recherche préparé une fois (formes compactes précalculées). */
export interface SearchIndex {
  entries: TitleEntry[];
  compacts: string[][];
  words: string[][][];
}

export function buildSearchIndex(entries: TitleEntry[]): SearchIndex {
  return {
    entries,
    compacts: entries.map((entry) => entry.t.map(compact)),
    words: entries.map((entry) => entry.t.map((title) => title.split(' '))),
  };
}

const SCORE_EXACT = 100;
const SCORE_PREFIX = 60;
const SCORE_WORD_PREFIX = 40;
const SCORE_CONTAINS = 20;
const SCORE_FUZZY = 10;

function scoreTitle(
  query: string,
  queryCompact: string,
  title: string,
  titleCompact: string,
  words: string[],
): number {
  if (titleCompact === queryCompact) return SCORE_EXACT;
  if (title.startsWith(query) || titleCompact.startsWith(queryCompact)) return SCORE_PREFIX;
  if (words.some((word) => word.startsWith(query))) return SCORE_WORD_PREFIX;
  if (titleCompact.includes(queryCompact)) return SCORE_CONTAINS;
  // Faute de frappe dans le début du titre (à partir de 5 lettres tapées,
  // première lettre juste : ça évite de tester tout le catalogue à chaque frappe).
  if (queryCompact.length >= 5 && titleCompact[0] === queryCompact[0]) {
    const head = titleCompact.slice(0, queryCompact.length);
    if (withinOneEdit(queryCompact, head)) return SCORE_FUZZY;
  }
  return 0;
}

/**
 * Suggestions d'autocomplétion. Classement : qualité de la correspondance,
 * puis franchise avant saison, puis popularité.
 */
export function search(index: SearchIndex, rawQuery: string, limit = 8): SearchResult[] {
  const query = normalize(rawQuery);
  const queryCompact = compact(query);
  if (queryCompact.length < 2) return [];

  const results: SearchResult[] = [];
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i]!;
    const titles = entry.t;
    const compacts = index.compacts[i]!;
    const words = index.words[i]!;
    let best = 0;
    for (let j = 0; j < titles.length && best < SCORE_EXACT; j++) {
      const score = scoreTitle(query, queryCompact, titles[j]!, compacts[j]!, words[j]!);
      if (score > best) best = score;
    }
    if (best > 0) results.push({ entry, score: best });
  }

  results.sort(
    (a, b) => b.score - a.score || kindRank(a.entry) - kindRank(b.entry) || b.entry.p - a.entry.p,
  );
  return results.slice(0, limit);
}

/** Les franchises passent avant les saisons à score égal. */
const kindRank = (entry: TitleEntry): number => (entry.k === 'f' ? 0 : 1);
