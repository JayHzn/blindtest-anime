import { createHash, randomUUID } from 'node:crypto';

const KEY_PATTERN = /^[\w-]{16,128}$/;

/**
 * Identifiant public d'un joueur, dérivé de sa clé secrète (gardée dans son
 * navigateur). Les autres joueurs voient l'identifiant, jamais la clé :
 * personne ne peut se faire passer pour quelqu'un d'autre.
 */
export function playerIdFromKey(key: unknown): string {
  // Sans clé valide (vieux client, test…), identité éphémère.
  const secret = typeof key === 'string' && KEY_PATTERN.test(key) ? key : randomUUID();
  return createHash('sha256').update(secret).digest('base64url').slice(0, 16);
}

/** Salon Socket.IO personnel d'un joueur (tous ses onglets / reconnexions). */
export const playerChannel = (playerId: string): string => `player:${playerId}`;
