'use client';

import { cn, confidenceColor, formatPercent } from '@/lib/utils';

interface ConfidenceBarProps {
  value: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function ConfidenceBar({ value, showLabel = true, size = 'sm', className }: ConfidenceBarProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('confidence-bar flex-1', size === 'md' ? 'h-2' : 'h-1.5')}>
        <div
          className={cn('confidence-fill', confidenceColor(value))}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('text-xs font-mono tabular-nums', value >= 0.9 ? 'text-accent-emerald' : value >= 0.7 ? 'text-accent-blue' : value >= 0.5 ? 'text-accent-amber' : 'text-accent-rose')}>
          {formatPercent(value)}
        </span>
      )}
    </div>
  );
}
