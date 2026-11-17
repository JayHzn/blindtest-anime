import { describe, expect, it } from 'vitest';
import { drawPlaylist, pickingDurationMs, chooserPoints, type PlaylistPick } from '../src/playlist';

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('chooserPoints', () => {
  it('donne +50 par joueur qui n’a pas trouvé, quand certains trouvent', () => {
    expect(chooserPoints(4, 2)).toBe(100);
    expect(chooserPoints(4, 1)).toBe(150);
    expect(chooserPoints(7, 1)).toBe(300);
  });

  it('ne donne rien si tout le monde trouve, ou si personne ne trouve', () => {
    expect(chooserPoints(4, 4)).toBe(0);
    expect(chooserPoints(4, 0)).toBe(0);
    expect(chooserPoints(0, 0)).toBe(0);
  });
});

describe('pickingDurationMs', () => {
  it('laisse 60 s jusqu’à 5 chansons, 90 s pour 10', () => {
    expect(pickingDurationMs(1)).toBe(60_000);
    expect(pickingDurationMs(5)).toBe(60_000);
    expect(pickingDurationMs(10)).toBe(90_000);
  });
});

describe('drawPlaylist', () => {
  const picks: PlaylistPick[] = [
    { playerId: 'alice', themeId: 1 },
    { playerId: 'alice', themeId: 2 },
    { playerId: 'bob', themeId: 3 },
    { playerId: 'bob', themeId: 2 }, // doublon avec Alice
    { playerId: 'chloe', themeId: 4 },
    { playerId: null, themeId: 5 }, // complété au hasard
  ];

  it('joue chaque chanson une seule fois, doublons fusionnés', () => {
    const rounds = drawPlaylist(picks, seeded(1));
    expect(rounds.map((r) => r.themeId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(rounds.find((r) => r.themeId === 2)?.choosers).toEqual(['alice', 'bob']);
    expect(rounds.find((r) => r.themeId === 5)?.choosers).toEqual([]);
  });

  it('mélange selon le hasard fourni', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        drawPlaylist(picks, seeded(seed))
          .map((r) => r.themeId)
          .join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('évite deux chansons du même joueur à la suite quand c’est possible', () => {
    const many: PlaylistPick[] = ['a', 'b', 'c'].flatMap((player, p) =>
      [0, 1, 2].map((i) => ({ playerId: player, themeId: p * 10 + i })),
    );
    for (let seed = 1; seed <= 20; seed++) {
      const rounds = drawPlaylist(many, seeded(seed));
      for (let i = 1; i < rounds.length; i++) {
        expect(rounds[i]!.choosers[0]).not.toBe(rounds[i - 1]!.choosers[0]);
      }
    }
  });
});
