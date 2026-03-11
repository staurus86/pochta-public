'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table, TableHead, TableBody, TableRow, SortableHeader } from '@/components/ui/Table';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { formatDate } from '@/lib/utils';
import {
  Plus, Play, History, Edit3, Archive, MoreHorizontal,
  FileCode, FlaskConical, CheckCircle2,
} from 'lucide-react';
import type { Template } from '@/lib/api';

const statusMap: Record<string, { label: string; variant: 'blue' | 'emerald' | 'amber' | 'steel' }> = {
  active: { label: 'Активен', variant: 'emerald' },
  draft: { label: 'Черновик', variant: 'steel' },
  testing: { label: 'Тестирование', variant: 'amber' },
  archived: { label: 'Архив', variant: 'steel' },
};

const mockTemplates: Template[] = [
  { id: '1', name: 'Grundfos запрос', domain: 'grundfos.com', sender_pattern: '*@grundfos.com', version: 3, precision: 0.96, recall: 0.94, f1_score: 0.95, status: 'active', created_at: '2026-01-15T10:00:00Z', updated_at: '2026-03-10T12:00:00Z' },
  { id: '2', name: 'Danfoss прайс', domain: 'danfoss.com', sender_pattern: 'sales@danfoss.*', version: 5, precision: 0.98, recall: 0.92, f1_score: 0.95, status: 'active', created_at: '2026-01-10T10:00:00Z', updated_at: '2026-03-08T14:00:00Z' },
  { id: '3', name: 'Рекламация общая', domain: '*', sender_pattern: '*', version: 8, precision: 0.89, recall: 0.91, f1_score: 0.90, status: 'active', created_at: '2025-12-01T10:00:00Z', updated_at: '2026-03-11T09:00:00Z' },
  { id: '4', name: 'Wilo поставка', domain: 'wilo.com', sender_pattern: '*@wilo.*', version: 2, precision: 0.93, recall: 0.88, f1_score: 0.90, status: 'testing', created_at: '2026-02-20T10:00:00Z', updated_at: '2026-03-11T11:00:00Z' },
  { id: '5', name: 'Логистика ТТН', domain: '*', sender_pattern: 'logist*@*', version: 1, precision: 0.85, recall: 0.82, f1_score: 0.83, status: 'draft', created_at: '2026-03-05T10:00:00Z', updated_at: '2026-03-09T16:00:00Z' },
  { id: '6', name: 'Тендер портал', domain: 'zakupki.gov.ru', sender_pattern: '*@zakupki.gov.ru', version: 4, precision: 0.97, recall: 0.95, f1_score: 0.96, status: 'active', created_at: '2025-11-15T10:00:00Z', updated_at: '2026-02-28T10:00:00Z' },
  { id: '7', name: 'KSB техника', domain: 'ksb.com', sender_pattern: '*@ksb.*', version: 1, precision: 0.78, recall: 0.72, f1_score: 0.75, status: 'draft', created_at: '2026-03-08T10:00:00Z', updated_at: '2026-03-08T10:00:00Z' },
];

export default function TemplatesPage() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-steel-900">Шаблоны извлечения</h1>
          <p className="text-sm text-steel-400 mt-0.5">Управление шаблонами для парсинга входящих писем</p>
        </div>
        <Button
          variant="primary"
          size="md"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => { setSelectedTemplate(null); setEditorOpen(true); }}
        >
          Новый шаблон
        </Button>
      </div>

      <Card padding="none">
        <Table>
          <TableHead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Название</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Домен</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Паттерн</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider w-12">Вер.</th>
              <SortableHeader className="w-20">Precision</SortableHeader>
              <SortableHeader className="w-20">Recall</SortableHeader>
              <SortableHeader className="w-20">F1</SortableHeader>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Статус</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider w-28">Обновлён</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </TableHead>
          <TableBody>
            {mockTemplates.map((tpl) => {
              const st = statusMap[tpl.status];
              return (
                <TableRow key={tpl.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-steel-400 shrink-0" />
                      <span className="text-sm font-medium text-steel-900">{tpl.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-steel-500 font-mono">{tpl.domain}</td>
                  <td className="px-4 py-3 text-xs text-steel-500 font-mono">{tpl.sender_pattern}</td>
                  <td className="px-4 py-3 text-xs text-steel-500 font-mono text-center">v{tpl.version}</td>
                  <td className="px-4 py-3">
                    <ConfidenceBar value={tpl.precision} />
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBar value={tpl.recall} />
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBar value={tpl.f1_score} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-steel-400 tabular-nums">{formatDate(tpl.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors"
                        onClick={() => { setSelectedTemplate(tpl); setEditorOpen(true); }}
                        title="Редактировать"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors" title="Тестировать">
                        <FlaskConical className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors" title="История">
                        <History className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Template Editor Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={selectedTemplate ? `Редактирование: ${selectedTemplate.name}` : 'Новый шаблон'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Название" placeholder="Например: Grundfos запрос" defaultValue={selectedTemplate?.name} />
            <Input label="Домен" placeholder="*.example.com" defaultValue={selectedTemplate?.domain} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Паттерн отправителя" placeholder="*@example.com" defaultValue={selectedTemplate?.sender_pattern} />
            <Select
              label="Статус"
              options={[
                { value: 'draft', label: 'Черновик' },
                { value: 'testing', label: 'Тестирование' },
                { value: 'active', label: 'Активен' },
              ]}
              value={selectedTemplate?.status || 'draft'}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-steel-500 uppercase tracking-wider block mb-1">
              Правила извлечения (JSON)
            </label>
            <textarea
              className="steel-input font-mono text-xs h-48 resize-y"
              placeholder='{"fields": [{"key": "company_name", "patterns": [...]}]}'
              defaultValue={selectedTemplate ? JSON.stringify({ fields: [], version: selectedTemplate.version }, null, 2) : ''}
            />
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-steel-100">
            <Button variant="secondary" size="sm" icon={<FlaskConical className="w-3.5 h-3.5" />}>
              Тестировать на примере
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={() => setEditorOpen(false)}>
                Отмена
              </Button>
              <Button variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
