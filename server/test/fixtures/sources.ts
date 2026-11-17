import Database from 'better-sqlite3';
import type { AtAnime, AtEntry, AtTheme, AtVideo } from '../../scripts/sync/animethemes';
import { buildCatalogueData, type SyncSources } from '../../scripts/sync/map';
import { Catalogue } from '../../src/catalogue/Catalogue';
import { readCatalogue, writeCatalogue } from '../../src/catalogue/store';

const video = (basename: string, resolution: number, extra: Partial<AtVideo> = {}): AtVideo => ({
  basename,
  link: `https://v.animethemes.moe/${basename}`,
  resolution,
  nc: true,
  overlap: 'NONE',
  audio: { link: `https://a.animethemes.moe/${basename.replace('.webm', '.ogg')}` },
  ...extra,
});

const entry = (videos: AtVideo[], extra: Partial<AtEntry> = {}): AtEntry => ({
  version: 1,
  nsfw: false,
  spoiler: false,
  videos: { nodes: videos },
  ...extra,
});

const theme = (
  id: number,
  type: string,
  sequence: number | null,
  entries: AtEntry[],
  extra: Partial<AtTheme> = {},
): AtTheme => ({
  id,
  type,
  sequence,
  slug: `${type}${sequence ?? ''}`,
  group: null,
  song: null,
  entries,
  ...extra,
});

const performer = (name: string, relevance = 1) => ({
  role: 'Performance',
  relevance,
  artist: { name: { main: name } },
});

const makeAnime = (
  base: Pick<AtAnime, 'id' | 'slug' | 'year' | 'themes'> & {
    romaji: string;
    english?: string;
    synonyms?: string[];
    series?: { id: number; romaji: string }[];
    anilist?: number;
    mal?: number;
  },
): AtAnime => ({
  id: base.id,
  slug: base.slug,
  year: base.year,
  season: null,
  format: 'TV',
  title: { romaji: base.romaji, english: base.english ?? null },
  synonyms: (base.synonyms ?? []).map((text) => ({ text })),
  series: {
    nodes: (base.series ?? []).map((s) => ({
      id: s.id,
      slug: `s${s.id}`,
      title: { romaji: s.romaji },
    })),
  },
  resources: {
    nodes: [
      ...(base.anilist ? [{ site: 'ANILIST', externalId: base.anilist }] : []),
      ...(base.mal ? [{ site: 'MAL', externalId: base.mal }] : []),
      { site: 'KITSU', externalId: 999 },
    ],
  },
  themes: base.themes,
});

const SNK_SERIES = { id: 1, romaji: 'Shingeki no Kyojin' };

export const anime: AtAnime[] = [
  makeAnime({
    id: 100,
    slug: 'shingeki_no_kyojin',
    year: 2013,
    romaji: 'Shingeki no Kyojin',
    synonyms: ['SnK', 'AoT'],
    series: [SNK_SERIES],
    anilist: 16498,
    mal: 16498,
    themes: [
      theme(
        1001,
        'OP',
        1,
        [
          entry([
            video('ShingekiNoKyojin-OP1.webm', 1080),
            video('ShingekiNoKyojin-OP1-NCBD720.webm', 720),
            video('ShingekiNoKyojin-OP1-Over.webm', 720, { overlap: 'OVER' }),
          ]),
        ],
        {
          song: {
            title: { romaji: 'Guren no Yumiya' },
            staff: [
              { role: 'Composition', relevance: 1, artist: { name: { main: 'Revo' } } },
              performer('Linked Horizon'),
            ],
          },
        },
      ),
      // Doublage anglais : ignoré
      theme(1002, 'OP', 1, [entry([video('Dub.webm', 720)])], { group: { slug: 'english' } }),
      // Version 1 NSFW : on prend la version 2
      theme(1003, 'ED', null, [
        entry([video('ED-v1.webm', 720)], { nsfw: true }),
        entry([video('ED-v2.webm', 720)], { version: 2, spoiler: true }),
      ]),
      // Insert song
      theme(1004, 'IN', 1, [entry([video('ShingekiNoKyojin-IN1.webm', 720)])]),
    ],
  }),
  makeAnime({
    id: 101,
    slug: 'shingeki_no_kyojin_season_3',
    year: 2018,
    romaji: 'Shingeki no Kyojin Season 3',
    series: [SNK_SERIES],
    anilist: 99147,
    themes: [
      theme(1011, 'OP', 1, [entry([video('S3-OP1.webm', 720)])]),
      theme(1012, 'OP', 2, [entry([video('S3-OP2.webm', 720)])]),
    ],
  }),
  makeAnime({
    id: 200,
    slug: 'one_piece',
    year: 1999,
    romaji: 'One Piece',
    anilist: 21,
    themes: [theme(2001, 'OP', 1, [entry([video('OP-OP1.webm', 480)])])],
  }),
  makeAnime({
    id: 300,
    slug: 'kimi_no_na_wa',
    year: 2016,
    romaji: 'Kimi no Na wa.',
    english: 'Your Name.',
    series: [{ id: 5, romaji: 'Kimi no Na wa.' }],
    anilist: 21519,
    themes: [theme(3001, 'ED', null, [entry([video('KNNW-ED.webm', 720)])])],
  }),
  makeAnime({
    id: 400,
    slug: 'sans_audio',
    year: 2020,
    romaji: 'Sans Audio',
    themes: [theme(4001, 'OP', 1, [entry([video('NoAudio.webm', 720, { audio: null })])])],
  }),
  makeAnime({
    id: 500,
    slug: 'bakemonogatari',
    year: null,
    romaji: 'Bakemonogatari',
    series: [
      { id: 8, romaji: 'Bakemonogatari seul' },
      { id: 7, romaji: 'Monogatari' },
    ],
    themes: [theme(5001, 'OP', 1, [entry([video('Bake-OP1.webm', 720)])])],
  }),
  makeAnime({
    id: 501,
    slug: 'nisemonogatari',
    year: null,
    romaji: 'Nisemonogatari',
    series: [{ id: 7, romaji: 'Monogatari' }],
    themes: [theme(5011, 'OP', 1, [entry([video('Nise-OP1.webm', 720)])])],
  }),
];

export const sources: SyncSources = {
  generatedAt: '2026-11-17T15:00:00.000Z',
  anime,
  anilist: [
    {
      id: 16498,
      popularity: 1_000_000,
      title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan' },
    },
    {
      id: 99147,
      popularity: 600_000,
      title: { romaji: 'Shingeki no Kyojin 3', english: 'Attack on Titan Season 3' },
      coverImage: { extraLarge: 'https://img.anili.st/media/99147.jpg', color: '#e4a15d' },
    },
    { id: 21, popularity: 900_000, title: { romaji: 'ONE PIECE', english: 'One Piece' } },
    { id: 21519, popularity: 800_000, title: { romaji: 'Kimi no Na wa.', english: 'Your Name.' } },
  ],
  wikidata: [
    {
      anilistId: 16498,
      label: "saison 1 de L'Attaque des Titans",
      seriesLabel: "L'Attaque des Titans",
    },
    { anilistId: 99147, label: "saison 3 de L'Attaque des Titans", seriesLabel: null },
    { anilistId: 21, label: 'One Piece', seriesLabel: null },
  ],
};

/** Catalogue complet passé par SQLite (comme en production). */
export function buildFixtureCatalogue(): Catalogue {
  const db = new Database(':memory:');
  writeCatalogue(db, buildCatalogueData(sources));
  const catalogue = new Catalogue(readCatalogue(db));
  db.close();
  return catalogue;
}
