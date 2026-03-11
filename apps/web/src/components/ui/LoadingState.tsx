'use client';

import { cn } from '@/lib/utils';

interface LoadingStateProps {
  className?: string;
  text?: string;
}

export function LoadingState({ className, text = 'Загрузка...' }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <div className="relative w-8 h-8 mb-3">
        <div className="absolute inset-0 rounded-full border-2 border-steel-200" />
        <div className="absolute inset-0 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
      </div>
      <p className="text-sm text-steel-400">{text}</p>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse">
      <div className="h-10 bg-steel-50 rounded-t-steel mb-px" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-steel-100">
          {Array.from({ length: cols }).map((_, j) => (
            <div
              key={j}
              className="h-4 bg-steel-100 rounded"
              style={{ width: `${60 + Math.random() * 80}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
