import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { Catalogue } from './catalogue/Catalogue';
import { config } from './config';

function loadCatalogue(): Catalogue | null {
  if (!existsSync(config.cataloguePath)) {
    console.warn(
      `⚠ Catalogue introuvable (${config.cataloguePath}). Lance « npm run catalogue:sync -w server ».`,
    );
    return null;
  }
  const startedAt = performance.now();
  const catalogue = Catalogue.load(config.cataloguePath);
  const { themes, anime } = catalogue.stats();
  console.log(
    `Catalogue ${catalogue.version} chargé : ${themes} musiques, ${anime} animes ` +
      `(${Math.round(performance.now() - startedAt)} ms)`,
  );
  return catalogue;
}

const { fastify } = await buildApp(config, { catalogue: loadCatalogue() });

const shutdown = async (signal: string) => {
  fastify.log.info(`${signal} reçu, arrêt du serveur`);
  await fastify.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await fastify.listen({ port: config.port, host: config.host });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
