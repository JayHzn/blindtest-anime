import { describe, expect, it } from 'vitest';
import type { TitleEntry } from '../src/catalogue';
import { buildSearchIndex, search } from '../src/search';
import { normalize } from '../src/text';

const entry = (k: 'a' | 'f', id: number, f: number, titles: string[], p: number): TitleEntry => ({
  k,
  id,
  f,
  fr: titles[0]!,
  en: titles[0]!,
  t: titles.map(normalize),
  p,
});

const entries: TitleEntry[] = [
  entry('f', 1, 1, ['Shingeki no Kyojin', "L'Attaque des Titans"], 1000),
  entry('a', 10, 1, ['Shingeki no Kyojin', 'Attack on Titan'], 1000),
  entry('a', 11, 1, ['Shingeki no Kyojin Season 3', 'Attack on Titan Season 3'], 600),
  entry('a', 20, 2, ['Shingeki no Bahamut: Genesis', 'Rage of Bahamut'], 50),
  entry('a', 30, 3, ['One Piece'], 900),
  entry('a', 40, 4, ['Kimi no Na wa.', 'Your Name.'], 800),
];
const index = buildSearchIndex(entries);

describe('search', () => {
  it('met la franchise en tête puis les saisons', () => {
    const ids = search(index, 'shingeki').map((r) => `${r.entry.k}${r.entry.id}`);
    expect(ids.slice(0, 3)).toEqual(['f1', 'a10', 'a11']);
    expect(ids).toContain('a20');
  });

  it('trouve par début de mot et par titre alternatif', () => {
    expect(search(index, 'titans')[0]?.entry.id).toBe(1);
    expect(search(index, 'your name')[0]?.entry.id).toBe(40);
    expect(search(index, 'bahamut')[0]?.entry.id).toBe(20);
  });

  it('tolère une faute de frappe dans le début du titre', () => {
    expect(search(index, 'shingaki')[0]?.entry.f).toBe(1);
  });

  it('ignore les requêtes trop courtes', () => {
    expect(search(index, 's')).toEqual([]);
  });

  it('reste sous les 10 ms sur un catalogue réaliste', () => {
    const big: TitleEntry[] = [];
    for (let i = 0; i < 9000; i++) {
      big.push(
        entry('a', i, i, [`Anime numero ${i} saison ${i % 7}`, `Alt title ${i}`, `syn ${i}`], i),
      );
    }
    const bigIndex = buildSearchIndex([...big, ...entries]);
    const timings: number[] = [];
    for (const query of ['warmup', 'shingeki', 'shingeki no', 'attack on', 'kimi no', 'shingaki']) {
      const start = performance.now();
      search(bigIndex, query);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)]!;
    expect(search(bigIndex, 'shingeki')[0]?.entry.id).toBe(1);
    expect(median).toBeLessThan(10);
  });
});
