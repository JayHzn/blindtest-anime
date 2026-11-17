import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';

/** Fausse source audio locale qui gère les requêtes partielles comme le CDN. */
async function startUpstream(): Promise<{ server: FastifyInstance; url: string }> {
  const file = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  const server = Fastify();
  server.get('/ShingekiNoKyojin-OP1.ogg', async (request, reply) => {
    const match = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
    reply.header('Content-Type', 'audio/ogg').header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', 'inline; filename="ShingekiNoKyojin-OP1.ogg"');
    if (!match) return reply.send(file);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : file.length - 1;
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${file.length}`)
      .send(file.subarray(start, end + 1));
  });
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  return { server, url: `${address}/ShingekiNoKyojin-OP1.ogg` };
}

describe('proxy audio', () => {
  let app: App;
  let upstream: { server: FastifyInstance; url: string };

  beforeAll(async () => {
    upstream = await startUpstream();
    app = await buildApp(config, { logger: false });
  });

  afterAll(async () => {
    await app.fastify.close();
    await upstream.server.close();
  });

  it('relaie le fichier complet', async () => {
    const token = app.audio.register(upstream.url);
    const res = await app.fastify.inject({ url: `/api/audio/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/ogg');
    expect(res.rawPayload.length).toBe(1000);
  });

  it('relaie les requêtes partielles (Range)', async () => {
    const token = app.audio.register(upstream.url);
    const res = await app.fastify.inject({
      url: `/api/audio/${token}`,
      headers: { range: 'bytes=100-199' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 100-199/1000');
    expect(res.rawPayload[0]).toBe(100);
    expect(res.rawPayload.length).toBe(100);
  });

  it('ne révèle jamais le nom du fichier', async () => {
    const token = app.audio.register(upstream.url);
    const res = await app.fastify.inject({ url: `/api/audio/${token}` });
    expect(JSON.stringify(res.headers)).not.toContain('Shingeki');
  });

  it('refuse un jeton inconnu ou révoqué', async () => {
    const token = app.audio.register(upstream.url);
    app.audio.revoke(token);
    expect((await app.fastify.inject({ url: `/api/audio/${token}` })).statusCode).toBe(404);
    expect((await app.fastify.inject({ url: '/api/audio/nimportequoi' })).statusCode).toBe(404);
  });
});
