import { describe, expect, it } from 'vitest';
import { buildCatalogueData } from '../scripts/sync/map';
import { parseFrenchLabel } from '../src/catalogue/titles';
import { sources } from './fixtures/sources';

const data = buildCatalogueData(sources);
const theme = (id: number) => data.themes.find((t) => t.id === id);
const animeRow = (id: number) => data.anime.find((a) => a.id === id)!;

describe('buildCatalogueData', () => {
  it('ignore les animes sans audio', () => {
    expect(data.anime.map((a) => a.id)).toEqual([100, 101, 200, 300, 500, 501]);
  });

  it('garde la version originale et préfère la vidéo 720p sans crédits', () => {
    expect(theme(1002)).toBeUndefined();
    expect(theme(1001)?.videoUrl).toContain('NCBD720');
    expect(theme(1001)?.artists).toBe('Linked Horizon');
  });

  it('garde les insert songs', () => {
    expect(theme(1004)?.type).toBe('IN');
  });

  it('saute les versions NSFW et numérote à 1 par défaut', () => {
    expect(theme(1003)?.audioUrl).toContain('ED-v2');
    expect(theme(1003)?.sequence).toBe(1);
    expect(theme(1003)?.spoiler).toBe(true);
  });

  it('regroupe les saisons dans la même franchise', () => {
    expect(animeRow(100).franchiseId).toBe(animeRow(101).franchiseId);
    // Un anime dans deux séries rejoint la plus grande.
    expect(animeRow(500).franchiseId).toBe(animeRow(501).franchiseId);
    // Un anime sans série forme sa propre franchise.
    const onePiece = data.franchises.find((f) => f.id === animeRow(200).franchiseId);
    expect(onePiece?.seriesId).toBeNull();
  });

  it('remplit les titres français depuis Wikidata', () => {
    expect(animeRow(101).titleFr).toBe("L'Attaque des Titans — Saison 3");
    const snk = data.franchises.find((f) => f.id === animeRow(100).franchiseId);
    expect(snk?.nameFr).toBe("L'Attaque des Titans");
  });

  it('classe par popularité AniList', () => {
    expect(animeRow(100).popularityRank).toBe(1);
    expect(animeRow(200).popularityRank).toBe(2);
    expect(animeRow(300).popularityRank).toBe(3);
    expect(animeRow(101).popularityRank).toBe(4);
  });
});

describe('parseFrenchLabel', () => {
  it('reformule les libellés de saison', () => {
    expect(parseFrenchLabel("saison 2 de L'Attaque des Titans")).toEqual({
      display: "L'Attaque des Titans — Saison 2",
      base: "L'Attaque des Titans",
    });
    expect(parseFrenchLabel('2e saison de Mob Psycho 100').display).toBe(
      'Mob Psycho 100 — Saison 2',
    );
    expect(parseFrenchLabel('SPY×FAMILY saison 1')).toEqual({
      display: 'SPY×FAMILY — Saison 1',
      base: 'SPY×FAMILY',
    });
    expect(parseFrenchLabel('Oshi no Ko (saison 2)').display).toBe('Oshi no Ko — Saison 2');
    expect(parseFrenchLabel('one Piece')).toEqual({ display: 'One Piece', base: null });
  });
});
