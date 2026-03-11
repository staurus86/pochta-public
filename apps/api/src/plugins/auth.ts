import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export type UserRole = 'admin' | 'operator' | 'viewer';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

const authPluginImpl: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid or missing authentication token',
          statusCode: 401,
        });
      }
    }
  );

  fastify.addHook('onRequest', async (request, reply) => {
    const publicPaths = ['/health', '/docs', '/docs/'];
    const path = request.routeOptions?.url ?? request.url;

    if (publicPaths.some((p) => path.startsWith(p))) {
      return;
    }

    if (path === '/' || path === '/favicon.ico') {
      return;
    }

    await fastify.authenticate(request, reply);
  });
};

export const authPlugin = fp(authPluginImpl, {
  name: 'auth',
  dependencies: ['@fastify/jwt'],
});
