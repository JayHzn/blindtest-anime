import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Catalogue } from '../catalogue/Catalogue';

interface TitlesPayload {
  etag: string;
  raw: Buffer;
  gzip: Buffer;
  br: Buffer;
}

/** Compresse l'index des titres une seule fois au démarrage. */
function buildTitlesPayload(catalogue: Catalogue): TitlesPayload {
  const raw = Buffer.from(JSON.stringify(catalogue.titleIndex));
  return {
    etag: `"titles-${catalogue.version}"`,
    raw,
    gzip: gzipSync(raw, { level: 9 }),
    br: brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }),
  };
}

const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: 'catalogue_unavailable' });

export function registerCatalogueRoutes(app: FastifyInstance, catalogue: Catalogue | null) {
  const titles = catalogue ? buildTitlesPayload(catalogue) : null;

  /** Index des titres pour l'autocomplétion côté navigateur. */
  app.get('/api/titles', async (request, reply) => {
    if (!titles) return unavailable(reply);
    reply.header('ETag', titles.etag).header('Cache-Control', 'public, no-cache');
    reply.header('Vary', 'Accept-Encoding');
    if (request.headers['if-none-match'] === titles.etag) return reply.code(304).send();

    const accept = String(request.headers['accept-encoding'] ?? '');
    reply.type('application/json; charset=utf-8');
    if (/\bbr\b/.test(accept)) return reply.header('Content-Encoding', 'br').send(titles.br);
    if (/\bgzip\b/.test(accept)) return reply.header('Content-Encoding', 'gzip').send(titles.gzip);
    return reply.send(titles.raw);
  });

  app.get('/api/catalogue/stats', async (_request, reply) => {
    if (!catalogue) return unavailable(reply);
    return catalogue.stats();
  });
}
