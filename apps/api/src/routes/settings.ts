import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/rbac.js';
import { AuditService } from '../services/audit.js';

const updateSettingSchema = z.object({
  value: z.unknown(),
  description: z.string().max(500).optional(),
});

const bulkUpdateSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1).max(200),
      value: z.unknown(),
    })
  ),
});

export const settingsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const audit = new AuditService(fastify.prisma);

  // GET /api/v1/settings
  fastify.get('/', {
    schema: {
      description: 'List all system settings',
      tags: ['settings'],
    },
    preHandler: [requireRole('admin')],
  }, async () => {
    const settings = await fastify.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });

    return { data: settings };
  });

  // GET /api/v1/settings/:key
  fastify.get<{ Params: { key: string } }>('/:key', {
    schema: {
      description: 'Get a specific system setting',
      tags: ['settings'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { key } = request.params;

    const setting = await fastify.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Setting "${key}" not found`,
        statusCode: 404,
      });
    }

    return { data: setting };
  });

  // PUT /api/v1/settings/:key
  fastify.put<{ Params: { key: string } }>('/:key', {
    schema: {
      description: 'Create or update a system setting',
      tags: ['settings'],
    },
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { key } = request.params;
    const body = updateSettingSchema.parse(request.body);

    const setting = await fastify.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: body.value as string,
        description: body.description,
        updatedAt: new Date(),
      },
      create: {
        key,
        value: body.value as string,
        description: body.description,
      },
    });

    await audit.log({
      userId: request.user.sub,
      action: 'setting_updated',
      details: { key, value: body.value },
    });

    return { data: setting };
  });

  // PUT /api/v1/settings (bulk)
  fastify.put('/', {
    schema: {
      description: 'Bulk update system settings',
      tags: ['settings'],
    },
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const body = bulkUpdateSchema.parse(request.body);

    const results = await fastify.prisma.$transaction(
      body.settings.map((s) =>
        fastify.prisma.systemSetting.upsert({
          where: { key: s.key },
          update: { value: s.value as string, updatedAt: new Date() },
          create: { key: s.key, value: s.value as string },
        })
      )
    );

    await audit.log({
      userId: request.user.sub,
      action: 'settings_bulk_updated',
      details: { keys: body.settings.map((s) => s.key) },
    });

    return { data: results };
  });

  // DELETE /api/v1/settings/:key
  fastify.delete<{ Params: { key: string } }>('/:key', {
    schema: {
      description: 'Delete a system setting',
      tags: ['settings'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { key } = request.params;

    const existing = await fastify.prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Setting "${key}" not found`,
        statusCode: 404,
      });
    }

    await fastify.prisma.systemSetting.delete({ where: { key } });

    await audit.log({
      userId: request.user.sub,
      action: 'setting_deleted',
      details: { key },
    });

    return { data: { message: 'Setting deleted', key } };
  });
};
