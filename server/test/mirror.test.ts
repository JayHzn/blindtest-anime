import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type RoundAudio } from '@blindtest/shared';
import { Game } from '../src/game/Game';
import { AudioMirror } from '../src/media/AudioMirror';
import { MediaRegistry } from '../src/media/MediaRegistry';
import { buildFixtureCatalogue } from './fixtures/sources';

const catalogue = buildFixtureCatalogue();
const BASE = 'https://audio.example.workers.dev';

/** Miroir dont la liste annonce les chansons données. */
async function mirrorWith(themes: number[]): Promise<AudioMirror> {
  const mirror = new AudioMirror(`${BASE}/`, 'secret-de-test');
  const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ themes })));
  await mirror.refresh(fakeFetch as unknown as typeof fetch);
  expect(fakeFetch).toHaveBeenCalledWith(`${BASE}/index.json`, expect.anything());
  return mirror;
}

describe('AudioMirror', () => {
  it('nomme les fichiers par une empreinte de la clé secrète, sans rien sur la chanson', () => {
    const key = AudioMirror.keyFor('secret-de-test', 1011);
    expect(key).toMatch(/^a\/[0-9a-f]{24}\.ogg$/);
    expect(AudioMirror.keyFor('secret-de-test', 1011)).toBe(key);
    expect(AudioMirror.keyFor('autre-secret', 1011)).not.toBe(key);
    expect(AudioMirror.keyFor('secret-de-test', 2001)).not.toBe(key);
  });

  it("ne donne une adresse qu'aux chansons copiées", async () => {
    const mirror = await mirrorWith([1011]);
    expect(mirror.urlFor(1011)).toBe(`${BASE}/${AudioMirror.keyFor('secret-de-test', 1011)}`);
    expect(mirror.urlFor(2001)).toBeNull();
    expect(mirror.isMirrorUrl(mirror.urlFor(1011)!)).toBe(true);
    expect(mirror.isMirrorUrl('/api/audio/abc')).toBe(false);
  });

  it('garde la liste précédente si le miroir est injoignable, et dit pourquoi', async () => {
    const mirror = await mirrorWith([1011]);
    const failure = await mirror.refresh((async () => {
      throw new Error('réseau');
    }) as unknown as typeof fetch);
    expect(failure).toContain('réseau');
    expect(mirror.size).toBe(1);
    const refused = await mirror.refresh(
      (async () => new Response('bloqué', { status: 403 })) as unknown as typeof fetch,
    );
    expect(refused).toBe('réponse 403 (bloqué)');
  });
});

describe('Game — miroir audio', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("envoie l'adresse du miroir pour une chanson copiée, le proxy sinon, et s'y replie en cas d'échec", async () => {
    vi.useRealTimers();
    const mirror = await mirrorWith([1011]);
    vi.useFakeTimers();
    const prepares: RoundAudio[] = [];
    const game = new Game({
      settings: { ...DEFAULT_SETTINGS, rounds: 2 },
      catalogue,
      media: new MediaRegistry(),
      emitter: {
        toPlayer: (_to, event, ...args) => {
          if (event === 'round:prepare') prepares.push(args[0] as RoundAudio);
        },
      },
      themes: [1011, 2001].map((id) => catalogue.getTheme(id)!),
      mirror,
    });
    game.addPlayer('p1', 'Alice');
    game.start();
    const first = prepares.find((a) => a.round === 0)!;
    const second = prepares.find((a) => a.round === 1)!;
    expect(first.url).toBe(mirror.urlFor(1011));
    expect(second.url).toMatch(/^\/api\/audio\//);

    // Le fichier du miroir ne se charge pas : même chanson, par le proxy du serveur.
    game.audioFailed('p1', 0, first.url);
    const retry = prepares.filter((a) => a.round === 0).at(-1)!;
    expect(retry.url).toMatch(/^\/api\/audio\//);
    game.audioReady('p1', 0, retry.url);
    game.close();
  });
});
