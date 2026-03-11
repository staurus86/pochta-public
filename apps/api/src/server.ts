import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';

import { config } from './config.js';
import { prismaPlugin } from './plugins/prisma.js';
import { redisPlugin } from './plugins/redis.js';
import { authPlugin } from './plugins/auth.js';

import { healthRoutes } from './routes/health.js';
import { emailRoutes } from './routes/emails.js';
import { inboxAccountRoutes } from './routes/inbox-accounts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { clientRoutes } from './routes/clients.js';
import { templateRoutes } from './routes/templates.js';
import { settingsRoutes } from './routes/settings.js';

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestId: undefined,
    genReqId: () => crypto.randomUUID(),
  });

  // --- Plugins ---

  await server.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await server.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });

  await server.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  await server.register(multipart, {
    limits: {
      fileSize: config.ATTACHMENT_MAX_SIZE_MB * 1024 * 1024,
    },
  });

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Pochta CRM API',
        description: 'Email parsing CRM module API',
        version: '0.1.0',
      },
      servers: [{ url: `http://${config.HOST}:${config.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // --- App plugins ---
  await server.register(prismaPlugin);
  await server.register(redisPlugin);
  await server.register(authPlugin);

  // --- Routes ---
  await server.register(healthRoutes);
  await server.register(emailRoutes, { prefix: '/api/v1/emails' });
  await server.register(inboxAccountRoutes, { prefix: '/api/v1/inbox-accounts' });
  await server.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await server.register(clientRoutes, { prefix: '/api/v1/clients' });
  await server.register(templateRoutes, { prefix: '/api/v1/templates' });
  await server.register(settingsRoutes, { prefix: '/api/v1/settings' });

  // --- Global error handler ---
  server.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled error');

    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: error.message,
        statusCode: 400,
      });
    }

    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      message: statusCode >= 500 ? 'An unexpected error occurred' : error.message,
      statusCode,
    });
  });

  return server;
}

async function start() {
  const server = await buildServer();

  try {
    await server.listen({ host: config.HOST, port: config.PORT });
    server.log.info(`Server listening on http://${config.HOST}:${config.PORT}`);
    server.log.info(`Swagger docs at http://${config.HOST}:${config.PORT}/docs`);
  } catch (err) {
    server.log.fatal(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
