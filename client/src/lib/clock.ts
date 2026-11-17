import type { GameSocket } from './socket';

/**
 * Synchronisation avec l'horloge du serveur : les événements de jeu portent
 * des heures serveur (début d'écoute, fin de phase) ; le navigateur les
 * convertit grâce au décalage mesuré ici.
 */
let offsetMs = 0;

/** Heure du serveur estimée (ms). */
export const serverNow = (): number => Date.now() + offsetMs;

const SAMPLES = 4;

/** Mesure le décalage en gardant l'échantillon au plus faible temps d'aller-retour. */
export async function syncClock(socket: GameSocket): Promise<void> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < SAMPLES; i++) {
    const sentAt = Date.now();
    try {
      const serverTime = await socket.timeout(3000).emitWithAck('clock:ping');
      const receivedAt = Date.now();
      const rtt = receivedAt - sentAt;
      const offset = serverTime - (sentAt + rtt / 2);
      if (!best || rtt < best.rtt) best = { rtt, offset };
    } catch {
      // échantillon perdu : on continue avec les autres
    }
  }
  if (best) offsetMs = best.offset;
}
