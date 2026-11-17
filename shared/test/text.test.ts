import { describe, expect, it } from 'vitest';
import { compact, editDistance, fuzzyMatch, normalize, withinOneEdit } from '../src/text';

describe('normalize', () => {
  it('ignore casse, accents, macrons et ponctuation', () => {
    expect(normalize('Shingeki no Kyojin: Season 3!')).toBe('shingeki no kyojin season 3');
    expect(normalize("L'Attaque des Titans")).toBe('l attaque des titans');
    expect(normalize('Kōkaku Kidōtai')).toBe('kokaku kidotai');
    expect(normalize('Hunter×Hunter')).toBe('hunterxhunter');
    expect(normalize('  K-ON!!  ')).toBe('k on');
  });

  it('compacte en retirant les espaces', () => {
    expect(compact(normalize('Shingeki no Kyojin'))).toBe('shingekinokyojin');
  });
});

describe('editDistance', () => {
  it('compte substitutions, insertions, suppressions et inversions', () => {
    expect(editDistance('naruto', 'naruto')).toBe(0);
    expect(editDistance('naruto', 'narito')).toBe(1);
    expect(editDistance('naruto', 'narto')).toBe(1);
    expect(editDistance('naruto', 'naruuto')).toBe(1);
    expect(editDistance('naruto', 'anruto')).toBe(1);
    expect(editDistance('bleach', 'naruto')).toBe(6);
  });

  it("s'arrête au-delà du maximum", () => {
    expect(editDistance('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
  });
});

describe('withinOneEdit', () => {
  it('équivaut à editDistance <= 1', () => {
    const pairs: [string, string][] = [
      ['naruto', 'naruto'],
      ['naruto', 'narito'],
      ['naruto', 'narto'],
      ['naruto', 'naruuto'],
      ['naruto', 'anruto'],
      ['naruto', 'nraut'],
      ['naruto', 'bleach'],
      ['shingaki', 'shingeki'],
      ['ab', 'ba'],
      ['abc', 'cab'],
      ['', 'a'],
    ];
    for (const [a, b] of pairs) {
      expect(withinOneEdit(a, b), `${a} / ${b}`).toBe(editDistance(a, b) <= 1);
    }
  });
});

describe('fuzzyMatch', () => {
  it('tolère peu de fautes sur les titres courts', () => {
    expect(fuzzyMatch('snk', 'snk')).toBe(0);
    expect(fuzzyMatch('snl', 'snk')).toBeNull();
  });

  it('tolère quelques fautes sur les titres longs', () => {
    expect(fuzzyMatch('shingekinokyojn', 'shingekinokyojin')).toBe(1);
    expect(fuzzyMatch('shingekinokyoujin', 'shingekinokyojin')).toBe(1);
    expect(fuzzyMatch('shingeki', 'shingekinokyojin')).toBeNull();
  });
});
