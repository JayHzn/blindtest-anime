import { useEffect, useState } from 'react';
import { serverNow } from '../lib/clock';

/** Heure serveur, rafraîchie à intervalle régulier (pour les comptes à rebours affichés). */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Secondes restantes avant `endsAt` (arrondi supérieur, jamais négatif). */
export const secondsLeft = (endsAt: number, now: number): number =>
  Math.max(0, Math.ceil((endsAt - now) / 1000));
