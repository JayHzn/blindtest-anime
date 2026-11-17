import Database from 'better-sqlite3';
import type { ThemeType } from '@blindtest/shared';
import type { AnimeRow, CatalogueData, FranchiseRow, ThemeRow, TitleRow } from './types';

const SCHEMA = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE franchise (
  id INTEGER PRIMARY KEY,
  series_id INTEGER,
  name TEXT NOT NULL,
  name_fr TEXT
);

CREATE TABLE anime (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  franchise_id INTEGER NOT NULL REFERENCES franchise(id),
  name TEXT NOT NULL,
  title_romaji TEXT,
  title_en TEXT,
  title_fr TEXT,
  year INTEGER,
  season TEXT,
  media_format TEXT,
  anilist_id INTEGER,
  mal_id INTEGER,
  popularity INTEGER NOT NULL,
  popularity_rank INTEGER NOT NULL,
  cover_url TEXT,
  cover_color TEXT,
  genre TEXT
);
CREATE INDEX anime_franchise ON anime(franchise_id);

CREATE TABLE theme (
  id INTEGER PRIMARY KEY,
  anime_id INTEGER NOT NULL REFERENCES anime(id),
  type TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  slug TEXT NOT NULL,
  song_title TEXT,
  artists TEXT,
  audio_url TEXT NOT NULL,
  video_url TEXT,
  video_resolution INTEGER,
  spoiler INTEGER NOT NULL
);
CREATE INDEX theme_anime ON theme(anime_id);

CREATE TABLE title (
  owner_kind TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL
);
CREATE INDEX title_owner ON title(owner_kind, owner_id);
`;

/** Écrit le catalogue dans une base SQLite vide. */
export function writeCatalogue(db: Database.Database, data: CatalogueData): void {
  db.exec(SCHEMA);
  const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  const insertFranchise = db.prepare(
    'INSERT INTO franchise (id, series_id, name, name_fr) VALUES (@id, @seriesId, @name, @nameFr)',
  );
  const insertAnime = db.prepare(`
    INSERT INTO anime (id, slug, franchise_id, name, title_romaji, title_en, title_fr, year, season,
      media_format, anilist_id, mal_id, popularity, popularity_rank, cover_url, cover_color, genre)
    VALUES (@id, @slug, @franchiseId, @name, @titleRomaji, @titleEn, @titleFr, @year, @season,
      @mediaFormat, @anilistId, @malId, @popularity, @popularityRank, @coverUrl, @coverColor,
      @genre)`);
  const insertTheme = db.prepare(`
    INSERT INTO theme (id, anime_id, type, sequence, slug, song_title, artists, audio_url,
      video_url, video_resolution, spoiler)
    VALUES (@id, @animeId, @type, @sequence, @slug, @songTitle, @artists, @audioUrl,
      @videoUrl, @videoResolution, @spoiler)`);
  const insertTitle = db.prepare(
    'INSERT INTO title (owner_kind, owner_id, title) VALUES (@ownerKind, @ownerId, @title)',
  );

  db.transaction(() => {
    insertMeta.run('generated_at', data.generatedAt);
    for (const row of data.franchises) insertFranchise.run(row);
    for (const row of data.anime) insertAnime.run(row);
    for (const row of data.themes) insertTheme.run({ ...row, spoiler: row.spoiler ? 1 : 0 });
    for (const row of data.titles) insertTitle.run(row);
  })();
}

/** Relit tout le catalogue depuis la base (il tient largement en mémoire). */
export function readCatalogue(db: Database.Database): CatalogueData {
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'generated_at'").get() as
    { value: string } | undefined;

  const franchises = db
    .prepare('SELECT id, series_id AS seriesId, name, name_fr AS nameFr FROM franchise')
    .all() as FranchiseRow[];

  // Catalogue généré avant l'ajout des genres : il reste lisible (indice sans genre).
  const hasGenre = (db.prepare('PRAGMA table_info(anime)').all() as { name: string }[]).some(
    (column) => column.name === 'genre',
  );
  const anime = db
    .prepare(
      `SELECT id, slug, franchise_id AS franchiseId, name, title_romaji AS titleRomaji,
        title_en AS titleEn, title_fr AS titleFr, year, season, media_format AS mediaFormat,
        anilist_id AS anilistId, mal_id AS malId, popularity, popularity_rank AS popularityRank,
        cover_url AS coverUrl, cover_color AS coverColor, ${hasGenre ? 'genre' : 'NULL AS genre'}
       FROM anime`,
    )
    .all() as AnimeRow[];

  const themes = (
    db
      .prepare(
        `SELECT id, anime_id AS animeId, type, sequence, slug, song_title AS songTitle, artists,
          audio_url AS audioUrl, video_url AS videoUrl, video_resolution AS videoResolution, spoiler
         FROM theme`,
      )
      .all() as (Omit<ThemeRow, 'spoiler' | 'type'> & { spoiler: number; type: string })[]
  ).map((row) => ({ ...row, type: row.type as ThemeType, spoiler: row.spoiler === 1 }));

  const titles = db
    .prepare('SELECT owner_kind AS ownerKind, owner_id AS ownerId, title FROM title')
    .all() as TitleRow[];

  return { generatedAt: meta?.value ?? '', franchises, anime, themes, titles };
}
