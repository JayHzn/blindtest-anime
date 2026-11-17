import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import type { AudioRegistry } from '../audio/AudioRegistry';

const USER_AGENT = 'blindtest-anime/0.1 (personal project)';
const UPSTREAM_TIMEOUT_MS = 15_000;
/** En-têtes de la source relayés au navigateur (rien qui révèle le nom du fichier). */
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
const TOKEN_PATTERN = /^[\w-]{10,64}$/;

/**
 * Proxy audio : `/api/audio/:token` relaie le fichier depuis le CDN AnimeThemes,
 * requêtes partielles (Range) comprises pour que le navigateur puisse démarrer
 * la lecture au milieu de la chanson.
 */
export function registerAudioRoutes(app: FastifyInstance, registry: AudioRegistry) {
  app.get<{ Params: { token: string } }>(
    '/api/audio/:token',
    // Le CDN refuse les requêtes HEAD : on ne les expose pas.
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { token } = request.params;
      const url = TOKEN_PATTERN.test(token) ? registry.resolve(token) : null;
      if (!url) return reply.code(404).send({ error: 'unknown_audio' });

      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      const range = request.headers.range;
      if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      // Si le navigateur abandonne (changement de manche, seek), on coupe la source.
      request.raw.on('close', () => controller.abort());

      let upstream: Response;
      try {
        upstream = await fetch(url, { headers, signal: controller.signal });
      } catch (error) {
        clearTimeout(timeout);
        request.log.warn({ err: error }, 'audio : source injoignable');
        return reply.code(502).send({ error: 'audio_unavailable' });
      }
      clearTimeout(timeout);

      if (!upstream.ok || !upstream.body) {
        request.log.warn({ status: upstream.status }, 'audio : réponse invalide de la source');
        return reply.code(upstream.status === 416 ? 416 : 502).send({ error: 'audio_unavailable' });
      }

      reply.code(upstream.status);
      for (const name of FORWARDED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) reply.header(name, value);
      }
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
    },
  );
}
