import { randomBytes } from 'node:crypto';

interface Entry {
  url: string;
  expiresAt: number;
}

/** Durée de vie maximale d'un jeton (filet de sécurité si une partie n'est pas nettoyée). */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Associe des jetons opaques aux URL des fichiers audio.
 * Le navigateur ne voit que `/api/audio/<jeton>` : le nom du fichier,
 * qui contient le titre de l'anime, n'apparaît jamais côté client.
 */
export class AudioRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  register(url: string): string {
    this.sweep();
    const token = randomBytes(16).toString('base64url');
    this.entries.set(token, { url, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  resolve(token: string): string | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.url;
  }

  revoke(token: string): void {
    this.entries.delete(token);
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(token);
    }
  }
}

export const audioPath = (token: string): string => `/api/audio/${token}`;
