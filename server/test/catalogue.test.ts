import { describe, expect, it } from 'vitest';
import type { ThemeFilters } from '@blindtest/shared';
import { buildFixtureCatalogue } from './fixtures/sources';

const catalogue = buildFixtureCatalogue();
const S3_OP1 = 1011;
const KIMI_ED = 3001;
const all: ThemeFilters = { popularity: 'all', types: ['OP', 'ED', 'IN'] };

describe('Catalogue.validate', () => {
  it('accepte la franchise en texte libre, sans bonus saison', () => {
    expect(catalogue.validate(S3_OP1, { text: 'shingeki no kyojin' })).toEqual({
      correct: true,
      seasonExact: false,
      sequenceExact: false,
    });
  });

  it('donne le bonus saison quand la bonne saison est tapée', () => {
    const verdict = catalogue.validate(S3_OP1, { text: 'Attack on Titan Season 3' });
    expect(verdict.correct).toBe(true);
    expect(verdict.seasonExact).toBe(true);
  });

  it('accepte le titre français avec une faute de frappe', () => {
    expect(catalogue.validate(S3_OP1, { text: "l'attaque des titan" }).correct).toBe(true);
  });

  it('accepte les abréviations courtes exactes', () => {
    expect(catalogue.validate(S3_OP1, { text: 'SnK' }).correct).toBe(true);
    expect(catalogue.validate(S3_OP1, { text: 'SnJ' }).correct).toBe(false);
  });

  it('refuse un autre anime', () => {
    expect(catalogue.validate(S3_OP1, { text: 'one piece' }).correct).toBe(false);
    expect(catalogue.validate(S3_OP1, { text: '' }).correct).toBe(false);
  });

  it("gère les suggestions choisies dans l'autocomplétion", () => {
    expect(catalogue.validate(S3_OP1, { text: '', pick: { kind: 'anime', id: 101 } })).toEqual({
      correct: true,
      seasonExact: true,
      sequenceExact: false,
    });
    const s1 = catalogue.validate(S3_OP1, { text: '', pick: { kind: 'anime', id: 100 } });
    expect(s1).toMatchObject({ correct: true, seasonExact: false });
    const snk = catalogue.getAnime(101)!.franchiseId;
    expect(
      catalogue.validate(S3_OP1, { text: '', pick: { kind: 'franchise', id: snk } }).correct,
    ).toBe(true);
    expect(catalogue.validate(S3_OP1, { text: '', pick: { kind: 'anime', id: 200 } }).correct).toBe(
      false,
    );
  });

  it("donne le bonus numéro seulement si l'anime est correct", () => {
    expect(catalogue.validate(S3_OP1, { text: 'snk', sequence: 1 }).sequenceExact).toBe(true);
    expect(catalogue.validate(S3_OP1, { text: 'snk', sequence: 2 }).sequenceExact).toBe(false);
    expect(catalogue.validate(S3_OP1, { text: 'one piece', sequence: 1 }).sequenceExact).toBe(
      false,
    );
  });

  it('pas de bonus saison pour un anime seul dans sa franchise', () => {
    expect(catalogue.validate(KIMI_ED, { text: 'your name' })).toMatchObject({
      correct: true,
      seasonExact: false,
    });
  });
});

describe('Catalogue.pickThemes', () => {
  it('ne tire jamais deux fois la même franchise', () => {
    const picked = catalogue.pickThemes(all, 10);
    const franchises = picked.map((t) => catalogue.getAnime(t.animeId)!.franchiseId);
    expect(picked).toHaveLength(4);
    expect(new Set(franchises).size).toBe(4);
  });

  it('applique les filtres de type, années et popularité', () => {
    const eds = catalogue.pickThemes({ ...all, types: ['ED'] }, 10);
    expect(eds.every((t) => t.type === 'ED')).toBe(true);

    const recent = catalogue.pickThemes({ ...all, yearFrom: 2010 }, 10);
    const years = recent.map((t) => catalogue.getAnime(t.animeId)!.year);
    expect(years.every((y) => y !== null && y >= 2010)).toBe(true);

    expect(catalogue.countThemes({ ...all, popularity: 100 })).toBe(catalogue.stats().themes);
  });
});

describe('Catalogue.titleIndex', () => {
  it('propose une entrée franchise pour les séries à plusieurs saisons', () => {
    const snk = catalogue.titleIndex.entries.find(
      (e) => e.k === 'f' && e.fr === "L'Attaque des Titans",
    );
    expect(snk).toBeDefined();
    const s3 = catalogue.titleIndex.entries.find((e) => e.k === 'a' && e.id === 101);
    expect(s3).toMatchObject({
      s: 1,
      fr: "L'Attaque des Titans — Saison 3",
      en: 'Attack on Titan Season 3',
    });
  });

  it("intègre le nom de la série dans l'entrée d'un anime seul", () => {
    const kimi = catalogue.titleIndex.entries.find((e) => e.k === 'a' && e.id === 300);
    expect(kimi?.s).toBeUndefined();
    expect(kimi?.t).toContain('your name');
    expect(catalogue.titleIndex.entries.some((e) => e.k === 'f' && e.id === kimi?.f)).toBe(false);
  });

  it("signale les animes à un seul opening et un seul ending (numéro d'OP/ED inutile)", () => {
    const entry = (id: number) =>
      catalogue.titleIndex.entries.find((e) => e.k === 'a' && e.id === id);
    // SnK saison 1 : OP1 et un ED (le doublage et l'insert song ne comptent pas).
    expect(entry(100)?.u).toBe(1);
    // SnK saison 3 : OP1 et OP2.
    expect(entry(101)?.u).toBeUndefined();
  });
});
