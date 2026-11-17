import {
  AUCTION,
  auctionOrder,
  auctionPenalty,
  auctionPoints,
  type AnswerPayload,
  type AnswerResult,
  type AuctionBidEntry,
  type AuctionHint,
  type AuctionSnippet,
  type AuctionStep,
  type AuctionTurn,
  type AuctionView,
  type GamePhase,
  type LocalizedTitle,
  type PlayerRoundResult,
} from '@blindtest/shared';

/** Ce que la partie fournit à une manche d'enchères (minuterie, audio, score, catalogue). */
export interface AuctionHost {
  isConnected(playerId: string): boolean;
  /** L'audio de la manche est préchargé chez ce joueur. */
  isAudioReady(playerId: string): boolean;
  /** Minuterie unique de la partie : remplace la précédente. */
  schedule(delayMs: number, action: () => void): void;
  setPhase(phase: GamePhase, endsAt: number): void;
  /** Envoie à chaque joueur sa vue de la manche. */
  broadcastState(): void;
  isCorrect(payload: AnswerPayload): boolean;
  /** Proposition lisible (affichée à tous si elle est fausse). */
  guessTitle(payload: AnswerPayload): LocalizedTitle;
  addScore(playerId: string, delta: number): void;
  endRound(): void;
}

/**
 * Une manche du mode Enchères, arbitrée par le serveur :
 * ANNONCE (8 s, secrète) → pour chaque annonce, de la plus courte à la plus longue :
 * ÉCOUTE (extrait commun, heure de départ fixée ici) → RÉPONSE (10 s, un essai)
 * → bonne réponse : RÉVÉLATION ; erreur ou silence : pénalité, joueur suivant.
 */
export class AuctionRound {
  private step: AuctionStep = 'bidding';
  private biddingEndsAt = 0;
  private readonly bids = new Map<string, AuctionBidEntry>();
  private order: AuctionTurn[] = [];
  private turn = -1;
  private snippet: AuctionSnippet | null = null;
  private replaysLeft = 0;
  /** Le joueur qui a la main n'a pas encore son audio : son extrait attend (au plus `audioWaitMs`). */
  private waitingAudio = false;

  constructor(
    private readonly participants: readonly string[],
    private readonly hint: AuctionHint,
    private readonly videoUrl: string | null,
    private readonly host: AuctionHost,
    private readonly audioWaitMs: number,
  ) {}

  get currentStep(): AuctionStep {
    return this.step;
  }

  /** Ouvre l'annonce secrète. */
  start(): void {
    this.biddingEndsAt = Date.now() + AUCTION.biddingMs;
    this.host.setPhase('bidding', this.biddingEndsAt);
    this.host.schedule(AUCTION.biddingMs, () => this.closeBidding());
    this.host.broadcastState();
  }

  /** Annonce (ou changement d'avis) d'un joueur ; l'horodatage est celui de la dernière annonce. */
  bid(playerId: string, bid: number): boolean {
    if (this.step !== 'bidding' || !this.participants.includes(playerId)) return false;
    if (!this.host.isConnected(playerId)) return false;
    if (this.bids.get(playerId)?.bid === bid) return true;
    this.bids.set(playerId, { playerId, bid, at: Date.now() });
    this.host.broadcastState();
    // Tout le monde a annoncé : inutile d'attendre la fin des 8 s.
    if (this.everyoneBid()) this.host.schedule(0, () => this.closeBidding());
    return true;
  }

  answer(playerId: string, payload: AnswerPayload): AnswerResult {
    const entry = this.order[this.turn];
    const snippet = this.snippet;
    const now = Date.now();
    if ((this.step !== 'listening' && this.step !== 'answering') || !entry || !snippet) {
      return { accepted: false, reason: 'not_listening' };
    }
    if (entry.playerId !== playerId) return { accepted: false, reason: 'not_your_turn' };
    if (now < snippet.startsAt || now > snippet.answerEndsAt) {
      return { accepted: false, reason: 'not_listening' };
    }

    if (this.host.isCorrect(payload)) {
      const points = auctionPoints(entry.bid);
      entry.status = 'found';
      entry.points = points;
      this.host.addScore(playerId, points);
      this.step = 'done';
      this.host.broadcastState();
      // Révélation après l'accusé de réception de la réponse.
      this.host.schedule(0, () => this.host.endRound());
      return { accepted: true, correct: true, points, seasonExact: false, sequenceExact: false };
    }
    const penalty = this.miss(this.host.guessTitle(payload));
    return {
      accepted: true,
      correct: false,
      points: -penalty,
      seasonExact: false,
      sequenceExact: false,
    };
  }

  /** Celui qui a la main réécoute l'extrait (lui seul) ; renvoie les réécoutes restantes. */
  replay(playerId: string): number | null {
    const entry = this.order[this.turn];
    if (this.step !== 'answering' || entry?.playerId !== playerId || this.replaysLeft <= 0) {
      return null;
    }
    if (!this.snippet || Date.now() > this.snippet.answerEndsAt) return null;
    this.replaysLeft--;
    return this.replaysLeft;
  }

  audioReady(playerId: string): void {
    if (this.waitingAudio && this.order[this.turn]?.playerId === playerId) {
      this.launch(Date.now() + AUCTION.syncLeadMs);
    }
  }

