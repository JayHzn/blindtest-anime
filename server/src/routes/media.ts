import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MediaKind, MediaRegistry } from '../media/MediaRegistry';

const USER_AGENT = 'blindtest-anime/0.1 (personal project)';
const UPSTREAM_TIMEOUT_MS = 15_000;
/** En-têtes de la source relayés au navigateur (rien qui révèle le nom du fichier). */
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
const TOKEN_PATTERN = /^[\w-]{10,64}$/;

/**
 * Le CDN vidéo d'AnimeThemes répond 503 dès qu'on enchaîne les requêtes
 * (environ une toutes les 2 à 3 s tolérée). On espace donc les appels et on
 * réessaie : le préchargement pendant l'écoute laisse le temps.
 */
const RETRY_POLICY: Record<MediaKind, { attempts: number; delayMs: number }> = {
  audio: { attempts: 3, delayMs: 800 },
  video: { attempts: 8, delayMs: 1500 },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Proxy média : relaie les fichiers depuis les CDN AnimeThemes, requêtes partielles
 * (Range) comprises, derrière des URL opaques.
 */
export function registerMediaRoutes(app: FastifyInstance, registry: MediaRegistry) {
  for (const kind of ['audio', 'video'] as const) {
    app.get<{ Params: { token: string } }>(
      `/api/${kind}/:token`,
      // Le CDN refuse les requêtes HEAD : on ne les expose pas.
      { exposeHeadRoute: false },
      (request, reply) => relay(kind, registry, request, reply),
    );
  }
}

async function relay(
  kind: MediaKind,
  registry: MediaRegistry,
  request: FastifyRequest<{ Params: { token: string } }>,
  reply: FastifyReply,
) {
  const { token } = request.params;
  const url = TOKEN_PATTERN.test(token) ? registry.resolve(token, kind) : null;
  if (!url) return reply.code(404).send({ error: 'unknown_media' });

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  const range = request.headers.range;
  if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;

  // Si le navigateur abandonne (changement de manche, seek), on coupe la source.
  const clientGone = new AbortController();
  request.raw.on('close', () => clientGone.abort());

  const { attempts, delayMs } = RETRY_POLICY[kind];
  let upstream: Response | null = null;
  for (let attempt = 1; attempt <= attempts && !clientGone.signal.aborted; attempt++) {
    try {
      upstream = await fetch(url, {
        headers,
        signal: AbortSignal.any([clientGone.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      });
    } catch (error) {
      if (clientGone.signal.aborted) return reply;
      request.log.warn({ err: error, kind }, 'média : source injoignable');
      upstream = null;
    }
    if (upstream && upstream.status !== 503 && upstream.status !== 429) break;
    await upstream?.body?.cancel();
    if (attempt < attempts) await sleep(delayMs);
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    request.log.warn({ status: upstream?.status, kind }, 'média : indisponible');
    await upstream?.body?.cancel();
    return reply.code(upstream?.status === 416 ? 416 : 502).send({ error: 'media_unavailable' });
  }

  reply.code(upstream.status);
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) reply.header(name, value);
  }
  reply.header('Cache-Control', 'private, max-age=3600');
  return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
}
