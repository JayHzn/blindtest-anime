import { describe, expect, it } from 'vitest';
import {
  compareHigherLower,
  higherLowerListenMs,
  inRatioWindow,
  pickOpensAfterMs,
  popularityRatio,
  ratioWindow,
  sanitizeSettings,
  type PlayerScore,
} from '../src';

const player = (id: string, score: number, eliminatedAt?: number): PlayerScore => ({
  id,
  pseudo: id,
  score,
  found: false,
  connected: true,
  ...(eliminatedAt !== undefined && { eliminatedAt }),
});

describe('Plus ou moins', () => {
  it("resserre l'écart au fil des tours", () => {
    expect(ratioWindow(1)).toEqual({ min: 1.5, max: null });
    expect(ratioWindow(3)).toEqual({ min: 1.5, max: null });
    expect(ratioWindow(4)).toEqual({ min: 1.3, max: 3 });
    expect(ratioWindow(7)).toEqual({ min: 1.2, max: 2 });
    expect(ratioWindow(10)).toEqual({ min: 1.1, max: 1.5 });
    expect(ratioWindow(30)).toEqual({ min: 1.1, max: 1.5 });
  });

  it("calcule l'écart dans les deux sens, 0 si une popularité manque", () => {
    expect(popularityRatio(640_095, 274_446)).toBeCloseTo(2.33, 2);
    expect(popularityRatio(274_446, 640_095)).toBeCloseTo(2.33, 2);
    expect(popularityRatio(0, 1000)).toBe(0);
    expect(inRatioWindow(3, ratioWindow(5))).toBe(true);
    expect(inRatioWindow(3.1, ratioWindow(5))).toBe(false);
    expect(inRatioWindow(1.4, ratioWindow(2))).toBe(false);
  });

  it('tour 1 : A, B puis 10 s ; ensuite la nouvelle chanson puis 10 s', () => {
    expect(higherLowerListenMs(1)).toBe(30_000);
    expect(higherLowerListenMs(2)).toBe(20_000);
    expect(pickOpensAfterMs(1)).toBe(10_000);
    expect(pickOpensAfterMs(2)).toBe(0);
  });

  it("classe par tour d'élimination, puis par bonnes réponses", () => {
    const ranking = [
      player('kevin', 1, 2),
      player('late', 0, 0),
      player('lea', 3, 4),
      player('sakura', 8, 10),
      player('yuki', 9),
    ].sort(compareHigherLower);
    expect(ranking.map((p) => p.id)).toEqual(['yuki', 'sakura', 'lea', 'kevin', 'late']);
  });

  it('est un mode solo comme multi', () => {
    expect(sanitizeSettings({ mode: 'higherLower' })?.mode).toBe('higherLower');
  });
});
