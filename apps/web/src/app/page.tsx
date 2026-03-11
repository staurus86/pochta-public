'use client';

import { useMemo } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';
import { Badge } from '@/components/ui/Badge';
import { cn, formatRelative } from '@/lib/utils';
import {
  Mail, Users, ShieldBan, Eye, AlertTriangle, Clock,
  ArrowRight, CheckCircle2, XCircle, Zap, Building2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from 'recharts';

// --- Mock data ---
const mockStats = {
  today_total: 347,
  today_client: 189,
  today_spam: 43,
  today_review: 28,
  today_errors: 4,
  sla_percent: 96.2,
};

const classDistribution = [
  { name: 'Запрос клиента', value: 189, color: '#3b82f6' },
  { name: 'Запрос цены', value: 67, color: '#10b981' },
  { name: 'Рекламация', value: 23, color: '#f43f5e' },
  { name: 'Техническое', value: 18, color: '#8b5cf6' },
  { name: 'Логистика', value: 31, color: '#f59e0b' },
  { name: 'Спам', value: 43, color: '#94a3b8' },
];

const volumeOverTime = Array.from({ length: 14 }, (_, i) => ({
  date: `${(i + 1).toString().padStart(2, '0')}.03`,
  count: 280 + Math.floor(Math.random() * 120),
  client: 140 + Math.floor(Math.random() * 80),
  spam: 20 + Math.floor(Math.random() * 30),
}));

const confidenceHist = [
  { range: '50-60%', count: 8 },
  { range: '60-70%', count: 15 },
  { range: '70-80%', count: 34 },
  { range: '80-90%', count: 89 },
  { range: '90-95%', count: 124 },
  { range: '95-100%', count: 187 },
];

const inboxes = [
  { id: '1', name: 'info@company.ru', activity: 0.92, status: 'active' },
  { id: '2', name: 'sales@company.ru', activity: 0.87, status: 'active' },
  { id: '3', name: 'support@company.ru', activity: 0.73, status: 'active' },
  { id: '4', name: 'tender@company.ru', activity: 0.45, status: 'active' },
  { id: '5', name: 'zakaz@company.ru', activity: 0.68, status: 'active' },
  { id: '6', name: 'reklama@company.ru', activity: 0.15, status: 'active' },
  { id: '7', name: 'office@company.ru', activity: 0.55, status: 'active' },
  { id: '8', name: 'hr@company.ru', activity: 0.22, status: 'active' },
  { id: '9', name: 'buh@company.ru', activity: 0.31, status: 'active' },
  { id: '10', name: 'dir@company.ru', activity: 0.18, status: 'active' },
  { id: '11', name: 'it@company.ru', activity: 0.08, status: 'paused' },
  { id: '12', name: 'snab@company.ru', activity: 0.61, status: 'active' },
  { id: '13', name: 'opt@company.ru', activity: 0.77, status: 'active' },
  { id: '14', name: 'export@company.ru', activity: 0.42, status: 'active' },
  { id: '15', name: 'docs@company.ru', activity: 0.35, status: 'active' },
  { id: '16', name: 'noreply@company.ru', activity: 0.05, status: 'paused' },
  { id: '17', name: 'logist@company.ru', activity: 0.58, status: 'active' },
  { id: '18', name: 'quality@company.ru', activity: 0.29, status: 'active' },
  { id: '19', name: 'tender2@company.ru', activity: 0.0, status: 'error' },
  { id: '20', name: 'partners@company.ru', activity: 0.44, status: 'active' },
  { id: '21', name: 'moscow@company.ru', activity: 0.82, status: 'active' },
  { id: '22', name: 'spb@company.ru', activity: 0.65, status: 'active' },
  { id: '23', name: 'ekb@company.ru', activity: 0.38, status: 'active' },
  { id: '24', name: 'nsk@company.ru', activity: 0.27, status: 'active' },
  { id: '25', name: 'kzn@company.ru', activity: 0.19, status: 'active' },
  { id: '26', name: 'nn@company.ru', activity: 0.33, status: 'active' },
  { id: '27', name: 'sam@company.ru', activity: 0.14, status: 'active' },
  { id: '28', name: 'krd@company.ru', activity: 0.48, status: 'active' },
];

const recentActivity = [
  { id: '1', type: 'classified' as const, email_subject: 'Запрос на поставку Grundfos CR 32-2', email_from: 'ООО "Гидросервис"', timestamp: '2026-03-11T14:23:00Z', details: 'Запрос клиента (97%)' },
  { id: '2', type: 'confirmed' as const, email_subject: 'Re: Коммерческое предложение #4521', email_from: 'АО "Теплоснаб"', timestamp: '2026-03-11T14:18:00Z', details: 'Подтверждено оператором' },
  { id: '3', type: 'crm_created' as const, email_subject: 'Заявка на подбор оборудования', email_from: 'ИП Козлов А.В.', timestamp: '2026-03-11T14:12:00Z', details: 'Создан клиент + запрос' },
  { id: '4', type: 'error' as const, email_subject: 'Fwd: Срочный запрос', email_from: 'unknown@mail.ru', timestamp: '2026-03-11T14:05:00Z', details: 'Ошибка парсинга вложения' },
  { id: '5', type: 'rejected' as const, email_subject: 'Специальное предложение для вас!', email_from: 'promo@spam.com', timestamp: '2026-03-11T13:58:00Z', details: 'Помечено как спам' },
  { id: '6', type: 'classified' as const, email_subject: 'Рекламация по поставке #7832', email_from: 'ООО "СтройМонтаж"', timestamp: '2026-03-11T13:45:00Z', details: 'Рекламация (94%)' },
];

const activityIcons = {
  classified: Zap,
  confirmed: CheckCircle2,
  rejected: XCircle,
  error: AlertTriangle,
  crm_created: Building2,
};

const activityColors = {
  classified: 'text-accent-blue bg-blue-50',
  confirmed: 'text-accent-emerald bg-emerald-50',
  rejected: 'text-steel-500 bg-steel-100',
  error: 'text-accent-rose bg-rose-50',
  crm_created: 'text-accent-violet bg-violet-50',
};

function heatmapColor(activity: number, status: string): string {
  if (status === 'error') return 'bg-accent-rose/60';
  if (status === 'paused') return 'bg-steel-200';
  if (activity > 0.8) return 'bg-accent-blue/80';
  if (activity > 0.6) return 'bg-accent-blue/55';
  if (activity > 0.4) return 'bg-accent-blue/35';
  if (activity > 0.2) return 'bg-accent-blue/20';
  if (activity > 0) return 'bg-accent-blue/10';
  return 'bg-steel-100';
}

export default function DashboardPage() {
  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-steel-900">Дашборд</h1>
        <p className="text-sm text-steel-400 mt-0.5">Обзор обработки почты за сегодня</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-6 gap-4">
        <KpiCard
          title="Входящих сегодня"
          value={mockStats.today_total}
          icon={<Mail className="w-4 h-4" />}
          accent="blue"
          trend={{ value: 12, label: '+12%' }}
        />
        <KpiCard
          title="Клиентских"
          value={mockStats.today_client}
          icon={<Users className="w-4 h-4" />}
          accent="emerald"
          trend={{ value: 8, label: '+8%' }}
        />
        <KpiCard
          title="Спам"
          value={mockStats.today_spam}
          icon={<ShieldBan className="w-4 h-4" />}
          accent="steel"
          trend={{ value: -5, label: '-5%' }}
        />
        <KpiCard
          title="На проверке"
          value={mockStats.today_review}
          icon={<Eye className="w-4 h-4" />}
          accent="amber"
          trend={{ value: 3, label: '+3' }}
        />
        <KpiCard
          title="Ошибок"
          value={mockStats.today_errors}
          icon={<AlertTriangle className="w-4 h-4" />}
          accent="rose"
          trend={{ value: -2, label: '-2' }}
        />
        <KpiCard
          title="SLA %"
          value={`${mockStats.sla_percent}%`}
          icon={<Clock className="w-4 h-4" />}
          accent="violet"
          trend={{ value: 0.5, label: '+0.5%' }}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Classification Distribution Pie */}
        <Card>
          <CardHeader>
            <CardTitle>Распределение классификаций</CardTitle>
          </CardHeader>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={classDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {classDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {classDistribution.map((item) => (
              <div key={item.name} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-2xs text-steel-500">{item.name}</span>
                <span className="text-2xs font-mono text-steel-400">{item.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Volume Over Time Area */}
        <Card>
          <CardHeader>
            <CardTitle>Объём за период</CardTitle>
          </CardHeader>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeOverTime}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorClient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={35} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#colorCount)" strokeWidth={2} name="Всего" />
                <Area type="monotone" dataKey="client" stroke="#10b981" fill="url(#colorClient)" strokeWidth={2} name="Клиентские" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Confidence Histogram */}
        <Card>
          <CardHeader>
            <CardTitle>Гистограмма уверенности</CardTitle>
          </CardHeader>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={confidenceHist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="range" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={30} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Писем">
                  {confidenceHist.map((entry, index) => {
                    const pct = parseInt(entry.range);
                    const color = pct >= 90 ? '#10b981' : pct >= 70 ? '#3b82f6' : pct >= 50 ? '#f59e0b' : '#f43f5e';
                    return <Cell key={index} fill={color} fillOpacity={0.8} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Heatmap + Activity */}
      <div className="grid grid-cols-3 gap-4">
        {/* Inbox Heatmap */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Тепловая карта ящиков</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-accent-blue/10" />
                <span className="text-2xs text-steel-400">Низкая</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-accent-blue/55" />
                <span className="text-2xs text-steel-400">Средняя</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-accent-blue/80" />
                <span className="text-2xs text-steel-400">Высокая</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-accent-rose/60" />
                <span className="text-2xs text-steel-400">Ошибка</span>
              </div>
            </div>
          </CardHeader>
          <div className="grid grid-cols-7 gap-1.5">
            {inboxes.map((inbox) => (
              <div
                key={inbox.id}
                className={cn(
                  'heatmap-cell aspect-square flex items-center justify-center group relative',
                  heatmapColor(inbox.activity, inbox.status),
                )}
                title={`${inbox.name}: ${Math.round(inbox.activity * 100)}%`}
              >
                <span className="text-2xs font-mono text-steel-700/70 opacity-0 group-hover:opacity-100 transition-opacity">
                  {inbox.name.split('@')[0]}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Последние события</CardTitle>
          </CardHeader>
          <div className="space-y-0">
            {recentActivity.map((item) => {
              const Icon = activityIcons[item.type];
              const colorClass = activityColors[item.type];
              return (
                <div key={item.id} className="flex items-start gap-3 py-2.5 border-b border-steel-100 last:border-0">
                  <div className={cn('w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5', colorClass)}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-steel-700 truncate">{item.email_subject}</p>
                    <p className="text-2xs text-steel-400">{item.email_from}</p>
                    <p className="text-2xs text-steel-400 mt-0.5">{item.details}</p>
                  </div>
                  <span className="text-2xs text-steel-400 whitespace-nowrap shrink-0">
                    {formatRelative(item.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
