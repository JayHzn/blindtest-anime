import {
  IMPOSTOR,
  checkWord,
  type AnswerPayload,
  type AnswerResult,
  type GamePhase,
  type ImpostorElimination,
  type ImpostorPlayerResult,
  type ImpostorSong,
  type ImpostorStep,
  type ImpostorTally,
  type ImpostorView,
  type ImpostorWinner,
  type ImpostorWord,
  type ImpostorWordError,
  type PlayerRoundResult,
} from '@blindtest/shared';

/** Ce que la partie fournit à une manche d'Imposteur. */
export interface ImpostorHost {
  isConnected(playerId: string): boolean;
  /** Minuterie unique de la partie : remplace la précédente. */
  schedule(delayMs: number, action: () => void): void;
  setPhase(phase: GamePhase, endsAt: number): void;
  /** Envoie à chaque joueur sa vue de la manche. */
  broadcastState(): void;
  /** Chanson d'un joueur (null : il n'a pas de rôle dans la manche). */
  songOf(playerId: string): ImpostorSong | null;
  /** Mots du titre de la chanson d'un joueur (refusés comme indices). */
  titleWordsOf(playerId: string): ReadonlySet<string>;
  /** La proposition désigne la chanson de l'imposteur. */
  isImpostorSong(payload: AnswerPayload): boolean;
  addScore(playerId: string, delta: number): void;
  endRound(): void;
}

/**
 * Une manche du mode Imposteur, arbitrée par le serveur :
 * ÉCOUTE (15 s) → INDICES (un mot chacun, 20 s, ordre au hasard) → VOTE
 * (→ REVOTE entre ex æquo) → ÉLIMINATION (rôle révélé) → tour suivant, jusqu'à :
 * - plus d'imposteur : les civils gagnent, puis DEVINETTE de la chanson de l'imposteur ;
 * - autant d'imposteurs que de civils (ou trop de tours) : les imposteurs gagnent.
 */
export class ImpostorRound {
  private step: ImpostorStep = 'listening';
  private stepEndsAt = 0;
  private tour = 0;
  private listenStartsAt = 0;
  private alive: string[];
  private order: string[] = [];
  private turn = -1;
  private readonly words: ImpostorWord[] = [];
  private readonly usedWords = new Set<string>();
  private readonly votes = new Map<string, string>();
  private candidates: string[] = [];
  private readonly eliminations: ImpostorElimination[] = [];
  private tally: ImpostorTally[] = [];
  private lastEliminated: string | null = null;
  private winner: ImpostorWinner | null = null;
  private readonly guesses = new Map<string, boolean>();
  private readonly points = new Map<string, number>();

  constructor(
    private readonly participants: readonly string[],
    private readonly impostors: readonly string[],
    private readonly voteMs: number,
    private readonly host: ImpostorHost,
    private readonly random: () => number = Math.random,
  ) {
    this.alive = [...participants];
  }

  get currentStep(): ImpostorStep {
    return this.step;
  }

  /** Lance l'extrait commun (heure de départ fixée ici), puis le premier tour d'indices. */
  start(): void {
    this.listenStartsAt = Date.now() + IMPOSTOR.syncLeadMs;
    this.setStep('listening', this.listenStartsAt + IMPOSTOR.listenMs);
    this.host.schedule(this.stepEndsAt - Date.now(), () => this.startTour());
    this.host.broadcastState();
  }

  /** Le joueur qui a la parole donne son mot. */
  word(playerId: string, text: unknown): { ok: true } | { ok: false; reason: ImpostorWordError } {
    if (this.step !== 'words' || this.order[this.turn] !== playerId) {
      return { ok: false, reason: 'not_your_turn' };
    }
    const checked = checkWord(text, this.host.titleWordsOf(playerId), this.usedWords);
    if (!checked.ok) return checked;
    this.usedWords.add(checked.key);
    this.words.push({ playerId, tour: this.tour, word: checked.word });
    // Tour suivant après l'accusé de réception (remplace la minuterie des 20 s).
    this.host.schedule(0, () => this.nextTurn());
    return { ok: true };
  }

  /** Vote (ou changement d'avis) d'un joueur encore en jeu. */
  vote(playerId: string, target: string): boolean {
    if (this.step !== 'voting' && this.step !== 'revote') return false;
    if (!this.canVote(playerId) || target === playerId || !this.alive.includes(target)) {
      return false;
    }
    if (this.step === 'revote' && !this.candidates.includes(target)) return false;
    this.votes.set(playerId, target);
    this.host.broadcastState();
    if (this.voters().every((id) => this.votes.has(id))) {
      this.host.schedule(0, () => this.closeVote());
    }
    return true;
  }

