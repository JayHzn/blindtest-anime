import { describe, expect, it } from 'vitest';
import {
  AUCTION,
  AUCTION_BIDS,
  auctionOrder,
  auctionPenalty,
  auctionPoints,
  isAuctionBid,
  minPlayers,
  sanitizeSettings,
} from '../src';

describe('Enchères — barème', () => {
  it('annonces 0,5 / 1 / 3 / 5 / 10 s', () => {
    expect(AUCTION.bidsMs).toEqual([500, 1000, 3000, 5000, 10_000]);
    expect(AUCTION_BIDS).toBe(5);
  });

  it('bonne réponse : 300 / 250 / 200 / 100 / 50 selon l’annonce', () => {
    expect([0, 1, 2, 3, 4].map(auctionPoints)).toEqual([300, 250, 200, 100, 50]);
  });

  it('mauvaise réponse : −150 / −100 / −75 / −50 / −25 selon l’annonce', () => {
    expect([0, 1, 2, 3, 4].map(auctionPenalty)).toEqual([150, 100, 75, 50, 25]);
  });

  it('plus l’annonce est audacieuse, plus elle rapporte et plus elle coûte', () => {
    for (let bid = 1; bid < AUCTION_BIDS; bid++) {
      expect(auctionPoints(bid)).toBeLessThan(auctionPoints(bid - 1));
      expect(auctionPenalty(bid)).toBeLessThan(auctionPenalty(bid - 1));
      // Le gain reste toujours supérieur au risque.
      expect(auctionPoints(bid)).toBeGreaterThan(auctionPenalty(bid));
    }
  });

  it('annonce hors barème : 0 point, 0 pénalité', () => {
    expect(auctionPoints(9)).toBe(0);
    expect(auctionPenalty(-1)).toBe(0);
  });

  it('reconnaît les annonces valides', () => {
    expect([0, 4].every(isAuctionBid)).toBe(true);
    expect([-1, 5, 1.5, '1', null, undefined, Number.NaN].some(isAuctionBid)).toBe(false);
  });

  it('chrono : 8 s d’annonce, 10 s de réponse, 3 réécoutes', () => {
    expect(AUCTION.biddingMs).toBe(8000);
    expect(AUCTION.answerMs).toBe(10_000);
    expect(AUCTION.replays).toBe(3);
  });
});

describe('Enchères — ordre de passage', () => {
  it('l’annonce la plus courte a la main', () => {
    const order = auctionOrder([
      { playerId: 'lou', bid: 4, at: 100 },
      { playerId: 'sakura', bid: 0, at: 300 },
      { playerId: 'mina', bid: 3, at: 200 },
      { playerId: 'kevin', bid: 1, at: 50 },
    ]);
    expect(order.map((entry) => entry.playerId)).toEqual(['sakura', 'kevin', 'mina', 'lou']);
  });

  it('à égalité, la main revient à celui qui a annoncé le premier', () => {
    const order = auctionOrder([
      { playerId: 'b', bid: 2, at: 1200 },
      { playerId: 'a', bid: 2, at: 900 },
      { playerId: 'c', bid: 2, at: 1500 },
    ]);
    expect(order.map((entry) => entry.playerId)).toEqual(['a', 'b', 'c']);
  });

  it('ne modifie pas la liste reçue', () => {
    const bids = [
      { playerId: 'b', bid: 3, at: 1 },
      { playerId: 'a', bid: 0, at: 2 },
    ];
    auctionOrder(bids);
    expect(bids[0]!.playerId).toBe('b');
  });
});

describe('Enchères — réglages', () => {
  it('multi uniquement : 2 joueurs minimum', () => {
    expect(minPlayers('auction')).toBe(2);
    expect(minPlayers('classic')).toBe(1);
  });

  it('accepte le mode dans les réglages', () => {
    expect(sanitizeSettings({ mode: 'auction', rounds: 10 })?.mode).toBe('auction');
  });
});
