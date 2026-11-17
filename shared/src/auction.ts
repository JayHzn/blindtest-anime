/**
 * Mode Enchères (v2, multi uniquement) : chacun annonce en secret la durée d'extrait
 * qu'il lui faut ; l'annonce la plus courte a la main et répond seule, en un essai.
 * Bonne réponse : points selon l'audace. Mauvaise réponse (ou silence) : pénalité,
 * et la main passe à l'annonce suivante, qui réentend l'extrait à sa durée.
 */
import type { ThemeType } from './catalogue';
import type { LocalizedTitle } from './game';

export const AUCTION = {
  /** Annonces possibles (durée de l'extrait), de la plus audacieuse à la plus prudente. */
  bidsMs: [500, 1000, 3000, 5000, 10_000],
  /** Points d'une bonne réponse, selon l'annonce. */
  points: [300, 250, 200, 100, 50],
  /** Pénalité d'une mauvaise réponse ou d'un silence, selon l'annonce. */
  penalties: [150, 100, 75, 50, 25],
  /** Durée de l'annonce secrète (plus courte si tout le monde a annoncé). */
  biddingMs: 8000,
  /** Temps de réponse de celui qui a la main, après la fin de l'extrait. */
  answerMs: 10_000,
  /** Réécoutes de l'extrait permises à celui qui a la main (lui seul les entend). */
  replays: 3,
  /** Joueurs connectés nécessaires pour lancer une partie. */
  minPlayers: 2,
  /** Affichage de l'ordre de passage avant le premier extrait. */
  orderRevealMs: 1500,
  /** Pause après une erreur (proposition affichée) avant l'extrait du joueur suivant. */
  turnGapMs: 2000,
  /** Avance minimale de l'heure de départ commune de l'extrait (synchro des navigateurs). */
  syncLeadMs: 500,
} as const;

export const AUCTION_BIDS = AUCTION.bidsMs.length;

/** Une annonce est l'index d'une durée de `AUCTION.bidsMs` (0 = 0,5 s). */
export function isAuctionBid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < AUCTION_BIDS;
}

/** Points d'une bonne réponse pour une annonce. */
export function auctionPoints(bid: number): number {
  return AUCTION.points[bid] ?? 0;
}

/** Pénalité (positive) d'une erreur pour une annonce. */
export function auctionPenalty(bid: number): number {
  return AUCTION.penalties[bid] ?? 0;
}

export interface AuctionBidEntry {
  playerId: string;
  bid: number;
  /** Heure serveur de l'annonce (de la dernière, si le joueur a changé d'avis). */
  at: number;
}

/**
 * Ordre de passage : l'annonce la plus courte d'abord ; à égalité, celui qui a
 * annoncé le premier (horodatage serveur).
 */
export function auctionOrder(bids: readonly AuctionBidEntry[]): AuctionBidEntry[] {
  return [...bids].sort(
    (a, b) => a.bid - b.bid || a.at - b.at || (a.playerId < b.playerId ? -1 : 1),
  );
}

/** Indice affiché avant l'annonce : « ED · 2009 · Shōnen ». */
export interface AuctionHint {
  type: ThemeType;
  year: number | null;
  /** Public cible ou genre AniList, en anglais (« Shounen », « Slice of Life »…) ; traduit par le client. */
  genre: string | null;
}

/**
 * - `waiting` : pas encore son tour ;
 * - `playing` : a la main ;
 * - `found` / `wrong` : a répondu ;
 * - `silent` : n'a rien répondu dans ses 10 s (compte comme une erreur) ;
 * - `skipped` : déconnecté à son tour (sans pénalité).
 */
export type AuctionTurnStatus = 'waiting' | 'playing' | 'found' | 'wrong' | 'silent' | 'skipped';

export interface AuctionTurn {
  playerId: string;
  bid: number;
  status: AuctionTurnStatus;
  /** Proposition fausse, montrée à tous. */
  guess: LocalizedTitle | null;
  /** Points gagnés (positifs) ou pénalité (négative), 0 sinon. */
  points: number;
}

/**
 * - `bidding` : annonce secrète ;
 * - `listening` : extrait de celui qui a la main (programmé à `snippet.startsAt`) ;
 * - `answering` : il répond ;
 * - `done` : manche terminée.
 */
export type AuctionStep = 'bidding' | 'listening' | 'answering' | 'done';

export interface AuctionSnippet {
  /** Index dans l'ordre de passage. */
  turn: number;
  /** Heure serveur de départ commune de l'extrait. */
  startsAt: number;
  durationMs: number;
  /** Fin du temps de réponse (heure serveur). */
  answerEndsAt: number;
}

/** Manche d'enchères vue par un joueur (les annonces des autres restent secrètes pendant l'annonce). */
export interface AuctionView {
  hint: AuctionHint;
  step: AuctionStep;
  biddingEndsAt: number;
  /** Joueurs qui jouent cette manche (présents à son début). */
  participants: string[];
  /** Joueurs qui ont déjà annoncé (sans la durée). */
  bidders: string[];
  /** Annonce du joueur qui reçoit la vue. */
  yourBid: number | null;
  /** Ordre de passage, connu à la fin de l'annonce (vide avant). */
  order: AuctionTurn[];
  /** Tour en cours dans `order` (-1 avant le premier). */
  turn: number;
  snippet: AuctionSnippet | null;
  /** Réécoutes restantes du joueur qui reçoit la vue, s'il a la main. */
  replaysLeft: number;
  /** Vidéo (opaque) de la révélation, à précharger. */
  videoUrl: string | null;
}

/** Détail d'une manche d'enchères pour un joueur, dans les résultats. */
export interface AuctionResult {
  /** Annonce (null : n'a pas annoncé, il a regardé la manche). */
  bid: number | null;
  status: AuctionTurnStatus | null;
}
