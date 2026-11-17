import { randomUUID } from 'node:crypto';
import { sanitizePseudo, sanitizeSettings, type StartGameError } from '@blindtest/shared';
import type { AudioRegistry } from '../audio/AudioRegistry';
import type { Catalogue } from '../catalogue/Catalogue';
import { Game, type GameEmitter } from './Game';

/** Musiques de rechange tirées en plus, au cas où un audio ne charge pas. */
const SPARE_THEMES = 5;

export type CreateGameResult = { ok: true; game: Game } | { ok: false; error: StartGameError };

/** Parties en cours et rattachement joueur → partie. */
export class GameManager {
  private readonly games = new Map<string, Game>();
  private readonly gameOfPlayer = new Map<string, string>();

  constructor(
    private readonly catalogue: Catalogue | null,
    private readonly audio: AudioRegistry,
    private readonly createEmitter: (gameId: string) => GameEmitter,
  ) {}

  /** Crée une partie solo (pas encore démarrée : appeler `game.start()`). */
  createSolo(playerId: string, rawPseudo: unknown, rawSettings: unknown): CreateGameResult {
    this.leave(playerId);
    if (!this.catalogue) return { ok: false, error: 'catalogue_unavailable' };
    const settings = sanitizeSettings(rawSettings);
    if (!settings) return { ok: false, error: 'invalid_settings' };

    const themes = this.catalogue.pickThemes(settings.filters, settings.rounds + SPARE_THEMES);
    if (themes.length === 0) return { ok: false, error: 'not_enough_themes' };

    const id = randomUUID();
    const game = new Game({
      id,
      settings,
      catalogue: this.catalogue,
      audio: this.audio,
      emitter: this.createEmitter(id),
      themes,
      onFinished: (finished) => this.forget(finished),
    });
    game.addPlayer(playerId, sanitizePseudo(rawPseudo));
    this.games.set(id, game);
    this.gameOfPlayer.set(playerId, id);
    return { ok: true, game };
  }

  gameOf(playerId: string): Game | undefined {
    const id = this.gameOfPlayer.get(playerId);
    return id ? this.games.get(id) : undefined;
  }

  /** Le joueur quitte sa partie (bouton Quitter ou déconnexion). */
  leave(playerId: string): void {
    const game = this.gameOf(playerId);
    this.gameOfPlayer.delete(playerId);
    game?.removePlayer(playerId);
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
