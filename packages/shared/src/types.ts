import type { EMAIL_STATUS, CLASSIFICATION, PROCESSING_MODE, USER_ROLE } from './constants.js';

export type EmailStatus = typeof EMAIL_STATUS[keyof typeof EMAIL_STATUS];
export type ClassificationLabel = typeof CLASSIFICATION[keyof typeof CLASSIFICATION];
export type ProcessingMode = typeof PROCESSING_MODE[keyof typeof PROCESSING_MODE];
export type UserRole = typeof USER_ROLE[keyof typeof USER_ROLE];

export interface EmailListItem {
  id: string;
  externalMessageId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  status: EmailStatus;
  processingMode: ProcessingMode;
  confidenceScore: number | null;
  classification?: {
    label: ClassificationLabel;
    confidence: number;
  };
  inboxAccount?: {
    id: number;
    email: string;
    displayName: string;
  };
  attachmentCount?: number;
  tags?: string[];
}

export interface EmailDetail extends EmailListItem {
  toEmails: string[];
  ccEmails: string[];
  rawHeaders: Record<string, string>;
  body?: {
    textPlain: string | null;
    textHtml: string | null;
    sanitizedHtml: string | null;
    language: string | null;
    signatureBlock: string | null;
  };
  attachments?: AttachmentInfo[];
  extractedEntities?: ExtractedEntity[];
  crmMatch?: CrmMatchResult;
  thread?: ThreadInfo;
}

export interface AttachmentInfo {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  extractedText: string | null;
  ocrConfidence: number | null;
  isQuarantined: boolean;
  thumbnailPath: string | null;
}

export interface ExtractedEntity {
  id: number;
  fieldName: string;
  fieldValue: string;
  confidence: number;
  extractionMethod: string;
  sourceSnippet: string | null;
  isConfirmed: boolean;
}

export interface CrmMatchResult {
  id: number;
  matchedClient: ClientInfo | null;
  matchMethod: string | null;
  matchConfidence: string;
  candidateClients: ClientInfo[];
  needsClarification: boolean;
  assignedMop: UserInfo | null;
  assignedMoz: UserInfo | null;
  syncStatus: string;
  actions: string[];
}

export interface ClientInfo {
  id: number;
  legalName: string;
  inn: string | null;
  website: string | null;
  domain: string | null;
  isVerified: boolean;
  isDraft: boolean;
}

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface ThreadInfo {
  id: string;
  threadId: string;
  subject: string;
  messageCount: number;
  lastMessageAt: string;
  emails: EmailListItem[];
}

export interface InboxAccountInfo {
  id: number;
  email: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  isActive: boolean;
  processingMode: ProcessingMode;
  defaultBrands: string[];
  lastSyncAt: string | null;
  lastSyncError: string | null;
  syncIntervalMinutes: number;
}

export interface DashboardStats {
  period: string;
  totalEmails: number;
  clientEmails: number;
  spamEmails: number;
  vendorEmails: number;
  reviewQueue: number;
  errorCount: number;
  slaPercent: number;
  autoPassRate: number;
  avgConfidence: number;
}

export interface InboxHeatmapItem {
  inboxId: number;
  email: string;
  displayName: string;
  totalToday: number;
  totalWeek: number;
  lastSyncAt: string | null;
  errorCount: number;
  isHealthy: boolean;
}

export interface OperatorReviewPayload {
  decision: 'approve' | 'reject' | 'edit' | 'escalate';
  correctedFields?: Record<string, string>;
  notes?: string;
  overrideClassification?: ClassificationLabel;
}

export interface ConversionFunnel {
  totalEmails: number;
  classified: number;
  clientEmails: number;
  crmMatched: number;
  synced: number;
  requestsCreated: number;
}