  /** Un joueur se déconnecte ou quitte la partie. */
  playerLost(playerId: string): void {
    if (this.step === 'bidding') {
      if (this.everyoneBid()) this.host.schedule(0, () => this.closeBidding());
      return;
    }
    const entry = this.order[this.turn];
    if ((this.step === 'listening' || this.step === 'answering') && entry?.playerId === playerId) {
      // Parti pendant son tour : la main passe, sans pénalité.
      entry.status = 'skipped';
      this.nextTurn(AUCTION.turnGapMs);
    }
  }

  hasFound(playerId: string): boolean {
    return this.order.some((entry) => entry.playerId === playerId && entry.status === 'found');
  }

  view(forPlayer: string): AuctionView {
    const holder = this.order[this.turn]?.playerId;
    return {
      hint: this.hint,
      step: this.step,
      biddingEndsAt: this.biddingEndsAt,
      participants: [...this.participants],
      bidders: [...this.bids.keys()],
      yourBid: this.bids.get(forPlayer)?.bid ?? null,
      // Les annonces des autres restent secrètes jusqu'à la fin de l'annonce.
      order: this.step === 'bidding' ? [] : this.turns(),
      turn: this.turn,
      snippet: this.snippet,
      replaysLeft: holder === forPlayer ? this.replaysLeft : 0,
      videoUrl: this.videoUrl,
    };
  }

  turns(): AuctionTurn[] {
    return this.order.map((entry) => ({ ...entry }));
  }

  resultFor(playerId: string): PlayerRoundResult {
    const entry = this.order.find((turn) => turn.playerId === playerId);
    return {
      playerId,
      correct: entry?.status === 'found',
      points: entry?.points ?? 0,
      elapsedMs: null,
      seasonExact: false,
      sequenceExact: false,
      tier: null,
      auction: { bid: this.bids.get(playerId)?.bid ?? null, status: entry?.status ?? null },
    };
  }

  // ─── Déroulement ──────────────────────────────────────────────────────────

  private everyoneBid(): boolean {
    const present = this.participants.filter((id) => this.host.isConnected(id));
    return this.bids.size > 0 && present.every((id) => this.bids.has(id));
  }

  private closeBidding(): void {
    if (this.step !== 'bidding') return;
    this.order = auctionOrder([...this.bids.values()]).map(({ playerId, bid }) => ({
      playerId,
      bid,
      status: 'waiting',
      guess: null,
      points: 0,
    }));
    // Personne n'a annoncé : révélation directe.
    if (this.order.length === 0) {
      this.finish();
      return;
    }
    this.nextTurn(AUCTION.orderRevealMs);
  }

  /** Passe la main à l'annonce suivante (en sautant les absents), ou termine la manche. */
  private nextTurn(gapMs: number): void {
    this.snippet = null;
    this.waitingAudio = false;
    this.turn++;
    while (
      this.turn < this.order.length &&
      !this.host.isConnected(this.order[this.turn]!.playerId)
    ) {
      this.order[this.turn]!.status = 'skipped';
      this.turn++;
    }
    const entry = this.order[this.turn];
    if (!entry) {
      // Tout le monde s'est trompé : révélation directe, après avoir vu la dernière proposition.
      this.step = 'done';
      this.host.broadcastState();
      this.host.schedule(gapMs, () => this.finish());
      return;
    }
    entry.status = 'playing';
    this.replaysLeft = AUCTION.replays;
    this.step = 'listening';
    const startsAt = Date.now() + Math.max(gapMs, AUCTION.syncLeadMs);
    if (this.host.isAudioReady(entry.playerId)) {
      this.launch(startsAt);
      return;
    }
    // Son audio n'est pas prêt : on l'attend un peu, puis l'extrait part quand même.
    this.waitingAudio = true;
    const waitMs = Math.max(gapMs, this.audioWaitMs);
    this.host.setPhase('listening', Date.now() + waitMs);
    this.host.broadcastState();
    this.host.schedule(waitMs, () => this.launch(Date.now() + AUCTION.syncLeadMs));
  }

  /** Programme l'extrait commun à `startsAt` (heure serveur), puis le temps de réponse. */
  private launch(startsAt: number): void {
    const entry = this.order[this.turn];
    if (!entry) return;
    this.waitingAudio = false;
    const durationMs = AUCTION.bidsMs[entry.bid]!;
    const snippet: AuctionSnippet = {
      turn: this.turn,
      startsAt,
      durationMs,
      answerEndsAt: startsAt + durationMs + AUCTION.answerMs,
    };
    this.snippet = snippet;
    this.step = 'listening';
    this.host.setPhase('listening', startsAt + durationMs);
    this.host.broadcastState();
    this.host.schedule(Math.max(0, startsAt + durationMs - Date.now()), () => {
      this.step = 'answering';
      this.host.setPhase('answering', snippet.answerEndsAt);
      this.host.broadcastState();
      // Silence pendant 10 s : compte comme une erreur.
      this.host.schedule(AUCTION.answerMs, () => this.miss(null));
    });
  }

  /** Erreur ou silence : pénalité, proposition montrée à tous, main au suivant. */
  private miss(guess: LocalizedTitle | null): number {
    const entry = this.order[this.turn]!;
    const penalty = auctionPenalty(entry.bid);
    entry.status = guess ? 'wrong' : 'silent';
    entry.guess = guess;
    entry.points = -penalty;
    this.host.addScore(entry.playerId, -penalty);
    this.nextTurn(AUCTION.turnGapMs);
    return penalty;
  }

  private finish(): void {
    this.step = 'done';
    this.snippet = null;
    this.host.endRound();
  }
}
