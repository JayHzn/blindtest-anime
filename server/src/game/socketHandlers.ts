import type { Socket } from 'socket.io';
import {
  isAuctionBid,
  isHigherLowerPick,
  sanitizePseudo,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@blindtest/shared';
import type { IoServer } from '../app';
import { playerChannel } from '../players';
import type { RoomManager } from '../rooms/RoomManager';
import type { GameEmitter } from './Game';
import type { GameManager } from './GameManager';
import { sanitizeAnswer, sanitizeAudioReport } from './sanitize';

export interface SocketData {
  playerId: string;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type LooseEmit = (event: string, ...args: unknown[]) => boolean;

/** Envoi à un joueur, sur tous ses sockets (salon personnel). */
export function playerEmitter(io: IoServer): GameEmitter {
  return {
    toPlayer(playerId, event, ...args) {
      (io.to(playerChannel(playerId)).emit as LooseEmit)(event, ...args);
    },
  };
}

interface Managers {
  games: GameManager;
  rooms: RoomManager;
}

export function registerSocketHandlers(socket: GameSocket, { games, rooms }: Managers): void {
  const { playerId } = socket.data;

  // Retour après une coupure : room et partie renvoient leur état.
  if (rooms.roomCodeOf(playerId)) rooms.reconnect(playerId);
  else games.reconnect(playerId);

  // ─── Solo ─────────────────────────────────────────────────────────────────

  socket.on('game:start', (payload, ack) => {
    if (typeof ack !== 'function') return;
    rooms.leave(playerId);
    const result = games.create({
      players: [{ id: playerId, pseudo: sanitizePseudo(payload?.pseudo) }],
      settings: payload?.settings,
    });
    if (!result.ok) {
      ack(result);
      return;
    }
    ack({ ok: true, snapshot: result.game.snapshot(playerId) });
    result.game.start();
  });

  socket.on('game:leave', () => games.leave(playerId));

  // ─── Pendant une partie (solo ou room) ────────────────────────────────────

  socket.on('game:answer', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const game = games.gameOf(playerId);
    ack(
      game
        ? game.answer(playerId, sanitizeAnswer(payload))
        : { accepted: false, reason: 'not_in_game' },
    );
  });

  socket.on('game:nextTier', (ack) => {
    if (typeof ack !== 'function') return;
    ack(games.gameOf(playerId)?.nextTier(playerId) ?? null);
  });

  socket.on('game:giveUp', (ack) => {
    if (typeof ack !== 'function') return;
    ack(games.gameOf(playerId)?.giveUp(playerId) ?? null);
  });

  socket.on('game:guess', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const target = payload?.target;
    if (target !== null && (typeof target !== 'string' || target.length > 100)) {
      ack(false);
      return;
    }
    ack(games.gameOf(playerId)?.guess(playerId, target) ?? false);
  });

  socket.on('auction:bid', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const bid = (payload as { bid?: unknown } | null)?.bid;
    ack(isAuctionBid(bid) ? (games.gameOf(playerId)?.bid(playerId, bid) ?? false) : false);
  });

  socket.on('auction:replay', (ack) => {
    if (typeof ack !== 'function') return;
    ack(games.gameOf(playerId)?.replay(playerId) ?? null);
  });

  socket.on('higherLower:pick', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const pick = (payload as { pick?: unknown } | null)?.pick;
    ack(isHigherLowerPick(pick) ? (games.gameOf(playerId)?.pick(playerId, pick) ?? false) : false);
  });

  socket.on('impostor:word', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const word = (payload as { word?: unknown } | null)?.word;
    ack(
      games.gameOf(playerId)?.impostorWord(playerId, word) ?? {
        ok: false,
        reason: 'not_your_turn',
      },
    );
  });

  socket.on('impostor:vote', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const target = (payload as { target?: unknown } | null)?.target;
    if (typeof target !== 'string' || target.length > 100) {
      ack(false);
      return;
    }
    ack(games.gameOf(playerId)?.impostorVote(playerId, target) ?? false);
  });

  socket.on('audio:ready', (payload) => {
    const report = sanitizeAudioReport(payload);
    if (report) games.gameOf(playerId)?.audioReady(playerId, report.round, report.url);
  });

  socket.on('audio:failed', (payload) => {
    const report = sanitizeAudioReport(payload);
    if (report) games.gameOf(playerId)?.audioFailed(playerId, report.round, report.url);
  });

  // ─── Rooms ────────────────────────────────────────────────────────────────

  socket.on('room:create', (payload, ack) => {
    if (typeof ack !== 'function') return;
    games.leave(playerId);
    ack(rooms.create(playerId, payload?.pseudo));
  });

  socket.on('room:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.join(payload?.code, playerId, payload?.pseudo));
  });

  socket.on('room:leave', () => rooms.leave(playerId));
  socket.on('room:settings', (settings) => rooms.updateSettings(playerId, settings));
  socket.on('room:ready', (ready) => rooms.setReady(playerId, ready === true));

  socket.on('room:start', (ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.start(playerId));
  });

  // ─── Playlist : phase de choix ────────────────────────────────────────────

  socket.on('playlist:songs', (payload, ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.songs(playerId, payload?.animeId));
  });

  socket.on('playlist:pick', (payload, ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.pick(playerId, payload?.token));
  });

  socket.on('playlist:unpick', (payload, ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.unpick(playerId, payload?.token));
  });

  socket.on('playlist:preview', (payload, ack) => {
    if (typeof ack !== 'function') return;
    ack(rooms.preview(playerId, payload?.token));
  });

  // ─── Déconnexion ──────────────────────────────────────────────────────────

  socket.on('disconnect', async () => {
    // Un autre onglet du même joueur est encore connecté : rien ne change.
    const stillThere = await socket.nsp.in(playerChannel(playerId)).fetchSockets();
    if (stillThere.length > 0) return;
    if (rooms.roomCodeOf(playerId)) rooms.disconnect(playerId);
    else games.disconnect(playerId);
  });
}
