'use client';

import { cn } from '@/lib/utils';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { EXTRACTED_FIELDS } from '@/lib/constants';
import type { ExtractedField } from '@/lib/api';
import { FileSearch, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface ExtractedFieldsPanelProps {
  fields: ExtractedField[];
  className?: string;
}

function FieldRow({ field, label }: { field: ExtractedField; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(field.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group py-2.5 border-b border-steel-100 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-steel-500 uppercase tracking-wider">
          {label}
        </span>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-steel-400 hover:text-steel-600 transition-all"
        >
          {copied ? <Check className="w-3 h-3 text-accent-emerald" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className="text-sm font-medium text-steel-900 mb-1.5">
        {field.value || <span className="text-steel-300 italic">Не найдено</span>}
      </div>
      <ConfidenceBar value={field.confidence} size="sm" />
      {field.source_snippet && (
        <div className="mt-1.5 flex items-start gap-1.5">
          <FileSearch className="w-3 h-3 text-steel-400 mt-0.5 shrink-0" />
          <span className="text-2xs text-steel-400 leading-tight italic line-clamp-2">
            &laquo;{field.source_snippet}&raquo;
          </span>
        </div>
      )}
    </div>
  );
}

export function ExtractedFieldsPanel({ fields, className }: ExtractedFieldsPanelProps) {
  return (
    <div className={cn('space-y-0', className)}>
      <h3 className="text-xs font-semibold text-steel-500 uppercase tracking-wider mb-3">
        Извлечённые данные
      </h3>
      {EXTRACTED_FIELDS.map((def) => {
        const field = fields.find((f) => f.key === def.key);
        if (!field) return null;
        return <FieldRow key={def.key} field={field} label={def.label} />;
      })}
      {fields.length === 0 && (
        <p className="text-sm text-steel-400 py-4 text-center">Данные не извлечены</p>
      )}
    </div>
  );
}
