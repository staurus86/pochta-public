'use client';

import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Ошибка загрузки',
  message = 'Не удалось загрузить данные. Попробуйте позже.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-accent-rose" />
      </div>
      <h3 className="text-sm font-semibold text-steel-700 mb-1">{title}</h3>
      <p className="text-sm text-steel-400 max-w-sm mb-4">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}