  /** Civils gagnants : un essai pour deviner la chanson de l'imposteur. */
  guess(playerId: string, payload: AnswerPayload): AnswerResult {
    if (this.step !== 'guessing') return { accepted: false, reason: 'not_listening' };
    if (!this.guessers().includes(playerId)) return { accepted: false, reason: 'not_in_game' };
    if (this.guesses.has(playerId)) return { accepted: false, reason: 'already_found' };
    const correct = this.host.isImpostorSong(payload);
    this.guesses.set(playerId, correct);
    this.host.broadcastState();
    if (this.guessers().every((id) => this.guesses.has(id))) {
      this.host.schedule(0, () => this.finish());
    }
    return {
      accepted: true,
      correct,
      points: correct ? IMPOSTOR.guessPoints : 0,
      seasonExact: false,
      sequenceExact: false,
    };
  }

  /** Un joueur se déconnecte ou quitte la partie : on ne l'attend plus. */
  playerLost(playerId: string): void {
    if (this.step === 'words' && this.order[this.turn] === playerId) {
      this.words.push({ playerId, tour: this.tour, word: null });
      this.host.schedule(0, () => this.nextTurn());
    } else if (this.step === 'voting' || this.step === 'revote') {
      this.host.broadcastState();
      if (this.voters().every((id) => this.votes.has(id))) {
        this.host.schedule(0, () => this.closeVote());
      }
    } else if (this.step === 'guessing') {
      if (this.guessers().every((id) => this.guesses.has(id))) {
        this.host.schedule(0, () => this.finish());
      }
    }
  }

  view(forPlayer: string): ImpostorView {
    return {
      step: this.step,
      stepEndsAt: this.stepEndsAt,
      tour: this.tour,
      listenStartsAt: this.listenStartsAt,
      song: this.host.songOf(forPlayer),
      participants: [...this.participants],
      alive: [...this.alive],
      impostorCount: this.impostors.length,
      order: [...this.order],
      turn: this.turn,
      words: this.words.map((entry) => ({ ...entry })),
      voters: [...this.votes.keys()],
      yourVote: this.votes.get(forPlayer) ?? null,
      candidates: [...this.candidates],
      eliminations: this.eliminations.map((entry) => ({ ...entry })),
      tally: this.tally.map((entry) => ({ ...entry })),
      lastEliminated: this.lastEliminated,
      winner: this.winner,
      guessers: [...this.guesses.keys()],
      yourGuess: this.guesses.get(forPlayer) ?? null,
    };
  }

  /** Mots de la manche (révélation). */
  allWords(): ImpostorWord[] {
    return this.words.map((entry) => ({ ...entry }));
  }

  results(): ImpostorPlayerResult[] {
    return this.participants.map((playerId) => ({
      playerId,
      impostor: this.impostors.includes(playerId),
      eliminatedAt: this.eliminations.find((e) => e.playerId === playerId)?.tour ?? null,
      guessed: this.guesses.get(playerId) ?? null,
      points: this.points.get(playerId) ?? 0,
    }));
  }

  get result(): ImpostorWinner | null {
    return this.winner;
  }

  resultFor(playerId: string): PlayerRoundResult {
    const points = this.points.get(playerId) ?? 0;
    return {
      playerId,
      correct: points > 0,
      points,
      elapsedMs: null,
      seasonExact: false,
      sequenceExact: false,
      tier: null,
    };
  }

  // ─── Déroulement ──────────────────────────────────────────────────────────

  private setStep(step: ImpostorStep, endsAt: number): void {
    this.step = step;
    this.stepEndsAt = endsAt;
    this.host.setPhase('listening', endsAt);
  }

  private startTour(): void {
    this.tour++;
    this.order = this.shuffle([...this.alive]);
    this.turn = -1;
    this.lastEliminated = null;
    this.tally = [];
    this.nextTurn();
  }

  /** Parole au joueur suivant (un absent passe son tour, « … »), puis le vote. */
  private nextTurn(): void {
    this.turn++;
    while (this.turn < this.order.length && !this.host.isConnected(this.order[this.turn]!)) {
      this.words.push({ playerId: this.order[this.turn]!, tour: this.tour, word: null });
      this.turn++;
    }
    if (this.turn >= this.order.length) {
      this.startVote();
      return;
    }
    const playerId = this.order[this.turn]!;
    this.setStep('words', Date.now() + IMPOSTOR.wordMs);
    this.host.schedule(IMPOSTOR.wordMs, () => {
      this.words.push({ playerId, tour: this.tour, word: null });
      this.nextTurn();
    });
    this.host.broadcastState();
  }

