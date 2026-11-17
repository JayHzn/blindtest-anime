const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: toInt(process.env.PORT, 3001),
  host: process.env.HOST ?? '0.0.0.0',
  /** Origines autorisées (front), séparées par des virgules. */
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  version: process.env.npm_package_version ?? '0.1.0',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

export type Config = typeof config;
