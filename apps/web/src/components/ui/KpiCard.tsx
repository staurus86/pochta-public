'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  accent?: 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'steel';
  className?: string;
}

const accentStyles = {
  blue: 'from-blue-500/10 to-transparent border-blue-200/50',
  emerald: 'from-emerald-500/10 to-transparent border-emerald-200/50',
  amber: 'from-amber-500/10 to-transparent border-amber-200/50',
  rose: 'from-rose-500/10 to-transparent border-rose-200/50',
  violet: 'from-violet-500/10 to-transparent border-violet-200/50',
  steel: 'from-steel-500/10 to-transparent border-steel-200/50',
};

const iconStyles = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
  steel: 'bg-steel-100 text-steel-600',
};

export function KpiCard({ title, value, icon, trend, accent = 'steel', className }: KpiCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-steel border bg-white shadow-steel p-4',
        'bg-gradient-to-br',
        accentStyles[accent],
        className,
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-steel-500 uppercase tracking-wider">
          {title}
        </span>
        <div className={cn('w-8 h-8 rounded-md flex items-center justify-center', iconStyles[accent])}>
          {icon}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-steel-900 tabular-nums leading-none">
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium pb-0.5',
              trend.value > 0
                ? 'text-accent-emerald'
                : trend.value < 0
                  ? 'text-accent-rose'
                  : 'text-steel-400',
            )}
          >
            {trend.value > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : trend.value < 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <Minus className="w-3 h-3" />
            )}
            {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}
