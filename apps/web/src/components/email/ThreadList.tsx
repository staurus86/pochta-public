'use client';

import { cn, formatDate, truncate } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Email } from '@/lib/api';

interface ThreadListProps {
  emails: Email[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function ThreadList({ emails, activeId, onSelect, className }: ThreadListProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <h3 className="text-xs font-semibold text-steel-500 uppercase tracking-wider mb-2">
        Цепочка ({emails.length})
      </h3>
      {emails.map((email) => (
        <button
          key={email.id}
          onClick={() => onSelect(email.id)}
          className={cn(
            'w-full text-left p-3 rounded-steel border transition-all',
            email.id === activeId
              ? 'border-accent-blue bg-accent-blue/5 shadow-glow-blue'
              : 'border-steel-100 bg-white hover:border-steel-200 hover:shadow-steel',
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-steel-700 truncate mr-2">
              {email.from_name || email.from_address}
            </span>
            <span className="text-2xs text-steel-400 tabular-nums whitespace-nowrap">
              {formatDate(email.received_at)}
            </span>
          </div>
          <p className="text-xs text-steel-500 mb-1.5 truncate">{email.subject}</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={email.status} />
          </div>
        </button>
      ))}
    </div>
  );
}