  private startVote(): void {
    this.votes.clear();
    this.candidates = [];
    this.setStep('voting', Date.now() + this.voteMs);
    this.host.schedule(this.voteMs, () => this.closeVote());
    this.host.broadcastState();
  }

  /** Joueurs qui votent : encore en jeu et connectés (en revote, sauf les ex æquo). */
  private voters(): string[] {
    return this.alive.filter((id) => this.canVote(id));
  }

  private canVote(playerId: string): boolean {
    return (
      this.alive.includes(playerId) &&
      this.host.isConnected(playerId) &&
      !this.candidates.includes(playerId)
    );
  }

  private closeVote(): void {
    if (this.step !== 'voting' && this.step !== 'revote') return;
    const counts = new Map<string, number>();
    for (const target of this.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
    const pool = this.step === 'revote' ? this.candidates : this.alive;
    this.tally = pool
      .map((playerId) => ({ playerId, votes: counts.get(playerId) ?? 0 }))
      .sort((a, b) => b.votes - a.votes);
    const top = this.tally[0]?.votes ?? 0;
    const leaders = this.tally.filter((entry) => entry.votes === top && top > 0);

    if (leaders.length === 1) {
      this.eliminate(leaders[0]!.playerId);
    } else if (leaders.length > 1 && this.step === 'voting') {
      // Égalité : revote entre les ex æquo, qui ne votent pas.
      this.candidates = leaders.map((entry) => entry.playerId);
      this.votes.clear();
      if (this.voters().length === 0) {
        this.eliminate(null);
        return;
      }
      this.setStep('revote', Date.now() + IMPOSTOR.revoteMs);
      this.host.schedule(IMPOSTOR.revoteMs, () => this.closeVote());
      this.host.broadcastState();
    } else {
      // Nouvelle égalité, ou aucun vote : personne n'est éliminé.
      this.eliminate(null);
    }
  }

  private eliminate(playerId: string | null): void {
    this.lastEliminated = playerId;
    this.candidates = [];
    if (playerId) {
      this.alive = this.alive.filter((id) => id !== playerId);
      this.eliminations.push({
        playerId,
        tour: this.tour,
        impostor: this.impostors.includes(playerId),
      });
    }
    this.setStep('elimination', Date.now() + IMPOSTOR.eliminationMs);
    this.host.schedule(IMPOSTOR.eliminationMs, () => this.afterElimination());
    this.host.broadcastState();
  }

  private afterElimination(): void {
    const impostorsAlive = this.alive.filter((id) => this.impostors.includes(id)).length;
    const civilsAlive = this.alive.length - impostorsAlive;
    if (impostorsAlive === 0) {
      this.civilsWin();
    } else if (impostorsAlive >= civilsAlive || this.tour >= IMPOSTOR.maxTours) {
      this.winner = 'impostors';
      this.finish();
    } else {
      this.startTour();
    }
  }

  private civilsWin(): void {
    this.winner = 'civils';
    if (this.guessers().length === 0) {
      this.finish();
      return;
    }
    this.setStep('guessing', Date.now() + IMPOSTOR.guessMs);
    this.host.schedule(IMPOSTOR.guessMs, () => this.finish());
    this.host.broadcastState();
  }

  /** Civils encore en jeu et connectés : ils devinent la chanson de l'imposteur. */
  private guessers(): string[] {
    return this.alive.filter((id) => !this.impostors.includes(id) && this.host.isConnected(id));
  }

  /** Points de la manche, puis la révélation. */
  private finish(): void {
    if (this.step === 'done') return;
    this.step = 'done';
    for (const playerId of this.participants) {
      const impostor = this.impostors.includes(playerId);
      let points = 0;
      if (this.winner === 'civils' && !impostor) {
        points = IMPOSTOR.civilWinPoints + (this.guesses.get(playerId) ? IMPOSTOR.guessPoints : 0);
      } else if (this.winner === 'impostors' && impostor) {
        points = IMPOSTOR.impostorWinPoints;
      }
      this.points.set(playerId, points);
      if (points > 0) this.host.addScore(playerId, points);
    }
    this.host.endRound();
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
