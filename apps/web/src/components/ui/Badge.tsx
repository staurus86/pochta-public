'use client';

import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'steel';
  className?: string;
}

const badgeVariants = {
  default: 'bg-steel-100 text-steel-600',
  blue: 'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  rose: 'bg-rose-50 text-rose-700',
  violet: 'bg-violet-50 text-violet-700',
  steel: 'bg-steel-100 text-steel-500',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('steel-badge', badgeVariants[variant], className)}>
      {children}
    </span>
  );
}
