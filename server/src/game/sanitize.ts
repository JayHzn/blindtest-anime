import type { AnswerPayload } from '@blindtest/shared';

const MAX_TEXT_LENGTH = 200;
const MAX_SEQUENCE = 999;

/** Nettoie une réponse reçue d'un client (types et bornes non garantis). */
export function sanitizeAnswer(input: unknown): AnswerPayload {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const answer: AnswerPayload = {
    text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT_LENGTH) : '',
  };

  const pick = raw.pick as Record<string, unknown> | undefined;
  if (
    pick &&
    (pick.kind === 'anime' || pick.kind === 'franchise') &&
    typeof pick.id === 'number' &&
    Number.isInteger(pick.id)
  ) {
    answer.pick = { kind: pick.kind, id: pick.id };
  }

  if (
    typeof raw.sequence === 'number' &&
    Number.isInteger(raw.sequence) &&
    raw.sequence >= 1 &&
    raw.sequence <= MAX_SEQUENCE
  ) {
    answer.sequence = raw.sequence;
  }
  return answer;
}

/** Lit `{ round, url }` envoyé par le client pour `audio:ready` / `audio:failed`. */
export function sanitizeAudioReport(input: unknown): { round: number; url: string } | null {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (typeof raw.round !== 'number' || !Number.isInteger(raw.round) || raw.round < 0) return null;
  if (typeof raw.url !== 'string' || raw.url.length > 200) return null;
  return { round: raw.round, url: raw.url };
}
