'use client';

import { cn } from '@/lib/utils';
import { Building2, CheckCircle2, XCircle, Search } from 'lucide-react';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import type { CrmMatch } from '@/lib/api';

interface CrmMatchCardProps {
  match: CrmMatch | null;
  className?: string;
}

export function CrmMatchCard({ match, className }: CrmMatchCardProps) {
  if (!match) {
    return (
      <div className={cn('rounded-steel border border-steel-100 p-4', className)}>
        <div className="flex items-center gap-2 mb-2">
          <Search className="w-4 h-4 text-steel-400" />
          <h4 className="text-xs font-semibold text-steel-500 uppercase tracking-wider">
            CRM
          </h4>
        </div>
        <p className="text-sm text-steel-400">Данные не загружены</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-steel border p-4', match.matched ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30', className)}>
      <div className="flex items-center gap-2 mb-3">
        {match.matched ? (
          <CheckCircle2 className="w-4 h-4 text-accent-emerald" />
        ) : (
          <XCircle className="w-4 h-4 text-accent-amber" />
        )}
        <h4 className="text-xs font-semibold text-steel-500 uppercase tracking-wider">
          {match.matched ? 'Найден в CRM' : 'Не найден в CRM'}
        </h4>
      </div>

      {match.matched && match.client_name && (
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="w-4 h-4 text-steel-500" />
          <span className="text-sm font-semibold text-steel-900">{match.client_name}</span>
        </div>
      )}

      {match.matched && (
        <ConfidenceBar value={match.similarity} size="md" />
      )}

      {!match.matched && match.suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-steel-500">Похожие клиенты:</p>
          {match.suggestions.map((s) => (
            <div
              key={s.client_id}
              className="flex items-center justify-between p-2 rounded bg-white/60 border border-amber-100 cursor-pointer hover:border-amber-300 transition-colors"
            >
              <div>
                <span className="text-xs font-medium text-steel-700">{s.client_name}</span>
                <span className="text-2xs text-steel-400 ml-2">ИНН: {s.inn}</span>
              </div>
              <span className="text-xs font-mono text-steel-500">{Math.round(s.similarity * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
