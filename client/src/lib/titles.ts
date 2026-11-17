import { buildSearchIndex, type SearchIndex, type TitleIndex } from '@blindtest/shared';
import { apiUrl } from './server';

let pending: Promise<SearchIndex> | null = null;

/**
 * Index des titres pour l'autocomplétion, téléchargé une seule fois
 * (le navigateur le garde en cache et le revalide grâce à l'ETag).
 */
export function loadTitleIndex(): Promise<SearchIndex> {
  pending ??= fetch(apiUrl('/api/titles'))
    .then((res) => {
      if (!res.ok) throw new Error(`titles_${res.status}`);
      return res.json() as Promise<TitleIndex>;
    })
    .then((index) => buildSearchIndex(index.entries))
    .catch((error: unknown) => {
      pending = null; // nouvel essai au prochain appel
      throw error;
    });
  return pending;
}
