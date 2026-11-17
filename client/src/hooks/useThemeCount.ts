import { useEffect, useState } from 'react';
import type { ThemeCountResponse, ThemeFilters } from '@blindtest/shared';
import { apiUrl } from '../lib/server';

/** Nombre de musiques correspondant aux filtres (null pendant le chargement). */
export function useThemeCount(filters: ThemeFilters): number | null {
  const query = new URLSearchParams({
    popularity: String(filters.popularity),
    types: filters.types.join(','),
    ...(filters.yearFrom !== undefined && { yearFrom: String(filters.yearFrom) }),
    ...(filters.yearTo !== undefined && { yearTo: String(filters.yearTo) }),
  }).toString();
  // Le résultat est rangé avec sa requête : un résultat périmé compte comme « en chargement ».
  const [result, setResult] = useState<{ query: string; count: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Petit délai : pas de requête à chaque clic rapide sur les filtres.
    const timer = window.setTimeout(() => {
      fetch(apiUrl(`/api/themes/count?${query}`), { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<ThemeCountResponse>) : null))
        .then((body) => {
          if (body) setResult({ query, count: body.count });
        })
        .catch(() => {});
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return result?.query === query ? result.count : null;
}
