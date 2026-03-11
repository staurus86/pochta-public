'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHead, TableBody, TableRow } from '@/components/ui/Table';
import {
  Plus, CheckCircle2, XCircle, PauseCircle, Loader2,
  Mail, Route, UserCog, FileText, Flag, Gauge, Shield,
  Edit3, Trash2, RotateCw,
} from 'lucide-react';

const tabs = [
  { key: 'inboxes', label: 'Почтовые ящики', icon: Mail },
  { key: 'routing', label: 'Правила маршрутизации', icon: Route },
  { key: 'assignment', label: 'Правила назначения', icon: UserCog },
  { key: 'responses', label: 'Шаблоны ответов', icon: FileText },
  { key: 'flags', label: 'Feature Flags', icon: Flag },
  { key: 'thresholds', label: 'Пороги уверенности', icon: Gauge },
  { key: 'roles', label: 'Роли', icon: Shield },
];

const statusIcons = {
  active: { icon: CheckCircle2, color: 'text-accent-emerald', label: 'Активен' },
  error: { icon: XCircle, color: 'text-accent-rose', label: 'Ошибка' },
  paused: { icon: PauseCircle, color: 'text-accent-amber', label: 'Пауза' },
  connecting: { icon: Loader2, color: 'text-accent-blue animate-spin', label: 'Подключение' },
};

const mockInboxes = [
  { id: '1', name: 'Основной', email: 'info@company.ru', imap_host: 'imap.company.ru', imap_port: 993, status: 'active' as const, last_sync_at: '2026-03-11T14:30:00Z', unread_count: 12, total_today: 89 },
  { id: '2', name: 'Продажи', email: 'sales@company.ru', imap_host: 'imap.company.ru', imap_port: 993, status: 'active' as const, last_sync_at: '2026-03-11T14:29:00Z', unread_count: 5, total_today: 67 },
  { id: '3', name: 'Поддержка', email: 'support@company.ru', imap_host: 'imap.company.ru', imap_port: 993, status: 'active' as const, last_sync_at: '2026-03-11T14:28:00Z', unread_count: 8, total_today: 45 },
  { id: '4', name: 'Тендеры', email: 'tender@company.ru', imap_host: 'imap.yandex.ru', imap_port: 993, status: 'paused' as const, last_sync_at: '2026-03-11T10:00:00Z', unread_count: 0, total_today: 15 },
  { id: '5', name: 'Логистика', email: 'logist@company.ru', imap_host: 'imap.company.ru', imap_port: 993, status: 'active' as const, last_sync_at: '2026-03-11T14:25:00Z', unread_count: 3, total_today: 34 },
  { id: '6', name: 'Бухгалтерия', email: 'buh@company.ru', imap_host: 'imap.company.ru', imap_port: 993, status: 'error' as const, last_sync_at: '2026-03-11T12:00:00Z', unread_count: 0, total_today: 18 },
];

const mockFlags = [
  { key: 'auto_classification', label: 'Авто-классификация', description: 'Автоматическая классификация входящих писем', enabled: true },
  { key: 'auto_pass', label: 'Авто-подтверждение', description: 'Автоматическое подтверждение при высокой уверенности', enabled: true },
  { key: 'crm_sync', label: 'Синхронизация CRM', description: 'Автоматическое создание записей в CRM', enabled: false },
  { key: 'spam_filter', label: 'Спам-фильтр', description: 'ML-модель фильтрации спама', enabled: true },
  { key: 'attachment_ocr', label: 'OCR вложений', description: 'Распознавание текста в изображениях и PDF', enabled: true },
  { key: 'auto_reply', label: 'Авто-ответы', description: 'Автоматическая отправка ответов по шаблону', enabled: false },
];

