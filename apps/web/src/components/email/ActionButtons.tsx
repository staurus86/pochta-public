'use client';

import { Button } from '@/components/ui/Button';
import { UserPlus, FileInput, Send, CheckCircle, GraduationCap } from 'lucide-react';

interface ActionButtonsProps {
  onCreateClient?: () => void;
  onCreateRequest?: () => void;
  onRequestDetails?: () => void;
  onConfirm?: () => void;
  onTrain?: () => void;
  loading?: boolean;
  className?: string;
}

export function ActionButtons({
  onCreateClient,
  onCreateRequest,
  onRequestDetails,
  onConfirm,
  onTrain,
  loading,
  className,
}: ActionButtonsProps) {
  return (
    <div className={className}>
      <h4 className="text-xs font-semibold text-steel-500 uppercase tracking-wider mb-3">
        Действия
      </h4>
      <div className="space-y-1.5">
        <Button
          variant="primary"
          size="sm"
          className="w-full justify-start"
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          onClick={onConfirm}
          loading={loading}
        >
          Подтвердить
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          icon={<UserPlus className="w-3.5 h-3.5" />}
          onClick={onCreateClient}
        >
          Создать клиента
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          icon={<FileInput className="w-3.5 h-3.5" />}
          onClick={onCreateRequest}
        >
          Создать запрос
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start"
          icon={<Send className="w-3.5 h-3.5" />}
          onClick={onRequestDetails}
        >
          Запросить реквизиты
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-accent-violet"
          icon={<GraduationCap className="w-3.5 h-3.5" />}
          onClick={onTrain}
        >
          На обучение
        </Button>
      </div>
    </div>
  );
}
