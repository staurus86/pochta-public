import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMinRole, requireRole } from '../middleware/rbac.js';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  scope: z.enum(['subject', 'body', 'attachment', 'domain', 'all']),
  classifier: z.string().min(1),
  matchType: z.enum(['regex', 'contains', 'exact']),
  pattern: z.string().min(1),
  weight: z.coerce.number().int().min(-10).max(100).default(1),
  isActive: z.boolean().default(true),
});

const updateTemplateSchema = createTemplateSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: z.string().optional(),
  classifier: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const templateRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // GET /api/v1/templates
  fastify.get('/', {
    schema: {
      description: 'List template rules with filters',
      tags: ['templates'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.scope) where.scope = filters.scope;
    if (filters.classifier) where.classifier = filters.classifier;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    const [templates, total] = await Promise.all([
      fastify.prisma.templateRule.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ classifier: 'asc' }, { weight: 'desc' }],
      }),
      fastify.prisma.templateRule.count({ where }),
    ]);

    return {
      data: templates,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  });

  // GET /api/v1/templates/:id
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get a single template rule',
      tags: ['templates'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const { id } = request.params;

    const template = await fastify.prisma.templateRule.findUnique({ where: { id } });
    if (!template) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Template rule ${id} not found`,
        statusCode: 404,
      });
    }

    return { data: template };
  });

  // POST /api/v1/templates
  fastify.post('/', {
    schema: {
      description: 'Create a new template rule',
      tags: ['templates'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const body = createTemplateSchema.parse(request.body);

    // Validate regex pattern
    if (body.matchType === 'regex') {
      try {
        new RegExp(body.pattern, 'iu');
      } catch {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Invalid regex pattern: "${body.pattern}"`,
          statusCode: 400,
        });
      }
    }

    const template = await fastify.prisma.templateRule.create({ data: body });
    return reply.status(201).send({ data: template });
  });

  // PUT /api/v1/templates/:id
  fastify.put<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Update a template rule',
      tags: ['templates'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = updateTemplateSchema.parse(request.body);

    const existing = await fastify.prisma.templateRule.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Template rule ${id} not found`,
        statusCode: 404,
      });
    }

    if (body.matchType === 'regex' && body.pattern) {
      try {
        new RegExp(body.pattern, 'iu');
      } catch {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Invalid regex pattern: "${body.pattern}"`,
          statusCode: 400,
        });
      }
    }

    const updated = await fastify.prisma.templateRule.update({
      where: { id },
      data: body,
    });

    return { data: updated };
  });

  // DELETE /api/v1/templates/:id
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Delete a template rule',
      tags: ['templates'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;

    const existing = await fastify.prisma.templateRule.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Template rule ${id} not found`,
        statusCode: 404,
      });
    }

    await fastify.prisma.templateRule.delete({ where: { id } });
    return { data: { message: 'Template rule deleted', id } };
  });

  // POST /api/v1/templates/test - test a pattern against sample text
  fastify.post('/test', {
    schema: {
      description: 'Test a template pattern against sample text',
      tags: ['templates'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const schema = z.object({
      pattern: z.string().min(1),
      matchType: z.enum(['regex', 'contains', 'exact']),
      sampleText: z.string().min(1).max(10000),
    });
    const body = schema.parse(request.body);

    let matches = false;
    let matchDetails: string[] = [];

    try {
      const haystack = body.sampleText.toLowerCase();
      if (body.matchType === 'contains') {
        matches = haystack.includes(body.pattern.toLowerCase());
      } else if (body.matchType === 'exact') {
        matches = haystack.trim() === body.pattern.toLowerCase().trim();
      } else if (body.matchType === 'regex') {
        const regex = new RegExp(body.pattern, 'giu');
        const found = body.sampleText.matchAll(regex);
        matchDetails = Array.from(found).map((m) => m[0]);
        matches = matchDetails.length > 0;
      }
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: err instanceof Error ? err.message : 'Pattern evaluation failed',
        statusCode: 400,
      });
    }

    return {
      data: {
        matches,
        matchCount: matchDetails.length,
        matchDetails: matchDetails.slice(0, 20),
      },
    };
  });
};
