/**
 * Test de fumée contre un serveur qui tourne : joue une manche complète
 * (audio via le proxy, écoute, mauvaise réponse, révélation).
 *
 *   npm run smoke -w server                       # serveur local :3001
 *   SERVER_URL=https://… npm run smoke -w server
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  RoundAudio,
  RoundReveal,
  ServerToClientEvents,
} from '@blindtest/shared';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  transports: ['websocket'],
});

const step = (label: string) => console.log(`✔ ${label}`);
const fail = (message: string): never => {
  console.error(`✘ ${message}`);
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (40 s)'), 40_000).unref();

socket.on('connect_error', (error) => fail(`connexion impossible : ${error.message}`));

socket.on('round:prepare', async (audio: RoundAudio) => {
  if (audio.round !== 0) return;
  const started = performance.now();
  const res = await fetch(`${SERVER_URL}${audio.url}`, { headers: { Range: 'bytes=0-65535' } });
  const bytes = (await res.arrayBuffer()).byteLength;
  if (res.status !== 206) fail(`proxy audio : HTTP ${res.status}`);
  step(
    `audio via le proxy : ${res.status}, ${bytes} octets, ${res.headers.get('content-type')}, ` +
      `${Math.round(performance.now() - started)} ms (départ à ${Math.round(audio.startRatio * 100)} %)`,
  );
  socket.emit('audio:ready', { round: 0, url: audio.url });
});

socket.on('round:countdown', ({ round }) => step(`compte à rebours manche ${round + 1}`));

socket.on('round:start', async ({ round, phaseEndsAt, startedAt }) => {
  step(`écoute manche ${round + 1} (${Math.round((phaseEndsAt - startedAt) / 1000)} s)`);
  const result = await socket.emitWithAck('game:answer', { text: 'zzz réponse fausse' });
  step(`mauvaise réponse → ${JSON.stringify(result)}`);
});

socket.on('round:reveal', (reveal: RoundReveal) => {
  step(
    `révélation : ${reveal.anime.title.fr} — ${reveal.theme.slug} « ${reveal.theme.song} » ` +
      `(${reveal.theme.artists}) ; vidéo : ${reveal.videoUrl ? 'oui' : 'non'}`,
  );
  socket.emit('game:leave');
  socket.disconnect();
  process.exit(0);
});

const response = await socket.emitWithAck('game:start', {
  pseudo: 'Smoke',
  settings: { mode: 'classic', rounds: 5, filters: { popularity: 100, types: ['OP', 'ED'] } },
});
if (!response.ok) fail(`démarrage refusé : ${response.error}`);
else
  step(`partie ${response.snapshot.gameId.slice(0, 8)} — ${response.snapshot.totalRounds} manches`);
