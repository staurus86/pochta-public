'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="text-xs font-medium text-steel-500 uppercase tracking-wider">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={cn('steel-input', icon && 'pl-9', error && 'border-accent-rose focus:ring-accent-rose/20', className)}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-accent-rose">{error}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      icon={<Search className="w-4 h-4" />}
      placeholder="Поиск..."
      className={className}
      {...props}
    />
  );
}
