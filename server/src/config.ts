import { fileURLToPath } from 'node:url';

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: toInt(process.env.PORT, 3001),
  host: process.env.HOST ?? '0.0.0.0',
  /** Origines autorisées (front), séparées par des virgules ; « https:// » ajouté si absent. */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((origin) => (/^https?:\/\//.test(origin) ? origin : `https://${origin}`)),
  /** Base SQLite générée par `npm run catalogue:sync`. */
  cataloguePath:
    process.env.CATALOGUE_PATH ?? fileURLToPath(new URL('../data/catalogue.db', import.meta.url)),
  version: process.env.npm_package_version ?? '0.1.0',
  /**
   * Miroir audio (Cloudflare R2 + Worker) : adresse du Worker et clé secrète des noms
   * de fichiers. Absents : tout l'audio passe par le proxy du serveur.
   */
  mirrorUrl: process.env.MIRROR_URL?.trim() || null,
  mirrorSecret: process.env.MIRROR_SECRET?.trim() || null,
  isProduction: process.env.NODE_ENV === 'production',
} as const;

export type Config = typeof config;
