import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueStats, HealthResponse, TitleIndex } from '@blindtest/shared';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';
import { buildFixtureCatalogue } from './fixtures/sources';

describe('routes catalogue', () => {
  let app: App;
  const catalogue = buildFixtureCatalogue();

  beforeAll(async () => {
    app = await buildApp(config, { logger: false, catalogue });
  });

  afterAll(async () => {
    await app.fastify.close();
  });

  it("sert l'index des titres compressé avec un ETag", async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/titles',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.etag).toBe(`"titles-${catalogue.version}"`);
    const body = JSON.parse(gunzipSync(res.rawPayload).toString()) as TitleIndex;
    expect(body.entries.length).toBe(catalogue.titleIndex.entries.length);
  });

  it('répond 304 si le client a déjà la bonne version', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/titles',
      headers: { 'if-none-match': `"titles-${catalogue.version}"` },
    });
    expect(res.statusCode).toBe(304);
  });

  it('expose les stats et la version dans /api/health', async () => {
    const stats = (
      await app.fastify.inject({ url: '/api/catalogue/stats' })
    ).json<CatalogueStats>();
    expect(stats.themes).toBe(9);
    const health = (await app.fastify.inject({ url: '/api/health' })).json<HealthResponse>();
    expect(health.catalogueVersion).toBe(catalogue.version);
  });

  it('répond 503 sans catalogue', async () => {
    const empty = await buildApp(config, { logger: false });
    const res = await empty.fastify.inject({ url: '/api/titles' });
    expect(res.statusCode).toBe(503);
    await empty.fastify.close();
  });
});
