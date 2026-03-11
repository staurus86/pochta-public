'use client';

import { cn } from '@/lib/utils';
import { CLASSIFICATIONS, type Classification } from '@/lib/constants';

interface ClassificationBadgeProps {
  classification: Classification;
  className?: string;
}

export function ClassificationBadge({ classification, className }: ClassificationBadgeProps) {
  const config = CLASSIFICATIONS[classification];
  if (!config) return null;
  return (
    <span className={cn('steel-badge', config.color, className)}>
      {config.label}
    </span>
  );
}
