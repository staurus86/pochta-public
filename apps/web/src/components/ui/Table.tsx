'use client';

import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('steel-table', className)}>{children}</table>
    </div>
  );
}

export function TableHead({ children, className }: TableProps) {
  return <thead className={className}>{children}</thead>;
}

export function TableBody({ children, className }: TableProps) {
  return <tbody className={className}>{children}</tbody>;
}

export function TableRow({
  children,
  className,
  selected,
  onClick,
}: TableProps & { selected?: boolean; onClick?: () => void }) {
  return (
    <tr
      className={cn(
        onClick && 'cursor-pointer',
        selected && 'bg-accent-blue/5 hover:bg-accent-blue/8',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface SortableHeaderProps {
  children: React.ReactNode;
  sorted?: 'asc' | 'desc' | false;
  onSort?: () => void;
  className?: string;
}

export function SortableHeader({ children, sorted, onSort, className }: SortableHeaderProps) {
  return (
    <th
      className={cn('cursor-pointer select-none hover:text-steel-700 transition-colors', className)}
      onClick={onSort}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sorted === 'asc' ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : sorted === 'desc' ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
        )}
      </span>
    </th>
  );
}

export function TableCheckbox({
  checked,
  onChange,
  indeterminate,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(el) => { if (el) el.indeterminate = indeterminate || false; }}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 rounded border-steel-300 text-accent-blue
                 focus:ring-accent-blue/30 focus:ring-2 focus:ring-offset-0
                 cursor-pointer transition-colors"
    />
  );
}
