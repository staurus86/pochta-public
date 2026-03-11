'use client';

import { useState } from 'react';
import { cn, confidenceColor, formatPercent } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { EXTRACTED_FIELDS } from '@/lib/constants';
import { FileSearch, Check, X, AlertTriangle } from 'lucide-react';
import type { ExtractedField } from '@/lib/api';

interface ReviewFormProps {
  fields: ExtractedField[];
  onConfirm: (updatedFields: Record<string, string>) => void;
  onReject: (reason: string) => void;
  onEscalate: (note: string) => void;
  loading?: boolean;
  className?: string;
}

export function ReviewForm({ fields, onConfirm, onReject, onEscalate, loading, className }: ReviewFormProps) {
  const [editedValues, setEditedValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const [rejectReason, setRejectReason] = useState('');
  const [escalateNote, setEscalateNote] = useState('');

  const hasChanges = fields.some((f) => editedValues[f.key] !== f.value);

  return (
    <div className={cn('space-y-4', className)}>
      {EXTRACTED_FIELDS.map((def) => {
        const field = fields.find((f) => f.key === def.key);
        if (!field) return null;

        const changed = editedValues[field.key] !== field.value;

        return (
          <div key={def.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-steel-500 uppercase tracking-wider">
                {def.label}
              </label>
              <ConfidenceBar value={field.confidence} className="w-24" />
            </div>
            <div className="relative">
              <input
                value={editedValues[field.key] || ''}
                onChange={(e) => setEditedValues({ ...editedValues, [field.key]: e.target.value })}
                className={cn(
                  'steel-input',
                  changed && 'border-accent-amber bg-amber-50/30 ring-1 ring-accent-amber/20',
                )}
              />
              {changed && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-accent-amber font-medium">
                  Изменено
                </span>
              )}
            </div>
            {field.source_snippet && (
              <div className="flex items-start gap-1.5 mt-1">
                <FileSearch className="w-3 h-3 text-steel-400 mt-0.5 shrink-0" />
                <span className="text-2xs text-steel-400 leading-tight italic">
                  &laquo;{field.source_snippet}&raquo;
                </span>
              </div>
            )}
          </div>
        );
      })}

      {hasChanges && (
        <div className="rounded-steel border border-amber-200 bg-amber-50/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-accent-amber" />
            <span className="text-xs font-semibold text-amber-700">Есть изменения</span>
          </div>
          <p className="text-xs text-amber-600">
            Вы изменили {fields.filter((f) => editedValues[f.key] !== f.value).length} поле(й).
            Эти изменения будут учтены для дообучения модели.
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-4 border-t border-steel-100">
        <Button
          variant="success"
          size="md"
          icon={<Check className="w-4 h-4" />}
          onClick={() => onConfirm(editedValues)}
          loading={loading}
          className="flex-1"
        >
          Подтвердить
        </Button>
        <Button
          variant="danger"
          size="md"
          icon={<X className="w-4 h-4" />}
          onClick={() => onReject(rejectReason || 'Некорректные данные')}
          className="flex-1"
        >
          Отклонить
        </Button>
        <Button
          variant="secondary"
          size="md"
          icon={<AlertTriangle className="w-4 h-4" />}
          onClick={() => onEscalate(escalateNote || 'Требуется проверка')}
          className="flex-1"
        >
          Эскалировать
        </Button>
      </div>
    </div>
  );
}
