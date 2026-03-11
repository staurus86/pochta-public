'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Table, TableHead, TableBody, TableRow, SortableHeader, TableCheckbox } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClassificationBadge } from '@/components/ui/ClassificationBadge';
import { ConfidenceBar } from '@/components/ui/ConfidenceBar';
import { truncate, formatDate } from '@/lib/utils';
import { Paperclip } from 'lucide-react';
import type { Email } from '@/lib/api';

interface EmailListProps {
  emails: Email[];
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;
  activeId?: string;
}

export function EmailList({ emails, selectedIds, onSelectChange, activeId }: EmailListProps) {
  const [sortField, setSortField] = useState<string>('received_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const allSelected = emails.length > 0 && emails.every((e) => selectedIds.has(e.id));
  const someSelected = emails.some((e) => selectedIds.has(e.id)) && !allSelected;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectChange(new Set(emails.map((e) => e.id)));
    } else {
      onSelectChange(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectChange(next);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sorted = [...emails].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const av = (a as Record<string, unknown>)[sortField];
    const bv = (b as Record<string, unknown>)[sortField];
    if (typeof av === 'string') return av.localeCompare(bv as string) * dir;
    if (typeof av === 'number') return ((av as number) - (bv as number)) * dir;
    return 0;
  });

  return (
    <Table>
      <TableHead>
        <tr>
          <th className="w-10 px-4 py-3">
            <TableCheckbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={handleSelectAll}
            />
          </th>
          <SortableHeader
            sorted={sortField === 'status' ? sortDir : false}
            onSort={() => handleSort('status')}
          >
            Статус
          </SortableHeader>
          <SortableHeader
            sorted={sortField === 'from_name' ? sortDir : false}
            onSort={() => handleSort('from_name')}
          >
            Отправитель
          </SortableHeader>
          <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">
            Тема
          </th>
          <th className="px-4 py-3 text-left text-xs font-semibold text-steel-500 uppercase tracking-wider">
            Ящик
          </th>
          <SortableHeader
            sorted={sortField === 'classification' ? sortDir : false}
            onSort={() => handleSort('classification')}
          >
            Классификация
          </SortableHeader>
          <SortableHeader
            sorted={sortField === 'confidence' ? sortDir : false}
            onSort={() => handleSort('confidence')}
            className="w-32"
          >
            Увер.
          </SortableHeader>
          <th className="w-8" />
          <SortableHeader
            sorted={sortField === 'received_at' ? sortDir : false}
            onSort={() => handleSort('received_at')}
            className="w-28"
          >
            Время
          </SortableHeader>
        </tr>
      </TableHead>
      <TableBody>
        {sorted.map((email) => (
          <TableRow
            key={email.id}
            selected={email.id === activeId || selectedIds.has(email.id)}
          >
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <TableCheckbox
                checked={selectedIds.has(email.id)}
                onChange={(checked) => handleSelectOne(email.id, checked)}
              />
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={email.status} />
            </td>
            <td className="px-4 py-3">
              <Link href={`/inbox/${email.id}`} className="hover:text-accent-blue transition-colors">
                <div className="text-sm font-medium text-steel-900">{email.from_name || email.from_address}</div>
                <div className="text-xs text-steel-400">{email.from_address}</div>
              </Link>
            </td>
            <td className="px-4 py-3">
              <Link href={`/inbox/${email.id}`} className="text-sm text-steel-700 hover:text-accent-blue transition-colors">
                {truncate(email.subject, 60)}
              </Link>
            </td>
            <td className="px-4 py-3">
              <span className="text-xs text-steel-500 font-mono">{email.inbox_name}</span>
            </td>
            <td className="px-4 py-3">
              <ClassificationBadge classification={email.classification} />
            </td>
            <td className="px-4 py-3">
              <ConfidenceBar value={email.confidence} />
            </td>
            <td className="px-4 py-3 text-center">
              {email.attachments.length > 0 && (
                <Paperclip className="w-3.5 h-3.5 text-steel-400 inline" />
              )}
            </td>
            <td className="px-4 py-3 text-xs text-steel-400 tabular-nums whitespace-nowrap">
              {formatDate(email.received_at)}
            </td>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
