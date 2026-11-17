import { randomUUID } from 'node:crypto';
import { sanitizeSettings, type GameSettings, type StartGameError } from '@blindtest/shared';
import type { Catalogue } from '../catalogue/Catalogue';
import type { MediaRegistry } from '../media/MediaRegistry';
import { Game, type GameEmitter } from './Game';

/** Musiques de rechange tirées en plus, au cas où un audio ne charge pas. */
const SPARE_THEMES = 5;

export type CreateGameResult = { ok: true; game: Game } | { ok: false; error: StartGameError };

export interface CreateGameOptions {
  players: { id: string; pseudo: string }[];
  settings: unknown;
  /** Appelé quand la partie se termine ou s'arrête. */
  onFinished?: (game: Game) => void;
  /** Écran d'intro de la première manche (room). */
  introMs?: number;
  /** Attente maximale des retardataires (room : 3 s). */
  audioWaitMs?: number;
}

/** Parties en cours (solo et rooms) et rattachement joueur → partie. */
export class GameManager {
  private readonly games = new Map<string, Game>();
  private readonly gameOfPlayer = new Map<string, string>();

  constructor(
    private readonly catalogue: Catalogue | null,
    private readonly media: MediaRegistry,
    private readonly emitter: GameEmitter,
  ) {}

  /** Crée une partie (pas encore démarrée : appeler `game.start()`). */
  create({
    players,
    settings: rawSettings,
    onFinished,
    introMs,
    audioWaitMs,
  }: CreateGameOptions): CreateGameResult {
    if (!this.catalogue) return { ok: false, error: 'catalogue_unavailable' };
    const settings: GameSettings | null = sanitizeSettings(rawSettings);
    if (!settings) return { ok: false, error: 'invalid_settings' };

    const themes = this.catalogue.pickThemes(settings.filters, settings.rounds + SPARE_THEMES);
    if (themes.length === 0) return { ok: false, error: 'not_enough_themes' };

    const game = new Game({
      id: randomUUID(),
      settings,
      catalogue: this.catalogue,
      media: this.media,
      emitter: this.emitter,
      themes,
      introMs,
      audioWaitMs,
      onFinished: (finished) => {
        this.forget(finished);
        onFinished?.(finished);
      },
    });
    for (const player of players) {
      this.leave(player.id);
      game.addPlayer(player.id, player.pseudo);
      this.gameOfPlayer.set(player.id, game.id);
    }
    this.games.set(game.id, game);
    return { ok: true, game };
  }

  /** Ajoute un joueur à une partie en cours (arrivée dans une room pendant la partie). */
  join(game: Game, playerId: string, pseudo: string): void {
    if (this.gameOf(playerId) !== game) this.leave(playerId);
    this.gameOfPlayer.set(playerId, game.id);
    game.addPlayer(playerId, pseudo);
  }

  gameOf(playerId: string): Game | undefined {
    const id = this.gameOfPlayer.get(playerId);
    return id ? this.games.get(id) : undefined;
  }

  /** Le joueur quitte sa partie (bouton Quitter, sortie de room). */
  leave(playerId: string): void {
    const game = this.gameOf(playerId);
    this.gameOfPlayer.delete(playerId);
    game?.leave(playerId);
  }

  /** Coupure réseau : le joueur garde sa place. */
  disconnect(playerId: string): void {
    this.gameOf(playerId)?.disconnect(playerId);
  }

  /** Reconnexion : la partie renvoie l'état complet au joueur. */
  reconnect(playerId: string): void {
    this.gameOf(playerId)?.reconnect(playerId);
  }

  get activeGames(): number {
    return this.games.size;
  }

  /** Arrête toutes les parties (arrêt du serveur). */
  closeAll(): void {
    // Copie : `close()` retire la partie de la map pendant l'itération.
    for (const game of [...this.games.values()]) game.close();
  }

  private forget(game: Game): void {
    this.games.delete(game.id);
    for (const [playerId, gameId] of this.gameOfPlayer) {
      if (gameId === game.id) this.gameOfPlayer.delete(playerId);
    }
  }
}
