import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMinRole, requireRole } from '../middleware/rbac.js';
import { ImapFetcher } from '../services/imap-fetcher.js';
import { AuditService } from '../services/audit.js';

const createInboxSchema = z.object({
  email: z.string().email(),
  label: z.string().min(1).max(100),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().positive().default(993),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  imapTls: z.boolean().default(true),
  isActive: z.boolean().default(true),
  fetchIntervalMs: z.coerce.number().int().positive().default(60_000),
  folders: z.array(z.string()).default(['INBOX']),
});

const updateInboxSchema = createInboxSchema.partial();

export const inboxAccountRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const audit = new AuditService(fastify.prisma);

  // GET /api/v1/inbox-accounts
  fastify.get('/', {
    schema: {
      description: 'List all inbox accounts',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async () => {
    const accounts = await fastify.prisma.inboxAccount.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { emails: true } },
      },
    });

    // Strip passwords from response
    const safe = accounts.map(({ imapPassword, ...rest }) => rest);
    return { data: safe };
  });

  // POST /api/v1/inbox-accounts
  fastify.post('/', {
    schema: {
      description: 'Create a new inbox account',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const body = createInboxSchema.parse(request.body);

    const existing = await fastify.prisma.inboxAccount.findFirst({
      where: { email: body.email },
    });
    if (existing) {
      return reply.status(409).send({
        error: 'Conflict',
        message: `Inbox account with email "${body.email}" already exists`,
        statusCode: 409,
      });
    }

    const account = await fastify.prisma.inboxAccount.create({
      data: {
        email: body.email,
        label: body.label,
        imapHost: body.imapHost,
        imapPort: body.imapPort,
        imapUser: body.imapUser,
        imapPassword: body.imapPassword,
        imapTls: body.imapTls,
        isActive: body.isActive,
        fetchIntervalMs: body.fetchIntervalMs,
        folders: body.folders,
      },
    });

    await audit.log({
      userId: request.user.sub,
      action: 'inbox_account_created',
      details: { email: body.email, label: body.label },
    });

    const { imapPassword, ...safe } = account;
    return reply.status(201).send({ data: safe });
  });

  // PUT /api/v1/inbox-accounts/:id
  fastify.put<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Update an inbox account',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = updateInboxSchema.parse(request.body);

    const existing = await fastify.prisma.inboxAccount.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Inbox account ${id} not found`,
        statusCode: 404,
      });
    }

    const updated = await fastify.prisma.inboxAccount.update({
      where: { id },
      data: body,
    });

    await audit.log({
      userId: request.user.sub,
      action: 'inbox_account_updated',
      details: { accountId: id, changes: Object.keys(body) },
    });

    const { imapPassword, ...safe } = updated;
    return { data: safe };
  });

  // POST /api/v1/inbox-accounts/:id/test - test IMAP connection
  fastify.post<{ Params: { id: string } }>('/:id/test', {
    schema: {
      description: 'Test IMAP connection for an inbox account',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params;

    const account = await fastify.prisma.inboxAccount.findUnique({ where: { id } });
    if (!account) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Inbox account ${id} not found`,
        statusCode: 404,
      });
    }

    const fetcher = new ImapFetcher({
      host: account.imapHost,
      port: account.imapPort,
      user: account.imapUser,
      password: account.imapPassword,
      tls: account.imapTls,
    }, request.log);

    try {
      await fetcher.connect();
      await fetcher.disconnect();

      return {
        data: {
          success: true,
          message: 'IMAP connection successful',
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown connection error';
      request.log.error({ err, accountId: id }, 'IMAP connection test failed');

      return reply.status(400).send({
        error: 'Connection Failed',
        message: `IMAP connection test failed: ${message}`,
        statusCode: 400,
      });
    }
  });

  // POST /api/v1/inbox-accounts/:id/sync - trigger manual sync
  fastify.post<{ Params: { id: string } }>('/:id/sync', {
    schema: {
      description: 'Trigger manual email fetch for an inbox account',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const { id } = request.params;

    const account = await fastify.prisma.inboxAccount.findUnique({ where: { id } });
    if (!account) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Inbox account ${id} not found`,
        statusCode: 404,
      });
    }

    await fastify.queues['email-fetch'].add('manual-fetch', {
      inboxAccountId: id,
      triggeredBy: request.user.sub,
    });

    await audit.log({
      userId: request.user.sub,
      action: 'manual_sync_triggered',
      details: { accountId: id },
    });

    return {
      data: {
        message: 'Sync job queued',
        accountId: id,
      },
    };
  });

  // GET /api/v1/inbox-accounts/:id/health
  fastify.get<{ Params: { id: string } }>('/:id/health', {
    schema: {
      description: 'Get health status of an inbox account',
      tags: ['inbox-accounts'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request, reply) => {
    const { id } = request.params;

    const account = await fastify.prisma.inboxAccount.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        isActive: true,
        lastFetchAt: true,
        lastFetchError: true,
        lastFetchCount: true,
        createdAt: true,
      },
    });

    if (!account) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Inbox account ${id} not found`,
        statusCode: 404,
      });
    }

    const recentEmailCount = await fastify.prisma.email.count({
      where: {
        inboxAccountId: id,
        receivedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    const staleSinceMs = account.lastFetchAt
      ? Date.now() - new Date(account.lastFetchAt).getTime()
      : null;

    return {
      data: {
        ...account,
        recentEmailCount,
        staleSinceMs,
        isStale: staleSinceMs !== null && staleSinceMs > 5 * 60 * 1000,
        hasError: !!account.lastFetchError,
      },
    };
  });
};
