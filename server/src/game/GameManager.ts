import { randomUUID } from 'node:crypto';
import {
  HIGHER_LOWER,
  minPlayers,
  sanitizeSettings,
  type GameSettings,
  type PlaylistRound,
  type StartGameError,
} from '@blindtest/shared';
import type { Catalogue } from '../catalogue/Catalogue';
import type { ThemeRow } from '../catalogue/types';
import type { AudioMirror } from '../media/AudioMirror';
import type { MediaRegistry } from '../media/MediaRegistry';
import { Game, LISTEN_LEAD_MS, type GameEmitter } from './Game';

/** Musiques de rechange tirées en plus, au cas où un audio ne charge pas. */
const SPARE_THEMES = 5;
/** Le bon OP : manches de rechange (chacune prend 4 séries au catalogue). */
const RIGHT_OP_SPARE_ROUNDS = 3;

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
  /** Playlist : manches imposées (chansons choisies et complément), dans l'ordre de jeu. */
  playlist?: PlaylistRound[];
  /** Joueurs ajoutés à la partie mais déconnectés (ils retrouvent leur place en revenant). */
  offline?: string[];
}

/** Parties en cours (solo et rooms) et rattachement joueur → partie. */
export class GameManager {
  private readonly games = new Map<string, Game>();
  private readonly gameOfPlayer = new Map<string, string>();

  constructor(
    private readonly catalogue: Catalogue | null,
    private readonly media: MediaRegistry,
    private readonly emitter: GameEmitter,
    private readonly mirror: AudioMirror | null = null,
  ) {}

  /** Crée une partie (pas encore démarrée : appeler `game.start()`). */
  create({
    players,
    settings: rawSettings,
    onFinished,
    introMs,
    audioWaitMs,
    playlist,
    offline = [],
  }: CreateGameOptions): CreateGameResult {
    if (!this.catalogue) return { ok: false, error: 'catalogue_unavailable' };
    const settings: GameSettings | null = sanitizeSettings(rawSettings);
    if (!settings) return { ok: false, error: 'invalid_settings' };
    // La Playlist ne se joue qu'en room, avec les chansons choisies.
    if ((settings.mode === 'playlist') !== Boolean(playlist)) {
      return { ok: false, error: 'invalid_settings' };
    }
    // Enchères : multi uniquement (la room vérifie avant avec une erreur explicite).
    if (
      (settings.mode === 'auction' || settings.mode === 'impostor') &&
      players.length < minPlayers(settings.mode)
    ) {
      return { ok: false, error: 'invalid_settings' };
    }

    let themes: ThemeRow[];
    let choosers: string[][] | undefined;
    let impostorThemes: ThemeRow[] | undefined;
    let rightOpTraps: ThemeRow[][] | undefined;
    if (playlist) {
      const rounds = playlist.filter((round) => this.catalogue!.getTheme(round.themeId));
      themes = rounds.map((round) => this.catalogue!.getTheme(round.themeId)!);
      choosers = rounds.map((round) => round.choosers);
      // Remplaçantes (audio injouable) : tirées avec les filtres de la room, hors séries déjà jouées.
      const used = new Set(themes.map((theme) => this.catalogue!.franchiseOfTheme(theme.id)!));
      themes.push(...this.catalogue.pickThemes(settings.filters, SPARE_THEMES, Math.random, used));
    } else if (settings.mode === 'impostor') {
      // Paires de chansons proches : celle des civils, celle de l'imposteur.
      const pairs = this.catalogue.impostorPairs(settings.filters, settings.rounds + SPARE_THEMES);
      themes = pairs.map(([civil]) => civil);
      impostorThemes = pairs.map(([, impostor]) => impostor);
    } else if (settings.mode === 'higherLower') {
      // Chaîne complète tirée d'avance (la chanson 0 est la première référence).
      themes = this.catalogue.higherLowerChain(settings.filters, HIGHER_LOWER.maxTours + 1);
      if (themes.length < 2) return { ok: false, error: 'not_enough_themes' };
    } else if (settings.mode === 'rightOp') {
      // Une chanson et 3 pièges proches par manche (4 séries chacune : peu de remplaçantes).
      const rounds = this.catalogue.rightOpRounds(
        settings.filters,
        settings.rounds + RIGHT_OP_SPARE_ROUNDS,
      );
      themes = rounds.map((round) => round.target);
      rightOpTraps = rounds.map((round) => round.traps);
    } else {
      themes = this.catalogue.pickThemes(settings.filters, settings.rounds + SPARE_THEMES);
    }
    if (themes.length === 0 || choosers?.length === 0) {
      return { ok: false, error: 'not_enough_themes' };
    }

    const game = new Game({
      id: randomUUID(),
      settings,
      catalogue: this.catalogue,
      media: this.media,
      emitter: this.emitter,
      themes,
      choosers,
      impostorThemes,
      rightOpTraps,
      mirror: this.mirror,
      introMs,
      audioWaitMs,
      listenLeadMs: LISTEN_LEAD_MS,
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
    for (const id of offline) game.disconnect(id);
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
