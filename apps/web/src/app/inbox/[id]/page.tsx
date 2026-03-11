'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClassificationBadge } from '@/components/ui/ClassificationBadge';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { EmailBodyViewer } from '@/components/email/EmailBodyViewer';
import { ExtractedFieldsPanel } from '@/components/email/ExtractedFieldsPanel';
import { AttachmentGallery } from '@/components/email/AttachmentGallery';
import { ThreadList } from '@/components/email/ThreadList';
import { CrmMatchCard } from '@/components/email/CrmMatchCard';
import { ActionButtons } from '@/components/email/ActionButtons';
import { formatDate } from '@/lib/utils';
import { ArrowLeft, ExternalLink, Clock } from 'lucide-react';
import type { Email, ExtractedField, CrmMatch } from '@/lib/api';

// Mock data for this email
const mockEmail: Email = {
  id: '1',
  message_id: '<msg1@gidroservis.ru>',
  from_address: 'ivanov@gidroservis.ru',
  from_name: 'Иванов Алексей Петрович',
  to_address: 'sales@company.ru',
  subject: 'Запрос на поставку насосов Grundfos CR 32-2 в количестве 5 шт.',
  body_text: `Добрый день!

Прошу Вас рассмотреть возможность поставки следующего оборудования:

1. Насос Grundfos CR 32-2 A-F-A-E-HQQE — 5 шт.
2. Насос Grundfos CR 15-3 A-F-A-E-HQQE — 3 шт.

Срок поставки: до 15 апреля 2026 г.
Адрес доставки: г. Москва, ул. Промышленная, д. 12, стр. 3

Просим направить КП с указанием сроков и условий оплаты.

С уважением,
Иванов Алексей Петрович
Начальник отдела закупок
ООО "Гидросервис"
ИНН: 7712345678
Тел: +7 (495) 123-45-67
Email: ivanov@gidroservis.ru`,
  body_html: `<div style="font-family: Arial, sans-serif;">
<p>Добрый день!</p>
<p>Прошу Вас рассмотреть возможность поставки следующего оборудования:</p>
<ol>
<li>Насос <strong>Grundfos CR 32-2</strong> A-F-A-E-HQQE &mdash; <strong>5 шт.</strong></li>
<li>Насос <strong>Grundfos CR 15-3</strong> A-F-A-E-HQQE &mdash; <strong>3 шт.</strong></li>
</ol>
<p><strong>Срок поставки:</strong> до 15 апреля 2026 г.<br/>
<strong>Адрес доставки:</strong> г. Москва, ул. Промышленная, д. 12, стр. 3</p>
<p>Просим направить КП с указанием сроков и условий оплаты.</p>
<hr/>
<p>С уважением,<br/><strong>Иванов Алексей Петрович</strong><br/>Начальник отдела закупок<br/>ООО "Гидросервис"<br/>ИНН: 7712345678<br/>Тел: +7 (495) 123-45-67</p>
</div>`,
  received_at: '2026-03-11T14:23:00Z',
  inbox_id: '2',
  inbox_name: 'sales',
  status: 'classified',
  classification: 'client_request',
  confidence: 0.97,
  extracted_fields: [
    { key: 'company_name', value: 'ООО "Гидросервис"', confidence: 0.98, source_snippet: 'ООО "Гидросервис"' },
    { key: 'inn', value: '7712345678', confidence: 0.99, source_snippet: 'ИНН: 7712345678' },
    { key: 'contact_name', value: 'Иванов Алексей Петрович', confidence: 0.97, source_snippet: 'Иванов Алексей Петрович, Начальник отдела закупок' },
    { key: 'phone', value: '+7 (495) 123-45-67', confidence: 0.95, source_snippet: 'Тел: +7 (495) 123-45-67' },
    { key: 'email', value: 'ivanov@gidroservis.ru', confidence: 0.99, source_snippet: 'Email: ivanov@gidroservis.ru' },
    { key: 'product', value: 'Grundfos CR 32-2 A-F-A-E-HQQE (5 шт.), Grundfos CR 15-3 (3 шт.)', confidence: 0.93, source_snippet: 'Насос Grundfos CR 32-2 A-F-A-E-HQQE — 5 шт.' },
    { key: 'brand', value: 'Grundfos', confidence: 0.99, source_snippet: 'Grundfos CR 32-2' },
    { key: 'quantity', value: '8', confidence: 0.85, source_snippet: '5 шт. + 3 шт.' },
    { key: 'delivery_address', value: 'г. Москва, ул. Промышленная, д. 12, стр. 3', confidence: 0.96, source_snippet: 'Адрес доставки: г. Москва, ул. Промышленная, д. 12, стр. 3' },
    { key: 'deadline', value: '15.04.2026', confidence: 0.94, source_snippet: 'Срок поставки: до 15 апреля 2026 г.' },
  ],
  attachments: [
    { id: 'a1', filename: 'ТЗ_на_поставку.pdf', content_type: 'application/pdf', size: 234567, preview_url: null },
    { id: 'a2', filename: 'Спецификация.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 45678, preview_url: null },
  ],
  crm_match: {
    matched: true,
    client_id: 'c123',
    client_name: 'ООО "Гидросервис"',
    similarity: 0.96,
    suggestions: [],
  },
  thread_id: 't1',
  created_at: '2026-03-11T14:23:00Z',
  updated_at: '2026-03-11T14:23:00Z',
};

const threadEmails: Email[] = [
  mockEmail,
  {
    ...mockEmail,
    id: '1-prev',
    subject: 'Re: Предварительный запрос на насосное оборудование',
    from_name: 'Менеджер Продаж',
    from_address: 'sales@company.ru',
    received_at: '2026-03-10T10:15:00Z',
    status: 'confirmed',
    confidence: 1,
  },
  {
    ...mockEmail,
    id: '1-orig',
    subject: 'Предварительный запрос на насосное оборудование',
    received_at: '2026-03-09T16:30:00Z',
    status: 'confirmed',
    confidence: 0.95,
  },
];

export default function EmailDetailPage() {
  const params = useParams();
  const [activeThreadId, setActiveThreadId] = useState(mockEmail.id);

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/inbox">
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              Назад
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-steel-900">{mockEmail.subject}</h1>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <StatusBadge status={mockEmail.status} />
              <ClassificationBadge classification={mockEmail.classification} />
              <ConfidenceBar value={mockEmail.confidence} className="w-24" />
              <span className="flex items-center gap-1 text-xs text-steel-400">
                <Clock className="w-3 h-3" />
                {formatDate(mockEmail.received_at)}
              </span>
            </div>
          </div>
        </div>
        <Link href={`/inbox/${params.id}/review`}>
          <Button variant="secondary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}>
            Открыть ревью
          </Button>
        </Link>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-[220px_1fr_300px] gap-4 min-h-[calc(100vh-180px)]">
        {/* Left: Thread List */}
        <Card padding="sm" className="overflow-y-auto">
          <ThreadList
            emails={threadEmails}
            activeId={activeThreadId}
            onSelect={setActiveThreadId}
          />
        </Card>

        {/* Center: Email Body */}
        <div className="flex flex-col gap-4">
          <Card className="flex-1" padding="none">
            <div className="p-4 border-b border-steel-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-steel-900">{mockEmail.from_name}</p>
                  <p className="text-xs text-steel-400">{mockEmail.from_address}</p>
                </div>
                <span className="text-xs text-steel-400 font-mono">{mockEmail.inbox_name}@company.ru</span>
              </div>
            </div>
            <div className="p-4">
              <EmailBodyViewer
                bodyHtml={mockEmail.body_html}
                bodyText={mockEmail.body_text}
              />
            </div>
          </Card>

          <Card>
            <AttachmentGallery attachments={mockEmail.attachments} />
          </Card>
        </div>

        {/* Right: Extracted Fields + CRM + Actions */}
        <div className="flex flex-col gap-4">
          <Card className="overflow-y-auto flex-1">
            <ExtractedFieldsPanel fields={mockEmail.extracted_fields} />
          </Card>

          <CrmMatchCard match={mockEmail.crm_match} />

          <Card>
            <ActionButtons
              onConfirm={() => {}}
              onCreateClient={() => {}}
              onCreateRequest={() => {}}
              onRequestDetails={() => {}}
              onTrain={() => {}}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
