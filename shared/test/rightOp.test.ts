import { describe, expect, it } from 'vitest';
import {
  MODE_TIMINGS,
  RIGHT_OP,
  RIGHT_OP_LISTEN_MS,
  RIGHT_OP_ROUND_MS,
  SOLO_MODES,
  isRightOpSlot,
  minPlayers,
  rightOpAudioKey,
  rightOpPoints,
  rightOpSlotOf,
  sanitizeSettings,
} from '../src';

describe('Le bon OP — chrono et barème', () => {
  it('4 extraits de 4 s, puis 15 s de décompte (31 s par manche)', () => {
    expect(RIGHT_OP.options).toBe(4);
    expect(RIGHT_OP_LISTEN_MS).toBe(16_000);
    expect(RIGHT_OP_ROUND_MS).toBe(31_000);
    expect(MODE_TIMINGS.rightOp.listenMs).toBe(RIGHT_OP_ROUND_MS);
  });

  it('200 points pendant l’écoute des extraits (pas de décompte)', () => {
    expect(rightOpPoints(0)).toBe(200);
    expect(rightOpPoints(9000)).toBe(200);
    expect(rightOpPoints(RIGHT_OP_LISTEN_MS)).toBe(200);
  });

  it('puis de 200 à 50 pendant le décompte de 15 s', () => {
    expect(rightOpPoints(RIGHT_OP_LISTEN_MS + 7500)).toBe(125);
    expect(rightOpPoints(RIGHT_OP_ROUND_MS)).toBe(50);
    expect(rightOpPoints(RIGHT_OP_ROUND_MS + 5000)).toBe(50);
  });
});

describe('Le bon OP — index audio', () => {
  it('chaque extrait de chaque manche a son propre index', () => {
    expect(rightOpAudioKey(0, 0)).toBe(0);
    expect(rightOpAudioKey(2, 3)).toBe(11);
    expect(rightOpSlotOf(11)).toEqual({ round: 2, slot: 3 });
    const keys = new Set<number>();
    for (let round = 0; round < 10; round++) {
      for (let slot = 0; slot < RIGHT_OP.options; slot++) keys.add(rightOpAudioKey(round, slot));
    }
    expect(keys.size).toBe(40);
  });

  it('reconnaît les choix valides', () => {
    expect([0, 1, 2, 3].every(isRightOpSlot)).toBe(true);
    expect([-1, 4, 1.5, '1', null].some(isRightOpSlot)).toBe(false);
  });
});

describe('Le bon OP — réglages', () => {
  it('se joue en solo comme en room', () => {
    expect(SOLO_MODES).toContain('rightOp');
    expect(minPlayers('rightOp')).toBe(1);
    expect(sanitizeSettings({ mode: 'rightOp', rounds: 10 })?.mode).toBe('rightOp');
  });
});