const mockThresholds = [
  { key: 'auto_pass', label: 'Авто-подтверждение', value: 0.95, description: 'Минимальная уверенность для автоматического подтверждения' },
  { key: 'high_confidence', label: 'Высокая уверенность', value: 0.85, description: 'Порог высокой уверенности (зелёная зона)' },
  { key: 'medium_confidence', label: 'Средняя уверенность', value: 0.70, description: 'Порог средней уверенности (жёлтая зона)' },
  { key: 'spam_threshold', label: 'Порог спама', value: 0.90, description: 'Минимальная уверенность для маркировки как спам' },
  { key: 'review_threshold', label: 'Порог ревью', value: 0.50, description: 'Ниже этого порога — обязательная ручная проверка' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('inboxes');
  const [addInboxOpen, setAddInboxOpen] = useState(false);

  return (
    <div className="space-y-6 animate-in">
      <div>
        <h1 className="text-xl font-bold text-steel-900">Настройки</h1>
        <p className="text-sm text-steel-400 mt-0.5">Конфигурация системы обработки почты</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-steel-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.key
                  ? 'border-accent-blue text-accent-blue'
                  : 'border-transparent text-steel-500 hover:text-steel-700 hover:border-steel-300',
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'inboxes' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="md"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setAddInboxOpen(true)}
            >
              Добавить ящик
            </Button>
          </div>

          <Card padding="none">
            <Table>
              <TableHead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Статус</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Название</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">IMAP</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Непрочит.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">Сегодня</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </TableHead>
              <TableBody>
                {mockInboxes.map((inbox) => {
                  const st = statusIcons[inbox.status];
                  const StIcon = st.icon;
                  return (
                    <TableRow key={inbox.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StIcon className={cn('w-4 h-4', st.color)} />
                          <span className="text-xs text-steel-500">{st.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-steel-900">{inbox.name}</td>
                      <td className="px-4 py-3 text-xs text-steel-500 font-mono">{inbox.email}</td>
                      <td className="px-4 py-3 text-xs text-steel-400 font-mono">{inbox.imap_host}:{inbox.imap_port}</td>
                      <td className="px-4 py-3">
                        {inbox.unread_count > 0 ? (
                          <Badge variant="blue">{inbox.unread_count}</Badge>
                        ) : (
                          <span className="text-xs text-steel-300">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-steel-600">{inbox.total_today}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors" title="Синхронизировать">
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors" title="Редактировать">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-accent-rose transition-colors" title="Удалить">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Add Inbox Modal */}
          <Modal
            open={addInboxOpen}
            onClose={() => setAddInboxOpen(false)}
            title="Добавить почтовый ящик"
            size="md"
          >
            <div className="space-y-4">
              <Input label="Название" placeholder="Например: Основной" />
              <Input label="Email адрес" placeholder="info@company.ru" type="email" />
              <div className="grid grid-cols-2 gap-4">
                <Input label="IMAP сервер" placeholder="imap.company.ru" />
                <Input label="IMAP порт" placeholder="993" type="number" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Логин" placeholder="user@company.ru" />
                <Input label="Пароль" placeholder="********" type="password" />
              </div>
              <Select
                label="Шифрование"
                options={[
                  { value: 'ssl', label: 'SSL/TLS' },
                  { value: 'starttls', label: 'STARTTLS' },
                  { value: 'none', label: 'Без шифрования' },
                ]}
              />
              <div className="flex justify-end gap-2 pt-4 border-t border-steel-100">
                <Button variant="ghost" onClick={() => setAddInboxOpen(false)}>
                  Отмена
                </Button>
                <Button variant="secondary" icon={<RotateCw className="w-4 h-4" />}>
                  Тест соединения
                </Button>
                <Button variant="primary" icon={<CheckCircle2 className="w-4 h-4" />}>
                  Добавить
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {activeTab === 'flags' && (
        <Card>
          <CardHeader>
            <CardTitle>Feature Flags</CardTitle>
          </CardHeader>
          <div className="space-y-0">
            {mockFlags.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between py-4 border-b border-steel-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-steel-900">{flag.label}</p>
                  <p className="text-xs text-steel-400 mt-0.5">{flag.description}</p>
                </div>
                <button
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors',
                    flag.enabled ? 'bg-accent-emerald' : 'bg-steel-300',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform',
                      flag.enabled ? 'left-[22px]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'thresholds' && (
        <Card>
          <CardHeader>
            <CardTitle>Пороги уверенности</CardTitle>
          </CardHeader>
          <div className="space-y-6">
            {mockThresholds.map((t) => (
              <div key={t.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-steel-900">{t.label}</p>
                    <p className="text-xs text-steel-400">{t.description}</p>
                  </div>
                  <span className="text-lg font-bold font-mono text-steel-900 tabular-nums">
                    {Math.round(t.value * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  defaultValue={Math.round(t.value * 100)}
                  className="w-full h-1.5 bg-steel-200 rounded-full appearance-none cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                             [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full
                             [&::-webkit-slider-thumb]:bg-accent-blue [&::-webkit-slider-thumb]:shadow-sm
                             [&::-webkit-slider-thumb]:cursor-pointer"
                />
              </div>
            ))}
            <div className="pt-4 border-t border-steel-100">
              <Button variant="primary" icon={<CheckCircle2 className="w-4 h-4" />}>
                Сохранить пороги
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'routing' && (
        <Card>
          <CardHeader>
            <CardTitle>Правила маршрутизации</CardTitle>
            <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}>
              Добавить правило
            </Button>
          </CardHeader>
          <div className="space-y-3">
            {[
              { condition: 'Классификация = Рекламация', action: 'Направить на support@', priority: 1 },
              { condition: 'Бренд содержит "Grundfos"', action: 'Назначить: Сидорова А.', priority: 2 },
              { condition: 'Уверенность < 70%', action: 'Направить на ручную проверку', priority: 3 },
              { condition: 'Домен = zakupki.gov.ru', action: 'Назначить: Отдел тендеров', priority: 4 },
            ].map((rule, i) => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-steel border border-steel-100 bg-steel-50/30">
                <span className="w-7 h-7 rounded-md bg-steel-200 flex items-center justify-center text-xs font-bold text-steel-600 shrink-0">
                  {rule.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-steel-700">
                    <span className="font-medium">Если</span> {rule.condition}
                  </p>
                  <p className="text-xs text-steel-500">
                    <span className="font-medium">Тогда:</span> {rule.action}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-steel-600 transition-colors">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1 rounded hover:bg-steel-100 text-steel-400 hover:text-accent-rose transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === 'assignment' && (
        <Card>
          <CardHeader>
            <CardTitle>Правила назначения</CardTitle>
          </CardHeader>
          <p className="text-sm text-steel-400">Настройка правил автоматического назначения писем операторам.</p>
        </Card>
      )}

      {activeTab === 'responses' && (
        <Card>
          <CardHeader>
            <CardTitle>Шаблоны ответов</CardTitle>
          </CardHeader>
          <p className="text-sm text-steel-400">Управление шаблонами автоматических и полуавтоматических ответов.</p>
        </Card>
      )}

      {activeTab === 'roles' && (
        <Card>
          <CardHeader>
            <CardTitle>Роли и доступ</CardTitle>
          </CardHeader>
          <p className="text-sm text-steel-400">Управление ролями пользователей и уровнями доступа.</p>
        </Card>
      )}
    </div>
  );
}
