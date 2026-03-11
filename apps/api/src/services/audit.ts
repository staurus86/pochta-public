import { PrismaClient } from '@prisma/client';

export interface AuditLogEntry {
  emailId?: string;
  userId?: string;
  action: string;
  details: Record<string, unknown>;
}

/**
 * Audit logging service for tracking all significant operations.
 * Writes to the audit_logs table in PostgreSQL.
 */
export class AuditService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Record an audit log entry.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          emailId: entry.emailId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          details: entry.details,
          createdAt: new Date(),
        },
      });
    } catch (err) {
      // Audit logging should never break the main flow.
      // Log to stdout as a fallback.
      console.error('[audit] Failed to write audit log:', err);
      console.error('[audit] Entry:', JSON.stringify(entry));
    }
  }

  /**
   * Retrieve audit logs for an email.
   */
  async getByEmail(
    emailId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    return this.prisma.auditLog.findMany({
      where: { emailId },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
  }

  /**
   * Retrieve audit logs for a user.
   */
  async getByUser(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
  }

  /**
   * Retrieve audit logs by action type.
   */
  async getByAction(
    action: string,
    options: { limit?: number; offset?: number; since?: Date } = {},
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        action,
        ...(options.since ? { createdAt: { gte: options.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
  }

  /**
   * Count audit log entries in a time period (for dashboard metrics).
   */
  async countByAction(action: string, since: Date): Promise<number> {
    return this.prisma.auditLog.count({
      where: {
        action,
        createdAt: { gte: since },
      },
    });
  }
}
