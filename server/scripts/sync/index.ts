/**
 * Synchro du catalogue : AnimeThemes + AniList + Wikidata → data/catalogue.db
 *
 *   npm run catalogue:sync -w server              # tout récupérer
 *   npm run catalogue:sync -w server -- --cached  # réutiliser les réponses déjà téléchargées
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Catalogue } from '../../src/catalogue/Catalogue';
import { writeCatalogue } from '../../src/catalogue/store';
import { fetchAnilist } from './anilist';
import { fetchAllAnime } from './animethemes';
import { buildCatalogueData, externalId } from './map';
import { fetchWikidataLabels } from './wikidata';

const dataDir = fileURLToPath(new URL('../../data/', import.meta.url));
const cacheDir = `${dataDir}cache/`;
const outputPath = process.env.CATALOGUE_PATH ?? `${dataDir}catalogue.db`;
const useCache = process.argv.includes('--cached');

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const path = `${cacheDir}${name}.json`;
  if (useCache && existsSync(path)) {
    console.log(`↺ ${name} : réutilisation du cache`);
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }
  const value = await load();
  writeFileSync(path, JSON.stringify(value));
  return value;
}

async function main() {
  const startedAt = Date.now();
  mkdirSync(cacheDir, { recursive: true });

  console.log('① AnimeThemes');
  const anime = await cached('animethemes', () =>
    fetchAllAnime((page, count) => process.stdout.write(`\r  page ${page} — ${count} animes`)),
  );
  console.log(`\n  ${anime.length} animes`);

  const anilistIds = anime
    .map((a) => externalId(a, 'ANILIST'))
    .filter((id): id is number => id !== null);

  console.log('② AniList');
  const anilist = await cached('anilist', () =>
    fetchAnilist(anilistIds, (done, total) => process.stdout.write(`\r  ${done}/${total}`)),
  );
  console.log(`\n  ${anilist.length} fiches`);

  console.log('③ Wikidata (titres français)');
  const wikidata = await cached('wikidata', fetchWikidataLabels);
  console.log(`  ${wikidata.length} libellés`);

  console.log('④ Construction du catalogue');
  const data = buildCatalogueData({
    generatedAt: new Date().toISOString(),
    anime,
    anilist,
    wikidata,
  });

  const tempPath = `${outputPath}.tmp`;
  rmSync(tempPath, { force: true });
  const db = new Database(tempPath);
  db.pragma('journal_mode = DELETE');
  writeCatalogue(db, data);
  db.exec('VACUUM');
  db.close();
  renameSync(tempPath, outputPath);

  const stats = Catalogue.load(outputPath).stats();
  const withFr = data.anime.filter((a) => a.titleFr).length;
  const withPopularity = data.anime.filter((a) => a.popularity > 0).length;
  console.log(
    `✔ ${stats.themes} musiques, ${stats.anime} animes, ${stats.franchises} franchises ` +
      `(titre FR : ${withFr}, popularité : ${withPopularity}) en ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
  console.log(`  → ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
