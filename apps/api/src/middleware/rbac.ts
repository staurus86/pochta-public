import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '../plugins/auth.js';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 100,
  operator: 50,
  viewer: 10,
};

/**
 * Creates a preHandler hook that enforces minimum role requirements.
 * Roles follow a hierarchy: admin > operator > viewer.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;

    if (!user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    if (!allowedRoles.includes(user.role)) {
      request.log.warn(
        { userId: user.sub, role: user.role, required: allowedRoles },
        'RBAC access denied'
      );
      return reply.status(403).send({
        error: 'Forbidden',
        message: `This action requires one of: ${allowedRoles.join(', ')}`,
        statusCode: 403,
      });
    }
  };
}

/**
 * Creates a preHandler hook that enforces minimum role level.
 * e.g. requireMinRole('operator') allows 'operator' and 'admin'.
 */
export function requireMinRole(minRole: UserRole) {
  const minLevel = ROLE_HIERARCHY[minRole];

  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user;

    if (!user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    if (userLevel < minLevel) {
      request.log.warn(
        { userId: user.sub, role: user.role, minRole },
        'RBAC access denied - insufficient role level'
      );
      return reply.status(403).send({
        error: 'Forbidden',
        message: `This action requires at least "${minRole}" role`,
        statusCode: 403,
      });
    }
  };
}
