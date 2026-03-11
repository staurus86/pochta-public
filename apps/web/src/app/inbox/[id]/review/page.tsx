'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClassificationBadge } from '@/components/ui/ClassificationBadge';
import { ReviewForm } from '@/components/email/ReviewForm';
import { ArrowLeft, Split, Eye } from 'lucide-react';
import type { ExtractedField } from '@/lib/api';

const mockFields: ExtractedField[] = [
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
];

const originalEmailText = `Добрый день!

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
Email: ivanov@gidroservis.ru`;

export default function ReviewPage() {
  const params = useParams();

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/inbox/${params.id}`}>
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}>
              К письму
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold text-steel-900 flex items-center gap-2">
              <Split className="w-5 h-5 text-accent-blue" />
              Ревью извлечённых данных
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status="review" />
              <ClassificationBadge classification="client_request" />
              <span className="text-xs text-steel-400">ID: {params.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-2 gap-4 min-h-[calc(100vh-180px)]">
        {/* Left: Original email */}
        <Card className="overflow-y-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-steel-400" />
              Оригинал письма
            </CardTitle>
          </CardHeader>
          <div className="rounded-steel border border-steel-100 bg-steel-50/50 p-4">
            <div className="mb-4 pb-3 border-b border-steel-200 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-steel-500 w-16">От:</span>
                <span className="text-xs text-steel-700">Иванов Алексей Петрович &lt;ivanov@gidroservis.ru&gt;</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-steel-500 w-16">Кому:</span>
                <span className="text-xs text-steel-700">sales@company.ru</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-steel-500 w-16">Тема:</span>
                <span className="text-xs font-medium text-steel-900">Запрос на поставку насосов Grundfos CR 32-2</span>
              </div>
            </div>
            <pre className="text-sm text-steel-700 font-mono whitespace-pre-wrap leading-relaxed">
              {originalEmailText}
            </pre>
          </div>

          {/* Diff viewer placeholder */}
          <div className="mt-4">
            <CardTitle className="mb-2">Изменения</CardTitle>
            <div className="rounded-steel border border-steel-100 bg-steel-50/50 p-4 text-center">
              <p className="text-sm text-steel-400">Нет изменений. Отредактируйте поля справа для просмотра diff.</p>
            </div>
          </div>
        </Card>

        {/* Right: Editable fields */}
        <Card className="overflow-y-auto">
          <CardHeader>
            <CardTitle>Извлечённые данные</CardTitle>
          </CardHeader>
          <ReviewForm
            fields={mockFields}
            onConfirm={(fields) => { console.log('Confirmed:', fields); }}
            onReject={(reason) => { console.log('Rejected:', reason); }}
            onEscalate={(note) => { console.log('Escalated:', note); }}
          />
        </Card>
      </div>
    </div>
  );
}
