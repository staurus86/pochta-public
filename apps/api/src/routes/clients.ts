import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMinRole, requireRole } from '../middleware/rbac.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  hasInn: z.coerce.boolean().optional(),
});

const createClientSchema = z.object({
  legalName: z.string().min(1).max(500),
  inn: z.string().max(12).optional(),
  kpp: z.string().max(9).optional(),
  ogrn: z.string().max(15).optional(),
  domain: z.string().max(200).optional(),
  website: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
  curatorMopId: z.string().uuid().optional(),
  curatorMozId: z.string().uuid().optional(),
});

const updateClientSchema = createClientSchema.partial();

const createContactSchema = z.object({
  fullName: z.string().min(1).max(300),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  position: z.string().max(200).optional(),
  isPrimary: z.boolean().default(false),
});

export const clientRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // GET /api/v1/clients
  fastify.get('/', {
    schema: {
      description: 'List CRM clients with search and pagination',
      tags: ['clients'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, ...filters } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.search) {
      where.OR = [
        { legalName: { contains: filters.search, mode: 'insensitive' } },
        { inn: { contains: filters.search } },
        { domain: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.hasInn === true) {
      where.inn = { not: null };
    } else if (filters.hasInn === false) {
      where.inn = null;
    }

    const [clients, total] = await Promise.all([
      fastify.prisma.crmClient.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          contacts: { take: 3, orderBy: { isPrimary: 'desc' } },
          _count: { select: { emails: true, contacts: true } },
        },
      }),
      fastify.prisma.crmClient.count({ where }),
    ]);

    return {
      data: clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // GET /api/v1/clients/:id
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get a single client with contacts and recent emails',
      tags: ['clients'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const { id } = request.params;

    const client = await fastify.prisma.crmClient.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { isPrimary: 'desc' } },
        emails: {
          orderBy: { receivedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            subject: true,
            senderEmail: true,
            receivedAt: true,
            classification: true,
            status: true,
          },
        },
      },
    });

    if (!client) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Client ${id} not found`,
        statusCode: 404,
      });
    }

    return { data: client };
  });

  // POST /api/v1/clients
  fastify.post('/', {
    schema: {
      description: 'Create a new CRM client',
      tags: ['clients'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const body = createClientSchema.parse(request.body);

    if (body.inn) {
      const existing = await fastify.prisma.crmClient.findFirst({
        where: { inn: body.inn },
      });
      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Client with INN "${body.inn}" already exists (id: ${existing.id})`,
          statusCode: 409,
        });
      }
    }

    const client = await fastify.prisma.crmClient.create({ data: body });
    return reply.status(201).send({ data: client });
  });

  // PUT /api/v1/clients/:id
  fastify.put<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Update a CRM client',
      tags: ['clients'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = updateClientSchema.parse(request.body);

    const existing = await fastify.prisma.crmClient.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Client ${id} not found`,
        statusCode: 404,
      });
    }

    const updated = await fastify.prisma.crmClient.update({
      where: { id },
      data: body,
    });

    return { data: updated };
  });

  // POST /api/v1/clients/:id/contacts
  fastify.post<{ Params: { id: string } }>('/:id/contacts', {
    schema: {
      description: 'Add a contact person to a client',
      tags: ['clients'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = createContactSchema.parse(request.body);

    const client = await fastify.prisma.crmClient.findUnique({ where: { id } });
    if (!client) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Client ${id} not found`,
        statusCode: 404,
      });
    }

    const contact = await fastify.prisma.crmContact.create({
      data: {
        ...body,
        clientId: id,
      },
    });

    return reply.status(201).send({ data: contact });
  });
};
