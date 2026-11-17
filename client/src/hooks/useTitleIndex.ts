import { useEffect, useState } from 'react';
import type { SearchIndex } from '@blindtest/shared';
import { loadTitleIndex } from '../lib/titles';

/** Index de recherche des titres (null tant qu'il charge). */
export function useTitleIndex(): SearchIndex | null {
  const [index, setIndex] = useState<SearchIndex | null>(null);
  useEffect(() => {
    let active = true;
    loadTitleIndex()
      .then((loaded) => {
        if (active) setIndex(loaded);
      })
      .catch(() => {
        // sans index, la saisie libre reste possible (le serveur valide)
      });
    return () => {
      active = false;
    };
  }, []);
  return index;
}
