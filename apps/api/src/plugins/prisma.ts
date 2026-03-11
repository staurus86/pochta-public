import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const prismaPluginImpl: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const prisma = new PrismaClient({
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
  });

  prisma.$on('error' as never, (e: unknown) => {
    fastify.log.error(e, 'Prisma error');
  });

  prisma.$on('warn' as never, (e: unknown) => {
    fastify.log.warn(e, 'Prisma warning');
  });

  await prisma.$connect();
  fastify.log.info('Prisma connected to database');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Disconnecting Prisma...');
    await prisma.$disconnect();
  });
};

export const prismaPlugin = fp(prismaPluginImpl, {
  name: 'prisma',
});
