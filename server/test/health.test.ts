import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HealthResponse } from '@blindtest/shared';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';

describe('GET /api/health', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp(config, { logger: false });
  });

  afterAll(async () => {
    await app.fastify.close();
  });

  it('répond ok avec la version', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.version).toBeTypeOf('string');
  });

  it('autorise le front en CORS', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
