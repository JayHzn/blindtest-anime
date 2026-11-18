/**
 * Copie l'audio du catalogue sur le miroir Cloudflare R2.
 *
 *   npm run mirror:sync -w server -- [--top 500|2000|all] [--max N] [--parallel 1-4]
 *
 * Pour chaque chanson (openings et endings du top demandé) pas encore copiée :
 * téléchargement depuis AnimeThemes (en douceur : 1 à 4 à la fois, pause entre deux), réencodage en Opus
 * 96 kbit/s (ffmpeg), envoi sur R2 sous un nom opaque (voir AudioMirror), puis mise à
 * jour de `index.json`. Le script reprend là où il s'est arrêté.
 *
 * Accès dans `server/.env.r2` (jamais commité) : R2_ACCOUNT_ID, R2_BUCKET,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY ; MIRROR_SECRET y est créée au premier
 * lancement (à recopier dans les variables d'environnement de Render).
 * ffmpeg : dans le PATH, ou son chemin dans la variable FFMPEG.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { PopularityTier } from '@blindtest/shared';
import { Catalogue } from '../src/catalogue/Catalogue';
import { config } from '../src/config';
import { AudioMirror } from '../src/media/AudioMirror';

const run = promisify(execFile);
const ENV_PATH = fileURLToPath(new URL('../.env.r2', import.meta.url));
/** Pause entre deux téléchargements : on ne surcharge pas AnimeThemes. */
const PAUSE_MS = 400;
/** `index.json` est réécrit toutes les N chansons (et à la fin, ou sur Ctrl+C). */
const SAVE_EVERY = 20;
const USER_AGENT = 'Anilind audio mirror (blindtest entre amis)';

const KEYS = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'MIRROR_SECRET',
];

/** Accès : variables d'environnement (secrets GitHub Actions), sinon `server/.env.r2`. */
function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]!] = match[2]!.trim();
    }
  }
  for (const key of KEYS) if (process.env[key]?.trim()) env[key] = process.env[key]!.trim();
  return env;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const env = readEnv();
  for (const key of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!env[key]) throw new Error(`${key} manquant (server/.env.r2 ou variable d'environnement)`);
  }
  // Chez GitHub, ne jamais inventer de clé : une nouvelle clé changerait tous les noms de
  // fichiers et rendrait la copie existante inutilisable.
  if (!env.MIRROR_SECRET && process.env.CI) {
    throw new Error('MIRROR_SECRET manquant dans les secrets du dépôt');
  }
  if (!env.MIRROR_SECRET) {
    env.MIRROR_SECRET = randomBytes(32).toString('hex');
    appendFileSync(
      ENV_PATH,
      `\n# Clé des noms de fichiers du miroir : à recopier dans Render (MIRROR_SECRET).\nMIRROR_SECRET=${env.MIRROR_SECRET}\n`,
    );
    console.log('MIRROR_SECRET créée dans server/.env.r2 (à recopier dans Render).');
  }

  const topArg = argValue('top') ?? '500';
  const top: PopularityTier = topArg === 'all' ? 'all' : (Number(topArg) as PopularityTier);
  if (![100, 500, 2000, 'all'].includes(top)) throw new Error('--top : 100, 500, 2000 ou all');
  const max = Number(argValue('max') ?? Number.POSITIVE_INFINITY);
  // Copies en parallèle (le temps est surtout passé à attendre le réseau) ; 4 au plus.
  const parallel = Math.min(4, Math.max(1, Number(argValue('parallel') ?? 1) || 1));
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const Bucket = env.R2_BUCKET!;

  // Chansons déjà copiées (index.json), pour reprendre là où on s'est arrêté.
  const done = new Set<number>();
  try {
    const index: GetObjectCommandOutput = await s3.send(
      new GetObjectCommand({ Bucket, Key: 'index.json' }),
    );
    const body = JSON.parse(await index.Body!.transformToString()) as { themes: number[] };
    for (const id of body.themes) done.add(id);
  } catch {
    // Premier lancement : pas encore d'index.
  }
  const saveIndex = async () => {
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: 'index.json',
        Body: JSON.stringify({
          updatedAt: new Date().toISOString(),
          themes: [...done].sort((a, b) => a - b),
        }),
        ContentType: 'application/json',
        CacheControl: 'no-cache',
      }),
    );
  };

  const catalogue = Catalogue.load(config.cataloguePath);
  const themes = catalogue
    .themesMatching({ popularity: top, types: ['OP', 'ED'] })
    .filter((theme) => !done.has(theme.id));
  const total = Math.min(themes.length, max);
  console.log(
    `Top ${top} : ${done.size} déjà copiées, ${themes.length} à copier (${total} cette fois, ${parallel} à la fois).`,
  );

  const work = mkdtempSync(join(tmpdir(), 'anilind-mirror-'));
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log(
      '\nArrêt demandé : les chansons en cours se terminent, puis index.json est enregistré.',
    );
  });

  let copied = 0;
  let bytes = 0;
  let failed = 0;
  let next = 0;
  const startedAt = Date.now();
  // Enregistrements de l'index l'un après l'autre (plusieurs copies en parallèle).
  let saving = Promise.resolve();
  const queueSave = () => {
    saving = saving.then(saveIndex, saveIndex);
    return saving;
  };

  /** Une copie à la fois par « travailleur » ; `parallel` travailleurs en même temps. */
  const worker = async (slot: number) => {
    const source = join(work, `source-${slot}`);
    const encoded = join(work, `encoded-${slot}.ogg`);
    while (!stopping && next < total) {
      const theme = themes[next++]!;
      try {
        const response = await fetch(theme.audioUrl, {
          headers: { 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`téléchargement ${response.status}`);
        writeFileSync(source, Buffer.from(await response.arrayBuffer()));
        await run(ffmpeg, [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          source,
          '-vn',
          '-map_metadata',
          '-1',
          '-c:a',
          'libopus',
          '-b:a',
          '96k',
          encoded,
        ]);
        const body = readFileSync(encoded);
        await s3.send(
          new PutObjectCommand({
            Bucket,
            Key: AudioMirror.keyFor(env.MIRROR_SECRET!, theme.id),
            Body: body,
            ContentType: 'audio/ogg',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        done.add(theme.id);
        copied++;
        bytes += statSync(encoded).size;
        if (copied % SAVE_EVERY === 0) await queueSave();
        const handled = copied + failed;
        const elapsed = (Date.now() - startedAt) / 1000;
        const left = ((total - handled) * elapsed) / handled / 60;
        process.stdout.write(
          `\r[${handled}/${total}] ${copied} copiées · ${failed} échecs · ${(bytes / 1e6).toFixed(0)} Mo · ${(elapsed / handled).toFixed(1)} s/chanson · ~${left.toFixed(0)} min restantes   `,
        );
      } catch (error) {
        failed++;
        console.log(`\n✗ chanson ${theme.id} : ${(error as Error).message}`);
      }
      await sleep(PAUSE_MS);
    }
  };

  try {
    await Promise.all(Array.from({ length: parallel }, (_, slot) => worker(slot)));
  } finally {
    await queueSave();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(
    `\nTerminé : ${copied} copiées (${(bytes / 1e6).toFixed(0)} Mo), ${failed} échecs, ${done.size} au total sur le miroir.`,
  );
}

main().catch((error) => {
  console.error(`Échec : ${(error as Error).message}`);
  process.exit(1);
});
