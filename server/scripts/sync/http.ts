/**
 * Requêtes HTTP de la synchro : rythme limité, respect des Retry-After, reprises sur erreur.
 */

export const USER_AGENT = 'blindtest-anime-sync/0.1 (personal project)';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private nextSlot = 0;

  constructor(private readonly requestsPerMinute: number) {}

  async wait(): Promise<void> {
    const interval = 60_000 / this.requestsPerMinute;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + interval;
    if (slot > now) await sleep(slot - now);
  }

  /** Repousse toutes les requêtes suivantes (après un 429). */
  pause(ms: number): void {
    this.nextSlot = Math.max(this.nextSlot, Date.now() + ms);
  }
}

export interface RequestOptions {
  limiter: RateLimiter;
  init?: RequestInit;
  label: string;
  retries?: number;
}

export async function fetchJson<T>(url: string, options: RequestOptions): Promise<T> {
  const { limiter, init, label, retries = 6 } = options;
  for (let attempt = 0; ; attempt++) {
    await limiter.wait();
    let response: Response | null = null;
    let failure: unknown = null;
    try {
      response = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...init?.headers },
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      failure = error;
    }

    if (response?.ok) return (await response.json()) as T;

    const status = response?.status ?? 0;
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt >= retries) {
      const detail = failure instanceof Error ? failure.message : `HTTP ${status}`;
      throw new Error(`${label} : échec (${detail}) — ${url}`);
    }

    const retryAfter = Number(response?.headers.get('retry-after'));
    const delay =
      status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000 + 500
        : Math.min(60_000, 2000 * 2 ** attempt);
    if (status === 429) limiter.pause(delay);
    console.warn(`  ${label} : ${status || 'erreur réseau'}, nouvel essai dans ${delay / 1000}s`);
    await sleep(delay);
  }
}
