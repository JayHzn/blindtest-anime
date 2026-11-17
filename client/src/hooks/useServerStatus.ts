import { useEffect, useState } from 'react';
import type { HealthResponse } from '@blindtest/shared';
import { apiUrl } from '../lib/server';

export type ServerStatus = 'connecting' | 'waking' | 'ready' | 'unreachable';

/** Au-delà de ce délai sans réponse, on considère que le serveur Render se réveille. */
const WAKING_AFTER_MS = 2500;
/** Un réveil Render peut prendre ~1 min : on abandonne au bout de 90 s. */
const GIVE_UP_AFTER_MS = 90_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 2000;

async function ping(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as HealthResponse;
    return body.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Réveille le back dès l'ouverture du site et suit son état.
 * Le joueur peut taper son pseudo pendant que le serveur démarre.
 */
export function useServerStatus(): { status: ServerStatus; retry: () => void } {
  const [status, setStatus] = useState<ServerStatus>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const wakingTimer = window.setTimeout(() => {
      setStatus((current) => (current === 'connecting' ? 'waking' : current));
    }, WAKING_AFTER_MS);

    const loop = async () => {
      while (!controller.signal.aborted) {
        if (await ping(controller.signal)) {
          setStatus('ready');
          return;
        }
        if (controller.signal.aborted) return;
        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          setStatus('unreachable');
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      }
    };
    void loop();

    return () => {
      controller.abort();
      window.clearTimeout(wakingTimer);
    };
  }, [attempt]);

  const retry = () => {
    setStatus('connecting');
    setAttempt((n) => n + 1);
  };

  return { status, retry };
}
