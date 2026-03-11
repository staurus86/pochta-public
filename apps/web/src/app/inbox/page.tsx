'use client';

import { useState, useMemo } from 'react';
import { EmailList } from '@/components/email/EmailList';
import { SearchInput } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { EMAIL_STATUSES, CLASSIFICATIONS, KEYBOARD_SHORTCUTS } from '@/lib/constants';
import type { Email } from '@/lib/api';
import type { EmailStatus, Classification } from '@/lib/constants';
import {
  CheckCircle, Trash2, Tag, ChevronLeft, ChevronRight,
  Keyboard, Filter, RotateCw, Inbox,
} from 'lucide-react';

// Mock emails
const mockEmails: Email[] = [
  {
    id: '1', message_id: '<msg1@example.com>', from_address: 'ivanov@gidroservis.ru', from_name: 'Иванов А.П.',
    to_address: 'sales@company.ru', subject: 'Запрос на поставку насосов Grundfos CR 32-2 в количестве 5 шт.',
    body_text: '', body_html: '', received_at: '2026-03-11T14:23:00Z',
    inbox_id: '2', inbox_name: 'sales', status: 'classified', classification: 'client_request',
    confidence: 0.97, extracted_fields: [], attachments: [{ id: 'a1', filename: 'ТЗ.pdf', content_type: 'application/pdf', size: 234567, preview_url: null }],
    crm_match: null, thread_id: 't1', created_at: '2026-03-11T14:23:00Z', updated_at: '2026-03-11T14:23:00Z',
  },
  {
    id: '2', message_id: '<msg2@example.com>', from_address: 'petrova@teplosnab.ru', from_name: 'Петрова Е.С.',
    to_address: 'info@company.ru', subject: 'Re: Коммерческое предложение #4521 — согласование условий',
    body_text: '', body_html: '', received_at: '2026-03-11T14:18:00Z',
    inbox_id: '1', inbox_name: 'info', status: 'review', classification: 'price_request',
    confidence: 0.82, extracted_fields: [], attachments: [],
    crm_match: null, thread_id: 't2', created_at: '2026-03-11T14:18:00Z', updated_at: '2026-03-11T14:18:00Z',
  },
  {
    id: '3', message_id: '<msg3@example.com>', from_address: 'kozlov@ip-kozlov.ru', from_name: 'Козлов А.В.',
    to_address: 'info@company.ru', subject: 'Заявка на подбор оборудования Danfoss для системы отопления',
    body_text: '', body_html: '', received_at: '2026-03-11T14:12:00Z',
    inbox_id: '1', inbox_name: 'info', status: 'confirmed', classification: 'client_request',
    confidence: 0.94, extracted_fields: [], attachments: [{ id: 'a2', filename: 'Схема.dwg', content_type: 'application/octet-stream', size: 1234567, preview_url: null }],
    crm_match: null, thread_id: null, created_at: '2026-03-11T14:12:00Z', updated_at: '2026-03-11T14:12:00Z',
  },
  {
    id: '4', message_id: '<msg4@example.com>', from_address: 'unknown@mail.ru', from_name: '',
    to_address: 'info@company.ru', subject: 'Fwd: Срочный запрос',
    body_text: '', body_html: '', received_at: '2026-03-11T14:05:00Z',
    inbox_id: '1', inbox_name: 'info', status: 'error', classification: 'unknown',
    confidence: 0.35, extracted_fields: [], attachments: [],
    crm_match: null, thread_id: null, created_at: '2026-03-11T14:05:00Z', updated_at: '2026-03-11T14:05:00Z',
  },
  {
    id: '5', message_id: '<msg5@example.com>', from_address: 'promo@offers-best.com', from_name: 'Best Offers',
    to_address: 'info@company.ru', subject: 'Специальное предложение для вашего бизнеса — скидки до 70%!',
    body_text: '', body_html: '', received_at: '2026-03-11T13:58:00Z',
    inbox_id: '1', inbox_name: 'info', status: 'spam', classification: 'spam',
    confidence: 0.99, extracted_fields: [], attachments: [],
    crm_match: null, thread_id: null, created_at: '2026-03-11T13:58:00Z', updated_at: '2026-03-11T13:58:00Z',
  },
  {
    id: '6', message_id: '<msg6@example.com>', from_address: 'smirnov@stroymontazh.ru', from_name: 'Смирнов Д.В.',
    to_address: 'support@company.ru', subject: 'Рекламация по поставке #7832 — несоответствие артикулов',
    body_text: '', body_html: '', received_at: '2026-03-11T13:45:00Z',
    inbox_id: '3', inbox_name: 'support', status: 'classified', classification: 'complaint',
    confidence: 0.91, extracted_fields: [], attachments: [
      { id: 'a3', filename: 'Фото_1.jpg', content_type: 'image/jpeg', size: 3456789, preview_url: null },
      { id: 'a4', filename: 'Фото_2.jpg', content_type: 'image/jpeg', size: 2345678, preview_url: null },
    ],
    crm_match: null, thread_id: 't3', created_at: '2026-03-11T13:45:00Z', updated_at: '2026-03-11T13:45:00Z',
  },
  {
    id: '7', message_id: '<msg7@example.com>', from_address: 'logistics@transco.ru', from_name: 'ООО ТрансКо',
    to_address: 'logist@company.ru', subject: 'Подтверждение отгрузки заказ #12045 от 10.03.2026',
    body_text: '', body_html: '', received_at: '2026-03-11T13:30:00Z',
    inbox_id: '17', inbox_name: 'logist', status: 'classified', classification: 'logistics',
    confidence: 0.88, extracted_fields: [], attachments: [{ id: 'a5', filename: 'ТТН.pdf', content_type: 'application/pdf', size: 567890, preview_url: null }],
    crm_match: null, thread_id: null, created_at: '2026-03-11T13:30:00Z', updated_at: '2026-03-11T13:30:00Z',
  },
  {
    id: '8', message_id: '<msg8@example.com>', from_address: 'buh@partner.ru', from_name: 'Бухгалтерия Партнёр',
    to_address: 'buh@company.ru', subject: 'Акт сверки за февраль 2026',
    body_text: '', body_html: '', received_at: '2026-03-11T13:15:00Z',
    inbox_id: '9', inbox_name: 'buh', status: 'classified', classification: 'payment',
    confidence: 0.86, extracted_fields: [], attachments: [{ id: 'a6', filename: 'Акт_сверки.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 45678, preview_url: null }],
    crm_match: null, thread_id: null, created_at: '2026-03-11T13:15:00Z', updated_at: '2026-03-11T13:15:00Z',
  },
];

const statusOptions = [
  { value: '', label: 'Все статусы' },
  ...Object.entries(EMAIL_STATUSES).map(([k, v]) => ({ value: k, label: v.label })),
];

const classOptions = [
  { value: '', label: 'Все классы' },
  ...Object.entries(CLASSIFICATIONS).map(([k, v]) => ({ value: k, label: v.label })),
];

const inboxOptions = [
  { value: '', label: 'Все ящики' },
  { value: 'info', label: 'info@company.ru' },
  { value: 'sales', label: 'sales@company.ru' },
  { value: 'support', label: 'support@company.ru' },
  { value: 'logist', label: 'logist@company.ru' },
  { value: 'buh', label: 'buh@company.ru' },
];

export default function InboxPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [inboxFilter, setInboxFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const filtered = useMemo(() => {
    return mockEmails.filter((e) => {
      if (statusFilter && e.status !== statusFilter) return false;
      if (classFilter && e.classification !== classFilter) return false;
      if (inboxFilter && e.inbox_name !== inboxFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.subject.toLowerCase().includes(q) ||
          e.from_name.toLowerCase().includes(q) ||
          e.from_address.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [statusFilter, classFilter, inboxFilter, search]);

  const totalPages = Math.ceil(filtered.length / 20) || 1;
  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-steel-900">Входящие</h1>
          <p className="text-sm text-steel-400 mt-0.5">
            {filtered.length} писем
            {statusFilter || classFilter || inboxFilter || search ? ' (отфильтровано)' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Keyboard className="w-4 h-4" />}
            onClick={() => setShowShortcuts(!showShortcuts)}
          >
            Горячие клавиши
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCw className="w-4 h-4" />}
          >
            Обновить
          </Button>
        </div>
      </div>

      {/* Shortcuts hint */}
      {showShortcuts && (
        <Card padding="sm" className="bg-steel-900 border-steel-700">
          <div className="flex flex-wrap gap-4">
            {KEYBOARD_SHORTCUTS.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded border border-steel-600 bg-steel-800 text-2xs font-mono text-steel-300">
                  {s.key}
                </kbd>
                <span className="text-2xs text-steel-400">{s.description}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Toolbar */}
      <Card padding="sm">
        <div className="flex items-center gap-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-1">
            <Filter className="w-4 h-4 text-steel-400 shrink-0" />
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40"
            />
            <Select
              options={classOptions}
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-44"
            />
            <Select
              options={inboxOptions}
              value={inboxFilter}
              onChange={(e) => setInboxFilter(e.target.value)}
              className="w-44"
            />
            <SearchInput
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
              className="w-56"
            />
          </div>

          {/* Bulk actions */}
          {hasSelection && (
            <div className="flex items-center gap-1.5 border-l border-steel-200 pl-3">
              <Badge variant="blue">{selectedIds.size} выбрано</Badge>
              <Button variant="ghost" size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />}>
                Подтвердить
              </Button>
              <Button variant="ghost" size="sm" icon={<Tag className="w-3.5 h-3.5" />}>
                Класс
              </Button>
              <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5 text-accent-rose" />}>
                Спам
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Email Table */}
      <Card padding="none">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-6 h-6 text-steel-400" />}
            title="Нет писем"
            description="По выбранным фильтрам писем не найдено. Попробуйте изменить параметры поиска."
          />
        ) : (
          <EmailList
            emails={filtered}
            selectedIds={selectedIds}
            onSelectChange={setSelectedIds}
          />
        )}
      </Card>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-steel-400">
            Показано {Math.min(filtered.length, 20)} из {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronLeft className="w-4 h-4" />}
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            />
            {Array.from({ length: totalPages }, (_, i) => (
              <button
                key={i + 1}
                onClick={() => setPage(i + 1)}
                className={`w-8 h-8 rounded-steel text-xs font-medium transition-colors ${
                  page === i + 1
                    ? 'bg-accent-blue text-white'
                    : 'text-steel-500 hover:bg-steel-100'
                }`}
              >
                {i + 1}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronRight className="w-4 h-4" />}
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
