import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Вчера, ' + format(d, 'HH:mm');
  return format(d, 'dd.MM.yyyy HH:mm');
}

export function formatRelative(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

export function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'bg-accent-emerald';
  if (confidence >= 0.7) return 'bg-accent-blue';
  if (confidence >= 0.5) return 'bg-accent-amber';
  return 'bg-accent-rose';
}

export function confidenceTextColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-accent-emerald';
  if (confidence >= 0.7) return 'text-accent-blue';
  if (confidence >= 0.5) return 'text-accent-amber';
  return 'text-accent-rose';
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
