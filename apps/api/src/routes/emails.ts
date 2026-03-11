import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMinRole, requireRole } from '../middleware/rbac.js';
import { AuditService } from '../services/audit.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
  inboxAccountId: z.string().uuid().optional(),
  classification: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['receivedAt', 'createdAt', 'classification']).default('receivedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const classifyBodySchema = z.object({
  classification: z.string().min(1),
  reason: z.string().optional(),
});

const reviewBodySchema = z.object({
  approved: z.boolean(),
  corrections: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
});

const approveBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

export const emailRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const audit = new AuditService(fastify.prisma);

  // GET /api/v1/emails - list with filters
  fastify.get('/', {
    schema: {
      description: 'List emails with filters and pagination',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const { page, limit, sortBy, sortOrder, ...filters } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.inboxAccountId) where.inboxAccountId = filters.inboxAccountId;
    if (filters.classification) where.classification = filters.classification;
    if (filters.dateFrom || filters.dateTo) {
      where.receivedAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }
    if (filters.search) {
      where.OR = [
        { subject: { contains: filters.search, mode: 'insensitive' } },
        { senderEmail: { contains: filters.search, mode: 'insensitive' } },
        { senderName: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [emails, total] = await Promise.all([
      fastify.prisma.email.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          inboxAccount: { select: { id: true, email: true, label: true } },
          _count: { select: { attachments: true } },
        },
      }),
      fastify.prisma.email.count({ where }),
    ]);

    return {
      data: emails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // GET /api/v1/emails/:id - get single email with relations
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get email with all relations',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const { id } = request.params;

    const email = await fastify.prisma.email.findUnique({
      where: { id },
      include: {
        inboxAccount: true,
        attachments: true,
        extractedEntities: true,
        classificationResult: true,
        crmMatch: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    return { data: email };
  });

  // POST /api/v1/emails/:id/classify - manual classification override
  fastify.post<{ Params: { id: string } }>('/:id/classify', {
    schema: {
      description: 'Override email classification manually',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = classifyBodySchema.parse(request.body);

    const email = await fastify.prisma.email.findUnique({ where: { id } });
    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    const previousClassification = email.classification;

    const updated = await fastify.prisma.email.update({
      where: { id },
      data: {
        classification: body.classification,
        classificationSource: 'manual',
        status: 'classified',
      },
    });

    await audit.log({
      emailId: id,
      userId: request.user.sub,
      action: 'classification_override',
      details: {
        previous: previousClassification,
        new: body.classification,
        reason: body.reason,
      },
    });

    return { data: updated };
  });

  // POST /api/v1/emails/:id/review - submit operator review
  fastify.post<{ Params: { id: string } }>('/:id/review', {
    schema: {
      description: 'Submit operator review for an email',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = reviewBodySchema.parse(request.body);

    const email = await fastify.prisma.email.findUnique({ where: { id } });
    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    const review = await fastify.prisma.emailReview.create({
      data: {
        emailId: id,
        reviewerId: request.user.sub,
        approved: body.approved,
        corrections: body.corrections ?? {},
        notes: body.notes,
      },
    });

    const newStatus = body.approved ? 'reviewed' : 'needs_correction';
    await fastify.prisma.email.update({
      where: { id },
      data: { status: newStatus },
    });

    await audit.log({
      emailId: id,
      userId: request.user.sub,
      action: 'review_submitted',
      details: {
        approved: body.approved,
        corrections: body.corrections,
        notes: body.notes,
      },
    });

    return { data: review };
  });

  // POST /api/v1/emails/:id/approve - approve for CRM sync
  fastify.post<{ Params: { id: string } }>('/:id/approve', {
    schema: {
      description: 'Approve email for CRM synchronization',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = approveBodySchema.parse(request.body);

    const email = await fastify.prisma.email.findUnique({ where: { id } });
    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    if (email.status !== 'reviewed') {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email must be in "reviewed" status before approval',
        statusCode: 400,
      });
    }

    const updated = await fastify.prisma.email.update({
      where: { id },
      data: { status: 'approved' },
    });

    // Enqueue for CRM sync
    await fastify.queues['email-sync'].add('sync-to-crm', {
      emailId: id,
      approvedBy: request.user.sub,
    });

    await audit.log({
      emailId: id,
      userId: request.user.sub,
      action: 'approved_for_sync',
      details: { notes: body.notes },
    });

    return { data: updated };
  });

  // POST /api/v1/emails/:id/reprocess - reprocess email through pipeline
  fastify.post<{ Params: { id: string } }>('/:id/reprocess', {
    schema: {
      description: 'Reprocess email through the full pipeline',
      tags: ['emails'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;

    const email = await fastify.prisma.email.findUnique({ where: { id } });
    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    await fastify.prisma.email.update({
      where: { id },
      data: { status: 'pending' },
    });

    await fastify.queues['email-parse'].add('reprocess', {
      emailId: id,
      reprocessedBy: request.user.sub,
    });

    await audit.log({
      emailId: id,
      userId: request.user.sub,
      action: 'reprocess_requested',
      details: {},
    });

    return { data: { message: 'Email queued for reprocessing', emailId: id } };
  });

  // GET /api/v1/emails/:id/thread - get email thread
  fastify.get<{ Params: { id: string } }>('/:id/thread', {
    schema: {
      description: 'Get the email thread for a given email',
      tags: ['emails'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const { id } = request.params;

    const email = await fastify.prisma.email.findUnique({
      where: { id },
      select: { threadId: true },
    });

    if (!email) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Email ${id} not found`,
        statusCode: 404,
      });
    }

    if (!email.threadId) {
      return { data: [] };
    }

    const thread = await fastify.prisma.email.findMany({
      where: { threadId: email.threadId },
      orderBy: { receivedAt: 'asc' },
      include: {
        inboxAccount: { select: { id: true, email: true, label: true } },
      },
    });

    return { data: thread };
  });
};
