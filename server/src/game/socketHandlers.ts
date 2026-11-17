import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@blindtest/shared';
import type { IoServer } from '../app';
import type { GameEmitter } from './Game';
import type { GameManager } from './GameManager';
import { sanitizeAnswer, sanitizeAudioReport } from './sanitize';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type LooseEmit = (event: string, ...args: unknown[]) => boolean;

export const gameRoom = (gameId: string): string => `game:${gameId}`;

/** Émetteur Socket.IO d'une partie : un joueur = un socket (salon = son id). */
export function socketEmitter(io: IoServer, gameId: string): GameEmitter {
  return {
    toPlayer(playerId, event, ...args) {
      (io.to(playerId).emit as LooseEmit)(event, ...args);
    },
    toAll(event, ...args) {
      (io.to(gameRoom(gameId)).emit as LooseEmit)(event, ...args);
    },
  };
}

export function registerGameHandlers(socket: GameSocket, manager: GameManager): void {
  const leaveCurrent = () => {
    const game = manager.gameOf(socket.id);
    if (game) void socket.leave(gameRoom(game.id));
    manager.leave(socket.id);
  };

  socket.on('game:start', (payload, ack) => {
    if (typeof ack !== 'function') return;
    leaveCurrent();
    const result = manager.createSolo(socket.id, payload?.pseudo, payload?.settings);
    if (!result.ok) {
      ack(result);
      return;
    }
    const { game } = result;
    void socket.join(gameRoom(game.id));
    ack({ ok: true, snapshot: game.snapshot(socket.id) });
    game.start();
  });

  socket.on('game:answer', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const game = manager.gameOf(socket.id);
    ack(
      game
        ? game.answer(socket.id, sanitizeAnswer(payload))
        : { accepted: false, reason: 'not_in_game' },
    );
  });

  socket.on('game:nextTier', (ack) => {
    if (typeof ack !== 'function') return;
    ack(manager.gameOf(socket.id)?.nextTier(socket.id) ?? null);
  });

  socket.on('audio:ready', (payload) => {
    const report = sanitizeAudioReport(payload);
    if (report) manager.gameOf(socket.id)?.audioReady(socket.id, report.round, report.url);
  });

  socket.on('audio:failed', (payload) => {
    const report = sanitizeAudioReport(payload);
    if (report) manager.gameOf(socket.id)?.audioFailed(socket.id, report.round, report.url);
  });

  socket.on('game:leave', leaveCurrent);
  socket.on('disconnect', () => manager.leave(socket.id));
}
