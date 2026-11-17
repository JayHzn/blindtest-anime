import { buildApp } from './app';
import { config } from './config';

const { fastify } = await buildApp(config);

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
