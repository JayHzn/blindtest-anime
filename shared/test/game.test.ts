import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, classicPoints, sanitizePseudo, sanitizeSettings } from '../src/game';

describe('classicPoints', () => {
  it('décroît de 200 à 50 points sur la durée d’écoute', () => {
    expect(classicPoints(0, 15_000)).toBe(200);
    expect(classicPoints(7500, 15_000)).toBe(125);
    expect(classicPoints(15_000, 15_000)).toBe(50);
    expect(classicPoints(20_000, 15_000)).toBe(50);
  });
});

describe('sanitizeSettings', () => {
  it('garde des réglages valides', () => {
    const settings = {
      mode: 'classic',
      rounds: 12,
      filters: { popularity: 100, types: ['OP'], yearFrom: 2000, yearTo: 2010 },
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  it('borne et corrige les valeurs invalides', () => {
    expect(
      sanitizeSettings({
        rounds: 999,
        filters: { popularity: 42, types: ['XX'], yearFrom: 2020, yearTo: 1990 },
      }),
    ).toEqual({
      mode: 'classic',
      rounds: 30,
      filters: { popularity: 500, types: ['OP', 'ED'], yearFrom: 1990, yearTo: 2020 },
    });
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ mode: 'progressive' })?.mode).toBe('progressive');
    expect(sanitizeSettings({ mode: 'inconnu' })?.mode).toBe('classic');
    expect(sanitizeSettings(null)).toBeNull();
  });
});

describe('sanitizePseudo', () => {
  it('nettoie et limite le pseudo', () => {
    expect(sanitizePseudo('  Sakura   chan ')).toBe('Sakura chan');
    expect(sanitizePseudo('x'.repeat(50))).toHaveLength(20);
    expect(sanitizePseudo('   ')).toBe('Joueur');
    expect(sanitizePseudo(42)).toBe('Joueur');
  });
});
