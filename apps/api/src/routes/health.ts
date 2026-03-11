import { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['system'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string' },
                redis: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const checks: Record<string, string> = {};

    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      checks.database = 'healthy';
    } catch (err) {
      request.log.error({ err }, 'Database health check failed');
      checks.database = 'unhealthy';
    }

    try {
      const pong = await fastify.redis.ping();
      checks.redis = pong === 'PONG' ? 'healthy' : 'unhealthy';
    } catch (err) {
      request.log.error({ err }, 'Redis health check failed');
      checks.redis = 'unhealthy';
    }

    const allHealthy = Object.values(checks).every((v) => v === 'healthy');

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: checks,
    };
  });
};
