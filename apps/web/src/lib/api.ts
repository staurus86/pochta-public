import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { EmailStatus, Classification } from './constants';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

// --- Types ---

export interface Email {
  id: string;
  message_id: string;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  received_at: string;
  inbox_id: string;
  inbox_name: string;
  status: EmailStatus;
  classification: Classification;
  confidence: number;
  extracted_fields: ExtractedField[];
  attachments: Attachment[];
  crm_match: CrmMatch | null;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractedField {
  key: string;
  value: string;
  confidence: number;
  source_snippet: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  preview_url: string | null;
}

export interface CrmMatch {
  matched: boolean;
  client_id: string | null;
  client_name: string | null;
  similarity: number;
  suggestions: CrmSuggestion[];
}

export interface CrmSuggestion {
  client_id: string;
  client_name: string;
  inn: string;
  similarity: number;
}

export interface InboxAccount {
  id: string;
  name: string;
  email: string;
  imap_host: string;
  imap_port: number;
  status: 'active' | 'error' | 'paused' | 'connecting';
  last_sync_at: string | null;
  unread_count: number;
  total_today: number;
}

export interface Template {
  id: string;
  name: string;
  domain: string;
  sender_pattern: string;
  version: number;
  precision: number;
  recall: number;
  f1_score: number;
  status: 'active' | 'draft' | 'testing' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  today_total: number;
  today_client: number;
  today_spam: number;
  today_review: number;
  today_errors: number;
  sla_percent: number;
  classification_distribution: { name: string; value: number; color: string }[];
  volume_over_time: { date: string; count: number; client: number; spam: number }[];
  confidence_histogram: { range: string; count: number }[];
  inbox_heatmap: { inbox_id: string; name: string; activity: number; status: string }[];
  recent_activity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  type: 'classified' | 'confirmed' | 'rejected' | 'error' | 'crm_created';
  email_subject: string;
  email_from: string;
  timestamp: string;
  details: string;
}

export interface AnalyticsData {
  classification_accuracy: { date: string; accuracy: number }[];
  field_accuracy: { field: string; accuracy: number; total: number }[];
  auto_pass_rate: { date: string; rate: number }[];
  manual_corrections: { date: string; count: number }[];
  top_errors: { type: string; count: number; last_seen: string }[];
  brand_distribution: { brand: string; count: number }[];
  mop_workload: { mop: string; processed: number; pending: number }[];
  inbox_load: { inbox: string; load: number; capacity: number }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface EmailFilters {
  status?: EmailStatus;
  classification?: Classification;
  inbox_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

// --- API Client ---

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- React Query Hooks ---

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => apiFetch<DashboardStats>('/dashboard/stats'),
    refetchInterval: 30000,
  });
}

export function useEmails(filters: EmailFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  return useQuery({
    queryKey: ['emails', filters],
    queryFn: () => apiFetch<PaginatedResponse<Email>>(`/emails?${params}`),
    refetchInterval: 15000,
  });
}

export function useEmail(id: string) {
  return useQuery({
    queryKey: ['email', id],
    queryFn: () => apiFetch<Email>(`/emails/${id}`),
    enabled: !!id,
  });
}

export function useEmailThread(threadId: string) {
  return useQuery({
    queryKey: ['email-thread', threadId],
    queryFn: () => apiFetch<Email[]>(`/emails/thread/${threadId}`),
    enabled: !!threadId,
  });
}

export function useConfirmEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; fields?: Record<string, string> }) =>
      apiFetch(`/emails/${data.id}/confirm`, { method: 'POST', body: JSON.stringify(data.fields) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useRejectEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; reason: string }) =>
      apiFetch(`/emails/${data.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: data.reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

export function useEscalateEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; note: string }) =>
      apiFetch(`/emails/${data.id}/escalate`, { method: 'POST', body: JSON.stringify({ note: data.note }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}

export function useInboxAccounts() {
  return useQuery({
    queryKey: ['inbox-accounts'],
    queryFn: () => apiFetch<InboxAccount[]>('/inboxes'),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<Template[]>('/templates'),
  });
}

export function useAnalytics(period: string = '7d') {
  return useQuery({
    queryKey: ['analytics', period],
    queryFn: () => apiFetch<AnalyticsData>(`/analytics?period=${period}`),
  });
}

export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids: string[]; action: string }) =>
      apiFetch('/emails/bulk', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}
