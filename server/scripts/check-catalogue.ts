/**
 * Diagnostic du catalogue généré : taille de l'index, vitesse de recherche, exemples.
 *
 *   npm run catalogue:check -w server
 */
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { buildSearchIndex, search } from '@blindtest/shared';
import { Catalogue } from '../src/catalogue/Catalogue';
import { config } from '../src/config';

let start = performance.now();
const catalogue = Catalogue.load(config.cataloguePath);
console.log(`Chargement : ${Math.round(performance.now() - start)} ms`, catalogue.stats());

const json = JSON.stringify(catalogue.titleIndex);
const kb = (size: number) => `${Math.round(size / 1024)} Ko`;
console.log(
  `Index des titres : ${catalogue.titleIndex.entries.length} entrées, ${kb(json.length)} brut, ` +
    `${kb(gzipSync(json).length)} gzip, ${kb(brotliCompressSync(json).length)} brotli`,
);

const index = buildSearchIndex(catalogue.titleIndex.entries);
const queries = ['shingeki', 'attaque des', 'demon sl', 'naruto', 'frieren', 'one p', 'shingaki'];
for (const query of queries) {
  start = performance.now();
  const results = search(index, query, 4);
  const elapsed = (performance.now() - start).toFixed(2);
  const labels = results.map((r) => `${r.entry.k === 'f' ? '[F] ' : ''}${r.entry.fr}`);
  console.log(`${query.padEnd(14)} ${elapsed.padStart(6)} ms  ${labels.join(' | ')}`);
}

const game = catalogue.pickThemes({ popularity: 100, types: ['OP', 'ED'] }, 10);
console.log('\nExemple de partie (top 100) :');
for (const theme of game) {
  const anime = catalogue.getAnime(theme.animeId)!;
  console.log(`  ${catalogue.animeTitle(anime, 'fr')} — ${theme.slug} « ${theme.songTitle} »`);
}
