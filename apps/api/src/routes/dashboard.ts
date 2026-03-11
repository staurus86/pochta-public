import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireMinRole } from '../middleware/rbac.js';

const periodSchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
});

function getPeriodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
}

export const dashboardRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // GET /api/v1/dashboard/stats - KPIs
  fastify.get('/stats', {
    schema: {
      description: 'Get dashboard KPIs: counts by classification, review queue, SLA',
      tags: ['dashboard'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const { period } = periodSchema.parse(request.query);
    const since = getPeriodStart(period);

    const [
      totalEmails,
      byClassification,
      byStatus,
      reviewQueueSize,
      slaBreaches,
    ] = await Promise.all([
      fastify.prisma.email.count({
        where: { receivedAt: { gte: since } },
      }),

      fastify.prisma.email.groupBy({
        by: ['classification'],
        where: { receivedAt: { gte: since } },
        _count: { id: true },
      }),

      fastify.prisma.email.groupBy({
        by: ['status'],
        where: { receivedAt: { gte: since } },
        _count: { id: true },
      }),

      fastify.prisma.email.count({
        where: { status: 'needs_review' },
      }),

      // SLA: emails in review queue for more than configured hours
      fastify.prisma.email.count({
        where: {
          status: 'needs_review',
          updatedAt: {
            lte: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h SLA default
          },
        },
      }),
    ]);

    const classificationMap = Object.fromEntries(
      byClassification.map((row) => [row.classification ?? 'unknown', row._count.id])
    );
    const statusMap = Object.fromEntries(
      byStatus.map((row) => [row.status, row._count.id])
    );

    return {
      data: {
        period,
        since: since.toISOString(),
        totalEmails,
        byClassification: classificationMap,
        byStatus: statusMap,
        reviewQueueSize,
        slaBreaches,
      },
    };
  });

  // GET /api/v1/dashboard/inbox-heatmap - activity per inbox
  fastify.get('/inbox-heatmap', {
    schema: {
      description: 'Email activity heatmap per inbox account',
      tags: ['dashboard'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const { period } = periodSchema.parse(request.query);
    const since = getPeriodStart(period);

    const data = await fastify.prisma.email.groupBy({
      by: ['inboxAccountId'],
      where: { receivedAt: { gte: since } },
      _count: { id: true },
    });

    const accounts = await fastify.prisma.inboxAccount.findMany({
      select: { id: true, email: true, label: true },
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    const heatmap = data.map((row) => ({
      inboxAccountId: row.inboxAccountId,
      account: accountMap.get(row.inboxAccountId) ?? null,
      emailCount: row._count.id,
    }));

    return { data: heatmap };
  });

  // GET /api/v1/dashboard/accuracy - classification accuracy
  fastify.get('/accuracy', {
    schema: {
      description: 'Classification accuracy metrics based on reviews',
      tags: ['dashboard'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const { period } = periodSchema.parse(request.query);
    const since = getPeriodStart(period);

    const reviews = await fastify.prisma.emailReview.findMany({
      where: { createdAt: { gte: since } },
      include: {
        email: {
          select: { classification: true, classificationSource: true },
        },
      },
    });

    const totalReviewed = reviews.length;
    const approvedCount = reviews.filter((r) => r.approved).length;
    const correctedCount = totalReviewed - approvedCount;
    const accuracyRate = totalReviewed > 0 ? approvedCount / totalReviewed : 0;

    // Accuracy by source
    const bySource: Record<string, { total: number; approved: number }> = {};
    for (const review of reviews) {
      const source = review.email?.classificationSource ?? 'unknown';
      if (!bySource[source]) bySource[source] = { total: 0, approved: 0 };
      bySource[source].total += 1;
      if (review.approved) bySource[source].approved += 1;
    }

    const accuracyBySource = Object.fromEntries(
      Object.entries(bySource).map(([source, stats]) => [
        source,
        {
          ...stats,
          rate: stats.total > 0 ? stats.approved / stats.total : 0,
        },
      ])
    );

    return {
      data: {
        period,
        totalReviewed,
        approvedCount,
        correctedCount,
        accuracyRate: Number(accuracyRate.toFixed(4)),
        accuracyBySource,
      },
    };
  });

  // GET /api/v1/dashboard/conversion - email -> client -> request funnel
  fastify.get('/conversion', {
    schema: {
      description: 'Conversion funnel: emails -> clients -> CRM requests',
      tags: ['dashboard'],
    },
    preHandler: [requireMinRole('viewer')],
  }, async (request) => {
    const { period } = periodSchema.parse(request.query);
    const since = getPeriodStart(period);

    const [
      totalReceived,
      classifiedAsClient,
      matchedToCrm,
      approvedForSync,
      syncedToCrm,
    ] = await Promise.all([
      fastify.prisma.email.count({
        where: { receivedAt: { gte: since } },
      }),
      fastify.prisma.email.count({
        where: {
          receivedAt: { gte: since },
          classification: 'client',
        },
      }),
      fastify.prisma.email.count({
        where: {
          receivedAt: { gte: since },
          crmMatch: { isNot: null },
        },
      }),
      fastify.prisma.email.count({
        where: {
          receivedAt: { gte: since },
          status: 'approved',
        },
      }),
      fastify.prisma.email.count({
        where: {
          receivedAt: { gte: since },
          status: 'synced',
        },
      }),
    ]);

    return {
      data: {
        period,
        funnel: {
          totalReceived,
          classifiedAsClient,
          matchedToCrm,
          approvedForSync,
          syncedToCrm,
        },
        conversionRates: {
          classificationRate: totalReceived > 0 ? classifiedAsClient / totalReceived : 0,
          matchRate: classifiedAsClient > 0 ? matchedToCrm / classifiedAsClient : 0,
          approvalRate: matchedToCrm > 0 ? approvedForSync / matchedToCrm : 0,
          syncRate: approvedForSync > 0 ? syncedToCrm / approvedForSync : 0,
        },
      },
    };
  });
};
