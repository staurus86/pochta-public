'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

const periodOptions = [
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
  { value: '90d', label: 'Последние 90 дней' },
];

const tooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  fontSize: '12px',
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
};

// Mock data
const classAccuracy = Array.from({ length: 14 }, (_, i) => ({
  date: `${(i + 1).toString().padStart(2, '0')}.03`,
  accuracy: 0.88 + Math.random() * 0.08,
}));

const fieldAccuracy = [
  { field: 'Компания', accuracy: 0.96, total: 347 },
  { field: 'ИНН', accuracy: 0.98, total: 289 },
  { field: 'Контакт', accuracy: 0.93, total: 312 },
  { field: 'Телефон', accuracy: 0.89, total: 267 },
  { field: 'Email', accuracy: 0.97, total: 298 },
  { field: 'Товар', accuracy: 0.84, total: 245 },
  { field: 'Бренд', accuracy: 0.91, total: 223 },
  { field: 'Количество', accuracy: 0.78, total: 189 },
  { field: 'Адрес', accuracy: 0.82, total: 156 },
  { field: 'Срок', accuracy: 0.86, total: 134 },
];

const autoPassRate = Array.from({ length: 14 }, (_, i) => ({
  date: `${(i + 1).toString().padStart(2, '0')}.03`,
  rate: 0.65 + Math.random() * 0.15,
}));

const manualCorrections = Array.from({ length: 14 }, (_, i) => ({
  date: `${(i + 1).toString().padStart(2, '0')}.03`,
  count: 5 + Math.floor(Math.random() * 20),
}));

const topErrors = [
  { type: 'Ошибка парсинга вложения', count: 12, last_seen: '2 часа назад' },
  { type: 'Таймаут IMAP-соединения', count: 8, last_seen: '4 часа назад' },
  { type: 'Неизвестная кодировка', count: 5, last_seen: '6 часов назад' },
  { type: 'CRM API timeout', count: 4, last_seen: '1 день назад' },
  { type: 'Дубликат message_id', count: 3, last_seen: '2 дня назад' },
];

const brandDist = [
  { brand: 'Grundfos', count: 89 },
  { brand: 'Danfoss', count: 67 },
  { brand: 'Wilo', count: 45 },
  { brand: 'KSB', count: 34 },
  { brand: 'Ebara', count: 23 },
  { brand: 'Siemens', count: 21 },
  { brand: 'ABB', count: 18 },
  { brand: 'Другие', count: 42 },
];

const mopWorkload = [
  { mop: 'Сидорова А.', processed: 45, pending: 8 },
  { mop: 'Козлов Д.', processed: 38, pending: 12 },
  { mop: 'Новикова Е.', processed: 52, pending: 5 },
  { mop: 'Морозов И.', processed: 29, pending: 15 },
  { mop: 'Волкова О.', processed: 41, pending: 3 },
];

const inboxLoad = [
  { inbox: 'info', load: 92, capacity: 100 },
  { inbox: 'sales', load: 78, capacity: 100 },
  { inbox: 'support', load: 65, capacity: 80 },
  { inbox: 'logist', load: 43, capacity: 60 },
  { inbox: 'buh', load: 28, capacity: 50 },
  { inbox: 'tender', load: 15, capacity: 40 },
];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-steel-900">Аналитика</h1>
          <p className="text-sm text-steel-400 mt-0.5">Метрики качества обработки почты</p>
        </div>
        <Select
          options={periodOptions}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="w-48"
        />
      </div>

      {/* Row 1: Accuracy + Auto-pass */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Точность классификации</CardTitle>
            <Badge variant="emerald">
              {Math.round(classAccuracy[classAccuracy.length - 1].accuracy * 100)}%
            </Badge>
          </CardHeader>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={classAccuracy}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40}
                  domain={[0.8, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Line type="monotone" dataKey="accuracy" stroke="#10b981" strokeWidth={2} dot={false} name="Точность" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Авто-подтверждение</CardTitle>
            <Badge variant="blue">
              {Math.round(autoPassRate[autoPassRate.length - 1].rate * 100)}%
            </Badge>
          </CardHeader>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={autoPassRate}>
                <defs>
                  <linearGradient id="autoPassGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40}
                  domain={[0.5, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Area type="monotone" dataKey="rate" stroke="#3b82f6" fill="url(#autoPassGrad)" strokeWidth={2} name="Auto-pass" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Row 2: Field accuracy + Manual corrections */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Точность по полям</CardTitle>
          </CardHeader>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fieldAccuracy} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number" domain={[0.5, 1]}
                  tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                />
                <YAxis dataKey="field" type="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={80} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
                <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} name="Точность">
                  {fieldAccuracy.map((entry, i) => (
                    <Cell key={i} fill={entry.accuracy >= 0.9 ? '#10b981' : entry.accuracy >= 0.8 ? '#3b82f6' : '#f59e0b'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ручные корректировки</CardTitle>
            <Badge variant="amber">
              {manualCorrections.reduce((sum, d) => sum + d.count, 0)} за период
            </Badge>
          </CardHeader>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={manualCorrections}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Корректировок" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Row 3: Errors + Brands */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Топ ошибок</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {topErrors.map((err, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-steel-100 last:border-0">
                <span className="w-7 h-7 rounded-md bg-rose-50 text-accent-rose flex items-center justify-center text-xs font-bold shrink-0">
                  {err.count}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-steel-700 truncate">{err.type}</p>
                  <p className="text-2xs text-steel-400">{err.last_seen}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Бренды</CardTitle>
          </CardHeader>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={brandDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="brand" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#8b5cf6" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Запросов" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Нагрузка МОП</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {mopWorkload.map((mop) => (
              <div key={mop.mop} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-steel-700">{mop.mop}</span>
                  <span className="text-2xs text-steel-400">
                    {mop.processed} / {mop.pending} ожид.
                  </span>
                </div>
                <div className="h-2 bg-steel-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-blue rounded-full transition-all"
                    style={{ width: `${(mop.processed / (mop.processed + mop.pending)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Row 4: Inbox load */}
      <Card>
        <CardHeader>
          <CardTitle>Нагрузка на ящики</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-6 gap-4">
          {inboxLoad.map((inbox) => {
            const pct = Math.round((inbox.load / inbox.capacity) * 100);
            const color = pct > 85 ? 'bg-accent-rose' : pct > 60 ? 'bg-accent-amber' : 'bg-accent-emerald';
            return (
              <div key={inbox.inbox} className="text-center space-y-2">
                <div className="relative w-16 h-16 mx-auto">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none" stroke="#e2e8f0" strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke={pct > 85 ? '#f43f5e' : pct > 60 ? '#f59e0b' : '#10b981'}
                      strokeWidth="3"
                      strokeDasharray={`${pct}, 100`}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-steel-700">
                    {pct}%
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium text-steel-700">{inbox.inbox}</p>
                  <p className="text-2xs text-steel-400">{inbox.load}/{inbox.capacity}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
