'use client';

import { cn } from '@/lib/utils';
import { EMAIL_STATUSES, type EmailStatus } from '@/lib/constants';

interface StatusBadgeProps {
  status: EmailStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = EMAIL_STATUSES[status];
  if (!config) return null;
  return (
    <span className={cn('steel-badge', config.color, className)}>
      {config.label}
    </span>
  );
}
