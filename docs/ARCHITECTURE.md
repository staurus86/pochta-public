# Pochta Platform — Architecture Document

## Модуль парсинга email для CRM промышленно-торговой компании

**Version:** 2.0 | **Date:** 2026-03-11 | **Status:** Production-ready design

---

## 1. Executive Summary

### Что делает система

Pochta Platform — production-grade модуль автоматической обработки входящей электронной почты для CRM промышленно-торговой компании. Система обрабатывает **28 почтовых ящиков** (info@, sales@, tender@, regional-*, personal manager boxes), автоматически классифицирует письма, извлекает структурированные данные (ИНН, наименования компаний, номенклатура, бренды, контактные лица) и создаёт/обновляет сущности в CRM.

### Зачем это нужно

Текущий процесс: менеджеры (МОП — менеджеры отдела продаж) вручную просматривают почту, копируют данные в CRM, распределяют заявки. На это уходит 2-4 часа в день на каждого менеджера. При 28 ящиках и ~500 письмах/день это создаёт:

- **Потерянные заявки** — письма теряются, клиенты уходят к конкурентам
- **Дублирование** — один клиент заводится несколько раз разными менеджерами
- **Задержки** — среднее время реакции на заявку 4-6 часов
- **Нет аналитики** — невозможно оценить поток заявок по брендам, регионам, источникам

Целевые метрики после внедрения:

| Метрика | Сейчас | Цель Phase 4 |
|---------|--------|--------------|
| Время обработки письма | 15-30 мин | < 30 сек (auto) / < 3 мин (review) |
| % потерянных заявок | ~12% | < 1% |
| Точность классификации | — | > 95% |
| Точность CRM-матчинга | — | > 90% |
| Автоматическая обработка | 0% | > 70% |

---

## 2. Architecture Overview

### Layered Architecture

```
+---------------------------------------------------------------------+
|                    ANALYTICS / DASHBOARD LAYER                       |
|  Next.js 15 frontend: KPIs, unified inbox, review UI, settings      |
+---------------------------------------------------------------------+
|                    LEARNING / FEEDBACK LAYER                         |
|  Operator corrections -> rule refinement -> confidence recalibration |
+---------------------------------------------------------------------+
|                    HUMAN REVIEW LAYER                                |
|  Low-confidence items -> operator queue -> approve/edit/reject       |
+---------------------------------------------------------------------+
|                    CRM SYNC LAYER                                    |
|  Create/update clients, contacts, requests in CRM via API           |
+---------------------------------------------------------------------+
|                    ENRICHMENT LAYER                                   |
|  INN lookup (DADATA), website scraping, brand dictionary match       |
+---------------------------------------------------------------------+
|                    CRM MATCHING LAYER                                 |
|  INN -> company name -> contact -> email domain -> fuzzy -> manual   |
+---------------------------------------------------------------------+
|                    ENTITY EXTRACTION LAYER                            |
|  Company, INN, contact, phone, brands, SKUs, quantities, prices     |
+---------------------------------------------------------------------+
|                    CLASSIFICATION LAYER                               |
|  Rule-based + LLM: new_client / existing / spam / vendor / ...      |
+---------------------------------------------------------------------+
|                    PARSING LAYER                                      |
|  HTML->text, header extraction, signature strip, attachment decode   |
+---------------------------------------------------------------------+
|                    INGESTION LAYER                                    |
|  IMAP polling (28 mailboxes), dedup, thread detection, raw store    |
+---------------------------------------------------------------------+
|              INFRASTRUCTURE: PostgreSQL, Redis, S3 (Tigris)          |
+---------------------------------------------------------------------+
```

### Data Flow

```
  IMAP (28 mailboxes)
       |
       v
  +----------+    +----------+    +-----------+    +--------------+
  | INGEST   |--->|  PARSE   |--->| CLASSIFY  |--->|   EXTRACT    |
  | fetch &  |    | normalize|    | rule+LLM  |    |  entities    |
  | dedup    |    | strip sig|    | categorize|    |  INN, brand  |
  +----------+    +----------+    +-----------+    +--------------+
                                                         |
       +------------------------------------------------|
       v
  +--------------+    +----------+    +----------+    +----------+
  |  CRM MATCH   |--->|  ENRICH  |--->|  REVIEW  |--->| CRM SYNC |
  |  cascade     |    |  DADATA  |    |  operator |    |  create/ |
  |  lookup      |    |  scrape  |    |  approve  |    |  update  |
  +--------------+    +----------+    +----------+    +----------+
                                           |               |
                                           v               v
                                    +------------+   +-----------+
                                    |  LEARNING  |   | ANALYTICS |
                                    |  feedback  |   | dashboard |
                                    +------------+   +-----------+
```

---

## 3. Railway Deployment Topology

### Services Map

```
Railway Project: pochta-platform
|
|-- web          (Next.js 15, port 3000)
|   |-- Dockerfile.web
|   |-- 512 MB RAM, 0.5 vCPU
|   |-- Custom domain: pochta.company.ru
|   +-- Env: NEXT_PUBLIC_API_URL, SESSION_SECRET
|
|-- api          (Fastify, port 4000)
|   |-- Dockerfile.api
|   |-- 1 GB RAM, 1 vCPU
|   |-- Internal URL: api.railway.internal:4000
|   +-- Env: DATABASE_URL, REDIS_URL, S3_*, OPENAI_API_KEY, DADATA_TOKEN
|
|-- worker       (BullMQ workers, no port)
|   |-- Dockerfile.worker
|   |-- 2 GB RAM, 1 vCPU (OCR needs memory)
|   |-- Concurrency: 5 per queue
|   +-- Env: same as api + WORKER_CONCURRENCY=5
|
|-- postgres     (Railway managed PostgreSQL 16)
|   |-- 1 GB RAM, 10 GB storage
|   |-- Connection pooling via PgBouncer
|   +-- Daily backups, 7-day retention
|
|-- redis        (Railway managed Redis 7)
|   |-- 256 MB RAM
|   |-- Persistence: AOF
|   +-- Used for: BullMQ queues, caching, rate limiting
|
+-- tigris       (S3-compatible object storage)
    |-- Bucket: pochta-attachments
    |-- Bucket: pochta-raw-emails
    +-- Bucket: pochta-exports
```

### Internal Networking

```
+---------+  HTTPS   +---------+  internal  +----------+
| Browser |--------->|   web   |----------->|   api    |
|         |          | :3000   |            |  :4000   |
+---------+          +---------+            +----------+
                                                |  |
                         +----------------------+  |
                         v                         v
                   +----------+            +----------+
                   | postgres |            |  redis   |
                   |  :5432   |            |  :6379   |
                   +----------+            +----------+
                         ^                       ^
                         |    +----------+       |
                         +----|  worker  |-------+
                              | (no port)|
                              +----------+
                                   |
                                   v
                             +----------+
                             |  tigris  |
                             |   (S3)   |
                             +----------+
```

---

## 4. Tech Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Frontend | Next.js | 15.x | App Router, RSC for dashboard performance, server actions for forms |
| UI Framework | React | 19.x | Concurrent features, Suspense for streaming inbox |
| Styling | Tailwind CSS | 4.x | Utility-first, rapid UI development, consistent design |
| UI Components | shadcn/ui | latest | Accessible, customizable, no vendor lock-in (copy-paste model) |
| Backend API | Fastify | 5.x | 2x faster than Express, JSON Schema validation, plugin architecture |
| ORM | Prisma | 6.x | Type-safe queries, migrations, introspection; excellent PostgreSQL support |
| Database | PostgreSQL | 16 | JSONB for flexible metadata, full-text search, trigram index for fuzzy matching |
| Cache/Queue | Redis | 7.x | BullMQ backend, caching DADATA responses, rate limiting counters |
| Job Queue | BullMQ | 5.x | Reliable job processing, delayed jobs, retry with backoff, job events |
| Object Storage | Tigris (S3) | -- | Railway-native S3, low latency, no egress fees within Railway |
| OCR | Tesseract.js | 5.x | WASM-based OCR for scanned PDFs/images, no external API dependency |
| Image Processing | sharp | 0.33.x | Fast image resize/convert before OCR, attachment thumbnails |
| LLM Classification | OpenAI API | gpt-4o-mini | Cost-effective classification ($0.15/1M input tokens), structured output |
| LLM Extraction | Claude API | claude-sonnet-4-20250514 | Superior entity extraction from Russian business text, tool_use for structured output |
| Email Parsing | mailparser | 3.x | MIME parsing, attachment extraction, encoding handling |
| IMAP Client | imapflow | 1.x | Modern IMAP client, IDLE support, connection pooling |
| INN/Company Lookup | DADATA API | -- | Russian company data enrichment by INN, fuzzy company name search |
| HTML Sanitization | DOMPurify | 3.x | XSS prevention for email HTML rendering |
| Auth | better-auth | 1.x | Session-based auth, RBAC, Railway-friendly |
| Validation | zod | 3.x | Runtime schema validation, shared between frontend and backend |

---

## 5. Data Model

### Entity-Relationship Overview

```
inbox_accounts --1:N--> mailbox_sync_state
inbox_accounts --1:N--> emails
emails --N:1--> email_threads
emails --1:1--> email_bodies
emails --1:N--> email_attachments
emails --1:1--> email_classification
emails --1:N--> extracted_entities
extracted_entities --1:N--> entity_candidates
emails --1:N--> crm_matches
crm_matches --N:1--> clients
clients --1:N--> client_contacts
emails --N:1--> requests
requests --1:N--> request_items
emails --1:N--> operator_reviews
operator_reviews --1:N--> learning_feedback
emails --1:N--> processing_jobs
users --N:1--> roles
```

### Tables

#### `inbox_accounts`
Конфигурация подключённых почтовых ящиков.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email | VARCHAR(255) UNIQUE | Email address |
| display_name | VARCHAR(255) | "Отдел продаж Москва" |
| imap_host | VARCHAR(255) | IMAP server hostname |
| imap_port | INTEGER | Default 993 |
| imap_user | VARCHAR(255) | IMAP login |
| imap_password_enc | TEXT | AES-256-GCM encrypted password |
| imap_tls | BOOLEAN | Default true |
| smtp_host | VARCHAR(255) | For outbound replies |
| smtp_port | INTEGER | Default 587 |
| mailbox_type | VARCHAR(50) | 'shared_sales', 'personal_mop', 'tender', 'info' |
| assigned_mop_id | UUID FK -> users | Default МОП for this inbox |
| poll_interval_sec | INTEGER | Default 60 |
| is_active | BOOLEAN | Default true |
| last_error | TEXT | Last connection error |
| last_error_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `mailbox_sync_state`
Состояние синхронизации (UIDVALIDITY, last UID).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| inbox_account_id | UUID FK | |
| folder_name | VARCHAR(255) | Default 'INBOX' |
| uid_validity | BIGINT | IMAP UIDVALIDITY |
| last_uid | BIGINT | Last fetched UID |
| last_sync_at | TIMESTAMPTZ | |
| total_messages | INTEGER | |
| sync_status | VARCHAR(20) | 'idle', 'syncing', 'error' |
| error_message | TEXT | |
| UNIQUE(inbox_account_id, folder_name) | | |

#### `email_threads`
Группировка писем в цепочки.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| subject_normalized | VARCHAR(500) | Без Re:/Fwd:/FW: |
| first_message_id | VARCHAR(500) | Message-ID первого письма |
| last_activity_at | TIMESTAMPTZ | |
| message_count | INTEGER | |
| participant_emails | TEXT[] | Все участники цепочки |
| inbox_account_id | UUID FK | |
| is_resolved | BOOLEAN | |

#### `emails`
Основная таблица писем (метаданные без тела).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| inbox_account_id | UUID FK | Which mailbox received it |
| thread_id | UUID FK -> email_threads | |
| message_id | VARCHAR(500) UNIQUE | RFC Message-ID |
| in_reply_to | VARCHAR(500) | |
| references_header | TEXT | |
| from_address | VARCHAR(255) | |
| from_name | VARCHAR(255) | |
| to_addresses | JSONB | [{email, name}] |
| cc_addresses | JSONB | |
| subject | VARCHAR(1000) | |
| date_sent | TIMESTAMPTZ | |
| date_received | TIMESTAMPTZ | |
| has_attachments | BOOLEAN | |
| attachment_count | INTEGER | |
| importance | VARCHAR(20) | 'low', 'normal', 'high' |
| imap_uid | BIGINT | |
| raw_size_bytes | INTEGER | |
| raw_s3_key | VARCHAR(500) | S3 key for raw .eml |
| processing_state | VARCHAR(30) | State machine state |
| processing_error | TEXT | |
| confidence_score | DECIMAL(5,4) | Overall pipeline confidence |
| assigned_mop_id | UUID FK -> users | |
| assigned_moz_id | UUID FK -> users | |
| is_read | BOOLEAN | |
| is_starred | BOOLEAN | |
| is_archived | BOOLEAN | |

**Indexes:** `(inbox_account_id, processing_state)`, `(date_received DESC)`, `(from_address)`, `(thread_id)`, `(assigned_mop_id)`

#### `email_bodies`
Тело письма отдельно (для производительности основной таблицы).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK UNIQUE | |
| body_html | TEXT | Original HTML |
| body_text | TEXT | Plain text version |
| body_text_clean | TEXT | After strip signature, quotes |
| body_language | VARCHAR(10) | Default 'ru' |
| signature_text | TEXT | Extracted signature block |
| quoted_text | TEXT | Extracted quoted reply |

#### `email_attachments`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| filename | VARCHAR(500) | |
| content_type | VARCHAR(255) | |
| size_bytes | INTEGER | |
| s3_key | VARCHAR(500) | |
| s3_bucket | VARCHAR(100) | Default 'pochta-attachments' |
| checksum_sha256 | VARCHAR(64) | |
| is_inline | BOOLEAN | For inline images |
| content_id | VARCHAR(255) | CID for inline images |
| ocr_text | TEXT | Extracted text from image/PDF |
| ocr_confidence | DECIMAL(5,4) | |
| thumbnail_s3_key | VARCHAR(500) | |
| extracted_data | JSONB | Structured data from attachment |
| processing_status | VARCHAR(20) | 'pending', 'processing', 'done', 'failed' |

#### `email_classification`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK UNIQUE | |
| category | VARCHAR(50) | See section 7 |
| subcategory | VARCHAR(50) | |
| confidence | DECIMAL(5,4) | |
| method | VARCHAR(30) | 'rule', 'llm', 'hybrid', 'operator' |
| rule_ids_matched | UUID[] | Which template_rules matched |
| llm_model | VARCHAR(100) | |
| llm_prompt_tokens | INTEGER | |
| llm_completion_tokens | INTEGER | |
| llm_raw_response | JSONB | |
| is_spam | BOOLEAN | |
| is_auto_reply | BOOLEAN | |
| is_bounce | BOOLEAN | |
| brand_tags | TEXT[] | ['SKF', 'Timken', 'NTN'] |
| region_tag | VARCHAR(50) | |
| urgency | VARCHAR(20) | 'low', 'normal', 'high', 'critical' |
| operator_override | BOOLEAN | |

#### `extracted_entities`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| entity_type | VARCHAR(50) | 'company_name', 'inn', 'kpp', 'contact_name', 'phone', 'brand', 'sku', 'quantity', 'price', 'delivery_address', 'deadline', 'payment_terms' |
| raw_value | TEXT | As found in text |
| normalized_value | TEXT | After normalization |
| confidence | DECIMAL(5,4) | |
| source | VARCHAR(30) | 'body', 'subject', 'signature', 'attachment', 'ocr' |
| position_start | INTEGER | Char offset in body_text_clean |
| position_end | INTEGER | |
| extraction_method | VARCHAR(30) | 'regex', 'llm', 'dictionary', 'ocr' |
| is_verified | BOOLEAN | |
| verified_by | UUID FK -> users | |

#### `entity_candidates`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| extracted_entity_id | UUID FK | |
| candidate_value | TEXT | |
| confidence | DECIMAL(5,4) | |
| source | VARCHAR(50) | 'dadata', 'crm_lookup', 'fuzzy_match' |
| metadata | JSONB | Additional data from source |
| is_selected | BOOLEAN | |
| selected_by | UUID FK -> users | |

#### `crm_matches`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| client_id | UUID FK -> clients | |
| contact_id | UUID FK -> client_contacts | |
| match_method | VARCHAR(30) | 'inn', 'company_name', 'contact_email', 'email_domain', 'website', 'manual' |
| match_confidence | DECIMAL(5,4) | |
| is_new_client | BOOLEAN | |
| is_verified | BOOLEAN | |
| verified_by | UUID FK -> users | |
| crm_external_id | VARCHAR(255) | ID in external CRM |
| match_details | JSONB | Debug info about matching cascade |

#### `clients`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| crm_external_id | VARCHAR(255) UNIQUE | |
| company_name | VARCHAR(500) | |
| company_name_normalized | VARCHAR(500) | Lowercase, без ООО/ЗАО/ИП |
| inn | VARCHAR(12) | |
| kpp | VARCHAR(9) | |
| ogrn | VARCHAR(15) | |
| legal_address | TEXT | |
| actual_address | TEXT | |
| website | VARCHAR(500) | |
| industry | VARCHAR(100) | |
| region | VARCHAR(100) | |
| assigned_mop_id | UUID FK -> users | |
| source | VARCHAR(50) | 'crm_sync', 'email_auto', 'manual' |
| is_verified | BOOLEAN | |
| dadata_data | JSONB | Raw DADATA response cache |
| metadata | JSONB | |

**Indexes:** `(inn)`, `GIN(company_name_normalized gin_trgm_ops)` for fuzzy search

#### `client_contacts`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| client_id | UUID FK | |
| crm_external_id | VARCHAR(255) | |
| full_name | VARCHAR(255) | |
| email | VARCHAR(255) | |
| phone | VARCHAR(50) | |
| position | VARCHAR(255) | |
| department | VARCHAR(255) | |
| is_primary | BOOLEAN | |
| is_decision_maker | BOOLEAN | |
| source | VARCHAR(50) | |

#### `requests`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| crm_external_id | VARCHAR(255) | |
| email_id | UUID FK | |
| client_id | UUID FK | |
| contact_id | UUID FK | |
| request_number | VARCHAR(50) UNIQUE | Auto: REQ-2026-001234 |
| request_type | VARCHAR(50) | 'price_inquiry', 'order', 'tender', 'complaint' |
| status | VARCHAR(30) | 'new', 'in_progress', 'quoted', 'won', 'lost', 'cancelled' |
| assigned_mop_id | UUID FK | |
| assigned_moz_id | UUID FK | |
| brand_tags | TEXT[] | |
| region | VARCHAR(100) | |
| source_inbox | VARCHAR(255) | |
| priority | VARCHAR(20) | |
| deadline | TIMESTAMPTZ | |
| total_amount | DECIMAL(15,2) | |
| currency | VARCHAR(3) | Default 'RUB' |
| notes | TEXT | |
| synced_to_crm | BOOLEAN | |
| synced_at | TIMESTAMPTZ | |

#### `request_items`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| request_id | UUID FK | |
| brand | VARCHAR(100) | |
| article_number | VARCHAR(100) | |
| description | TEXT | |
| quantity | DECIMAL(12,3) | |
| unit | VARCHAR(20) | 'шт', 'кг', 'м', 'компл' |
| target_price | DECIMAL(15,2) | |
| currency | VARCHAR(3) | |
| delivery_terms | VARCHAR(100) | |
| notes | TEXT | |
| matched_sku_id | VARCHAR(255) | Internal SKU match |
| confidence | DECIMAL(5,4) | |
| sort_order | INTEGER | |

#### `template_rules`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| rule_name | VARCHAR(255) | |
| rule_type | VARCHAR(50) | 'classification', 'extraction', 'routing', 'spam' |
| conditions | JSONB | {field, operator, value} conditions |
| actions | JSONB | What to do when matched |
| priority | INTEGER | Lower = higher priority |
| sender_pattern | VARCHAR(500) | Regex for from_address |
| subject_pattern | VARCHAR(500) | Regex for subject |
| body_pattern | VARCHAR(500) | Regex for body |
| inbox_account_ids | UUID[] | Apply only to these inboxes |
| is_active | BOOLEAN | |
| hit_count | INTEGER | |
| last_hit_at | TIMESTAMPTZ | |
| created_by | UUID FK | |
| approved_by | UUID FK | |

#### `template_versions`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| template_rule_id | UUID FK | |
| version_number | INTEGER | |
| conditions | JSONB | |
| actions | JSONB | |
| change_reason | TEXT | |
| changed_by | UUID FK | |
| UNIQUE(template_rule_id, version_number) | | |

#### `operator_reviews`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| reviewer_id | UUID FK -> users | |
| review_type | VARCHAR(30) | 'classification', 'extraction', 'matching', 'full' |
| decision | VARCHAR(30) | 'approved', 'corrected', 'rejected', 'escalated' |
| original_data | JSONB | What the system produced |
| corrected_data | JSONB | What the operator changed |
| correction_notes | TEXT | |
| review_duration_ms | INTEGER | How long the review took |

#### `learning_feedback`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| operator_review_id | UUID FK | |
| email_id | UUID FK | |
| feedback_type | VARCHAR(50) | 'classification_correction', 'entity_correction', 'match_correction', 'new_rule_suggestion' |
| field_name | VARCHAR(100) | |
| old_value | TEXT | |
| new_value | TEXT | |
| applied_to_rule_id | UUID FK -> template_rules | |
| is_processed | BOOLEAN | |
| processed_at | TIMESTAMPTZ | |

#### `automation_runs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| run_type | VARCHAR(50) | 'scheduled_fetch', 'manual_reprocess', 'bulk_import' |
| status | VARCHAR(20) | 'running', 'completed', 'failed', 'cancelled' |
| inbox_account_id | UUID FK | |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| emails_fetched | INTEGER | |
| emails_processed | INTEGER | |
| emails_failed | INTEGER | |
| error_message | TEXT | |
| metadata | JSONB | |

#### `audit_logs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| user_id | UUID FK | |
| action | VARCHAR(100) | 'email.classify', 'review.approve', 'client.create' |
| resource_type | VARCHAR(50) | 'email', 'client', 'request', 'rule' |
| resource_id | UUID | |
| old_data | JSONB | |
| new_data | JSONB | |
| ip_address | INET | |
| user_agent | TEXT | |
| created_at | TIMESTAMPTZ | |

**Indexes:** `(user_id, created_at DESC)`, `(resource_type, resource_id)`

#### `outbound_messages`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | Reply to this email |
| request_id | UUID FK | |
| from_inbox_id | UUID FK -> inbox_accounts | |
| to_addresses | JSONB | |
| cc_addresses | JSONB | |
| subject | VARCHAR(1000) | |
| body_html | TEXT | |
| body_text | TEXT | |
| status | VARCHAR(20) | 'draft', 'queued', 'sent', 'failed' |
| sent_at | TIMESTAMPTZ | |
| smtp_message_id | VARCHAR(500) | |
| template_id | UUID | |
| created_by | UUID FK | |

#### `clarification_requests`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| outbound_message_id | UUID FK | |
| missing_fields | TEXT[] | ['inn', 'contact_name', 'brand'] |
| question_text | TEXT | |
| status | VARCHAR(20) | 'pending', 'sent', 'replied', 'expired' |
| reply_email_id | UUID FK | |
| expires_at | TIMESTAMPTZ | |

#### `processing_jobs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email_id | UUID FK | |
| queue_name | VARCHAR(100) | |
| bullmq_job_id | VARCHAR(255) | |
| status | VARCHAR(20) | 'waiting', 'active', 'completed', 'failed', 'delayed' |
| attempts | INTEGER | |
| max_attempts | INTEGER | Default 3 |
| error_message | TEXT | |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| duration_ms | INTEGER | |

#### `tags`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | VARCHAR(100) UNIQUE | |
| color | VARCHAR(7) | Hex color, default '#6B7280' |
| tag_type | VARCHAR(30) | 'custom', 'brand', 'region', 'status' |
| created_by | UUID FK | |

Junction table `email_tags`: `(email_id UUID FK, tag_id UUID FK, PRIMARY KEY(email_id, tag_id))`

#### `brand_dictionary`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| brand_name | VARCHAR(255) | Canonical: "SKF" |
| aliases | TEXT[] | ['СКФ', 'skf', 'S.K.F.', 'скф групп'] |
| category | VARCHAR(100) | 'подшипники', 'ремни', 'смазки' |
| assigned_mop_ids | UUID[] | МОПы, ответственные за бренд |
| assigned_moz_ids | UUID[] | МОЗы для бренда |
| is_active | BOOLEAN | |
| metadata | JSONB | |

**Index:** `GIN(aliases)` for array containment search

#### `assignment_rules`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| rule_name | VARCHAR(255) | |
| rule_type | VARCHAR(30) | 'mop_assignment', 'moz_assignment' |
| priority | INTEGER | |
| conditions | JSONB | {brand_tags, region, source_inbox, client_type} |
| assigned_user_id | UUID FK | |
| method | VARCHAR(30) | 'direct', 'round_robin', 'least_loaded' |
| round_robin_pool | UUID[] | User IDs for round-robin |
| is_active | BOOLEAN | |

#### `users`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| email | VARCHAR(255) UNIQUE | |
| full_name | VARCHAR(255) | |
| role_id | UUID FK -> roles | |
| department | VARCHAR(100) | |
| is_active | BOOLEAN | |
| password_hash | TEXT | |
| last_login_at | TIMESTAMPTZ | |
| preferences | JSONB | UI preferences |

#### `roles`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | VARCHAR(50) UNIQUE | 'admin', 'operator', 'mop', 'sales_head', 'analyst', 'integrator' |
| display_name | VARCHAR(100) | 'Администратор', 'Оператор', 'МОП', ... |
| permissions | JSONB | ['emails.read', 'emails.review', 'clients.write', ...] |

---

## 6. Email Processing Pipeline

### State Machine

```
                              +-------------+
                              | quarantined |
                              +------^------+
                                     |
                                     | (unrecoverable/suspicious)
                                     |
+----------+    +-----------+    +--------+    +------------+    +-------------------+
| received |--->| normalized|--->| parsed |--->| classified |--->| entities_extracted |
+----------+    +-----------+    +--------+    +------------+    +-------------------+
                                     |                                    |
                                     | (parse error)                      |
                                     v                                    v
                                 +--------+                      +--------------+
                                 | failed |                      | crm_matched  |
                                 +--------+                      +--------------+
                                     ^                                    |
                                     |              +---------------------+-----+
                                     |              |                           |
                                     |              v                           v
                                     |     +-----------------+    +------------------------+
                                     +-----| awaiting_review |    | awaiting_client_details|
                                     |     +-----------------+    +------------------------+
                                     |              |                           |
                                     |              v                           v
                                     |     +---------------+         (clarification reply)
                                     +-----| ready_to_sync |<-----------+
                                           +---------------+
                                                  |
                                                  v
                                             +--------+
                                             | synced |
                                             +--------+
```

### State Transitions

| From | To | Trigger | Worker |
|------|----|---------|--------|
| received | normalized | email.parse worker strips headers, decodes | email.parse |
| normalized | parsed | Body extracted, signature stripped, attachments saved to S3 | email.parse |
| parsed | classified | Rule engine + LLM assign category | email.classify |
| classified | entities_extracted | Entities extracted from body + attachments | email.extract |
| entities_extracted | crm_matched | Matching cascade finds/creates client | email.crm-match |
| crm_matched | awaiting_review | confidence < 0.85 OR is_new_client=true | email.crm-match |
| crm_matched | ready_to_sync | confidence >= 0.85 AND known client | email.crm-match |
| crm_matched | awaiting_client_details | Missing required fields (INN, contact) | email.crm-match |
| awaiting_review | ready_to_sync | Operator approves | API (manual) |
| awaiting_review | failed | Operator rejects | API (manual) |
| awaiting_client_details | crm_matched | Clarification reply received | email.parse |
| ready_to_sync | synced | CRM API write succeeds | email.sync |
| ready_to_sync | failed | CRM API write fails after retries | email.sync |
| any | quarantined | Suspicious content, malware, or repeated failures | any worker |
| any | failed | Unrecoverable error after max retries | any worker |

### Confidence Thresholds

| Threshold | Action |
|-----------|--------|
| >= 0.95 | Fully automatic: classify + extract + match + sync |
| 0.85 - 0.94 | Auto-process, flag for spot-check |
| 0.70 - 0.84 | Queue for operator review |
| < 0.70 | Require mandatory operator review |
| classification=spam, confidence >= 0.90 | Auto-archive, no review needed |

---

## 7. Classification Categories

| Category | Description | Typical Signals |
|----------|-------------|-----------------|
| `new_client_request` | Запрос от нового клиента (не найден в CRM) | Unknown sender domain, "прошу предложить", "запрос цен" |
| `existing_client` | Письмо от существующего клиента | Sender email/domain matches CRM contact |
| `spam` | Рекламная рассылка, нежелательная почта | Unsubscribe link, mass-mailing headers, known spam patterns |
| `vendor_offer` | Предложение от поставщика | Known vendor domains, "прайс-лист", "предложение" |
| `system_notification` | Системные уведомления (bounces, auto-replies) | mailer-daemon@, Auto-Submitted header, OOF patterns |
| `clarification_reply` | Ответ на наш запрос уточнения | In-Reply-To matches our outbound_messages |
| `attachment_only` | Письмо содержит только вложение, нет текста | Empty/minimal body, has_attachments=true |
| `multi_brand_request` | Запрос на несколько брендов | Multiple brand matches in brand_dictionary |
| `mono_brand_request` | Запрос на один бренд | Single brand match |
| `unclassified` | Не удалось классифицировать | No rule match, LLM confidence < 0.5 |

### Classification Pipeline

```
Email arrives
    |
    v
[1] Rule-based pre-filter (template_rules WHERE rule_type='classification')
    |-- Match spam patterns (sender blocklist, subject patterns)
    |-- Match system_notification (Auto-Submitted header, mailer-daemon)
    |-- Match clarification_reply (In-Reply-To in our outbound_messages)
    |-- Match vendor (known vendor domain list)
    |
    |-- If matched with confidence >= 0.95 --> DONE (skip LLM)
    |
    v
[2] LLM classification (gpt-4o-mini)
    |-- Prompt: system role + email subject + first 2000 chars of body_text_clean
    |-- Structured output: {category, subcategory, confidence, brand_tags[], urgency}
    |-- Cost: ~$0.0002 per email
    |
    v
[3] Hybrid merge
    |-- If rule and LLM agree --> confidence = max(rule_conf, llm_conf)
    |-- If rule and LLM disagree --> confidence = min(rule_conf, llm_conf) * 0.7
    |-- brand_tags: union of rule-detected and LLM-detected brands
    |
    v
[4] Write to email_classification
```

---

## 8. CRM Integration Logic

### Matching Cascade

The system attempts to match an incoming email to an existing CRM client using a cascading strategy. Each step is tried in order; the first match with confidence >= threshold wins.

```
Step 1: INN Match (confidence: 0.99)
   |  extracted_entities WHERE entity_type='inn'
   |  --> clients WHERE inn = extracted_inn
   |  Exact match. Highest confidence.
   |
   v (no match)
Step 2: Company Name Match (confidence: 0.85-0.95)
   |  extracted_entities WHERE entity_type='company_name'
   |  --> Normalize: remove ООО/ЗАО/ИП/ПАО, lowercase, trim
   |  --> clients WHERE company_name_normalized = normalized_name
   |  --> If no exact: pg_trgm similarity >= 0.6
   |
   v (no match)
Step 3: Contact Person Email Match (confidence: 0.90)
   |  from_address from email
   |  --> client_contacts WHERE email = from_address
   |  --> Get client_id from matched contact
   |
   v (no match)
Step 4: Email Domain Match (confidence: 0.75)
   |  Extract domain from from_address (e.g., "skf.com")
   |  --> client_contacts WHERE email LIKE '%@' || domain
   |  --> If single client matches: use it
   |  --> If multiple clients: flag for review
   |
   v (no match)
Step 5: Website/DADATA Enrichment (confidence: 0.70)
   |  If INN extracted: DADATA findById/party
   |  --> Get official company name, address, OGRN
   |  --> Retry Step 2 with enriched name
   |  If email domain extracted: DADATA findById/email
   |  --> Attempt reverse domain lookup
   |
   v (no match)
Step 6: Manual Match (confidence: 0.00)
   |  No automatic match found.
   |  --> Set is_new_client = true
   |  --> Route to operator review queue
   |  --> Operator selects existing client or creates new
```

### DADATA Integration

```
POST https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party
Authorization: Token {DADATA_TOKEN}
Content-Type: application/json

{"query": "7707083893"}  // INN

Response cached in clients.dadata_data for 30 days.
Redis cache key: dadata:inn:{inn} TTL 30d
```

---

## 9. Assignment Logic

### МОП Assignment (Менеджер Отдела Продаж)

Assignment determines which sales manager handles the request.

```
Priority order of assignment_rules WHERE rule_type='mop_assignment':

1. Brand-specific assignment
   IF brand_tags contains 'SKF' --> assigned_mop_id = user_skf_specialist
   IF brand_tags contains 'Timken' --> assigned_mop_id = user_timken_specialist

2. Region-based assignment
   IF region = 'moscow' --> round_robin_pool = [user_mop_msk_1, user_mop_msk_2, user_mop_msk_3]
   IF region = 'ural' --> round_robin_pool = [user_mop_ural_1, user_mop_ural_2]

3. Source inbox assignment
   IF source_inbox = 'tender@company.ru' --> assigned_mop_id = user_tender_specialist
   IF source_inbox = 'info@company.ru' --> method = 'round_robin'

4. Existing client assignment
   IF client.assigned_mop_id IS NOT NULL --> use client's existing МОП

5. Fallback: round-robin across all active МОПы
```

### МОЗ Assignment (Менеджер Отдела Закупок)

```
1. Brand/department match
   IF brand_tags contains 'SKF' OR 'FAG' --> moz_bearings_team
   IF brand_tags contains 'Gates' OR 'Optibelt' --> moz_belts_team

2. Load balancing
   SELECT user_id FROM users WHERE role='moz' AND department=matched_dept
   ORDER BY active_request_count ASC LIMIT 1

3. Fallback: least-loaded МОЗ across all departments
```

### Round-Robin Implementation

```
Redis key: rr:{pool_id}:index (INTEGER, atomic INCR)

function getNextAssignee(poolId, userIds) {
    const index = await redis.incr(`rr:${poolId}:index`);
    const activeUsers = userIds.filter(id => isUserActive(id) && !isUserOnLeave(id));
    return activeUsers[index % activeUsers.length];
}
```

### Manual Reassignment

Any user with `emails.reassign` permission can reassign via:
- `PATCH /api/v1/emails/:id/assign` with `{assigned_mop_id}` or `{assigned_moz_id}`
- Creates audit_log entry with old and new assignment
- Sends notification to new assignee via WebSocket

---

## 10. Inbox Dashboard UX

### 10.1 Main Dashboard (KPIs)

```
+------------------------------------------------------------------+
|  POCHTA                      [Search...________]  [!] [User v]   |
+------------------------------------------------------------------+
|        |                                                          |
| [side] |   Сегодня: 2026-03-11                                   |
| bar    |                                                          |
|        |   +------------+  +------------+  +------------+         |
| Inbox  |   | Входящие   |  | На проверку|  | Синхронизир.|        |
| Обзор  |   |    127     |  |     23     |  |     89     |         |
| Заявки |   | +12 за час |  | avg 4 мин  |  | 94% auto   |         |
| Клиенты|   +------------+  +------------+  +------------+         |
| Правила|                                                          |
| Аналит.|   +------------+  +------------+  +------------+         |
| Настр. |   | Ошибки     |  | Спам       |  | Новые клиен.|        |
|        |   |     3      |  |     41     |  |     15     |         |
|        |   | [Подробнее]|  | [Подробнее]|  | [Подробнее]|         |
|        |   +------------+  +------------+  +------------+         |
|        |                                                          |
|        |   Обработка за последние 24 часа                         |
|        |   +-------------------------------------------------+    |
|        |   |  ####                                           |    |
|        |   |  ########                                       |    |
|        |   |  ############                                   |    |
|        |   |  ##################                             |    |
|        |   |  00  04  08  12  16  20  24                     |    |
|        |   +-------------------------------------------------+    |
|        |                                                          |
|        |   Топ-5 брендов сегодня      Заявки по ящикам            |
|        |   1. SKF        34 заявки    info@     42                |
|        |   2. Timken     22 заявки    sales@    38                |
|        |   3. NTN        18 заявки    tender@   21                |
|        |   4. FAG        15 заявки    msk@      14                |
|        |   5. Koyo       11 заявок    ural@     12                |
+--------+----------------------------------------------------------+
```

### 10.2 Unified Inbox

```
+------------------------------------------------------------------+
|  POCHTA  > Входящие                 [Search...____]  [Filters v]  |
+------------------------------------------------------------------+
| [side] |  Фильтры: [Все ящики v] [Все статусы v] [Все бренды v]  |
| bar    |           [Только мои ] [Непрочитанные ] [С вложениями ] |
|        |----------------------------------------------------------+
|        |  [ ] | От                | Тема            | Бренды |Ст.|
|        |------+---------+---------+-----------------+--------+----|
|        |  [*] | ООО РомТ | Запрос цен SKF 623..  | SKF    | .. |
|        |      | romtorg  | 2 вложения  10:34      |        | !! |
|        |------+---------+---------+-----------------+--------+----|
|        |  [ ] | Иванов   | Re: Подшипники NTN..  | NTN    | OK |
|        |      | ivan@bea | 08:21                   |        | -> |
|        |------+---------+---------+-----------------+--------+----|
|        |  [ ] | tender@  | Тендер #4412 подши..   | Multi  | ?? |
|        |      | gazprom  | 3 вложения  вчера      |SKF,FAG | !! |
|        |------+---------+---------+-----------------+--------+----|
|        |  [ ] | noreply@ | Ваш заказ отправлен   | --     | SP |
|        |      | ozon.ru  | вчера 23:10            |        | AR |
|        |------+---------+---------+-----------------+--------+----|
|        |                                                          |
|        |  Status icons: !! = awaiting_review, OK = synced,        |
|        |  ?? = awaiting_client_details, -> = ready_to_sync,       |
|        |  SP = spam, AR = archived                                |
|        |                                                          |
|        |  Showing 1-50 of 127      [< Prev] [1] [2] [3] [Next >] |
+--------+----------------------------------------------------------+
```

### 10.3 Email Detail Card (3-Column Layout)

```
+------------------------------------------------------------------+
|  POCHTA  > Входящие > Письмо #e3f2a1                             |
+------------------------------------------------------------------+
| LEFT COLUMN    | CENTER COLUMN        | RIGHT COLUMN              |
| (email list,   | (email content)      | (extracted data +         |
|  narrow)       |                      |  actions)                 |
|                |                      |                           |
| [*] ООО РомТ  | От: info@romtorg.ru  | --- Клиент ---            |
|     SKF 623.. | Кому: sales@co.ru    | ООО "РомТорг"             |
|               | 2026-03-11 10:34     | ИНН: 7701234567  [v]      |
| [ ] Иванов   |                      | КПП: 770101001  [v]       |
|     NTN      | Тема: Запрос цен на  | Регион: Москва             |
|               | подшипники SKF       | Статус CRM: Найден [OK]   |
| [ ] tender@  |                      |                           |
|     Тендер   | Добрый день!         | --- Контакт ---            |
|               |                      | Петрова Анна               |
|               | Прошу предоставить   | anna@romtorg.ru            |
|               | цены на следующую    | +7 (495) 123-45-67        |
|               | номенклатуру:        | Менеджер по закупкам      |
|               |                      |                           |
|               | 1. SKF 6230 - 100шт | --- Номенклатура ---       |
|               | 2. SKF 22220E - 50шт| [v] SKF 6230    100 шт    |
|               | 3. SKF 7310 - 200шт | [v] SKF 22220E   50 шт   |
|               |                      | [v] SKF 7310    200 шт    |
|               | Срок: до 20.03.2026  |                           |
|               |                      | --- Классификация ---      |
|               | С уважением,        | Категория: mono_brand      |
|               | Петрова Анна         | Confidence: 0.94           |
|               | ООО "РомТорг"       | Метод: hybrid              |
|               | ИНН 7701234567      | Бренды: [SKF]              |
|               |                      | Срочность: normal          |
|               | --- Вложения ---    |                           |
|               | [PDF] spec_6230.pdf | --- Действия ---           |
|               | [XLS] price_req.xlsx| [Подтвердить и синхр.]     |
|               |                      | [Исправить данные]        |
|               |                      | [Отклонить]               |
|               |                      | [Переназначить МОП v]     |
|               |                      | [Запросить уточнение]     |
|               |                      |                           |
|               |                      | МОП: Сидоров А.В.         |
|               |                      | МОЗ: Козлова М.И.         |
+---------------+----------------------+---------------------------+
```

### 10.4 Manual Review Screen

```
+------------------------------------------------------------------+
|  Очередь проверки (23 письма)           [Все] [Мои] [Срочные]    |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | #1  ООО "ТехноСервис"  --  confidence: 0.72  --  3 мин назад | |
|  | Причина: Новый клиент, ИНН не найден в CRM                   | |
|  |                                                                | |
|  | Система предложила:              Ваше решение:                 | |
|  | Категория: [new_client_request]  [new_client_request v]        | |
|  | Компания:  [ООО ТехноСервис   ]  [ООО "ТехноСервис"  ]        | |
|  | ИНН:      [770987654_        ]  [7709876543          ]        | |
|  | Контакт:  [Смирнов           ]  [Смирнов Олег Петрович]       | |
|  | Бренды:   [SKF, Timken       ]  [SKF, Timken         ]        | |
|  |                                                                | |
|  | CRM Match: [Не найден]  -->  [ ] Создать нового клиента        | |
|  |                              [ ] Привязать к: [Поиск клиента] | |
|  |                                                                | |
|  | [Подтвердить] [Исправить и подтвердить] [Отклонить] [Пропуст.]| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | #2  ООО "БалтБрейн"  --  confidence: 0.68  --  12 мин назад  | |
|  | Причина: Несколько кандидатов CRM-матчинга                    | |
|  | ...                                                            | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 10.5 Template Learning Screen

```
+------------------------------------------------------------------+
|  Правила классификации                          [+ Новое правило] |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | Правило: "Спам от ozon.ru"          Активно [x]  Hits: 342   | |
|  | Тип: spam                           Приоритет: 10             | |
|  | Условия:                                                       | |
|  |   sender_pattern: /@ozon\.ru$/                                | |
|  |   subject_pattern: /(заказ|отправлен|доставк)/i               | |
|  | Действия:                                                      | |
|  |   category: spam, auto_archive: true                          | |
|  | Создал: Оператор Иванова  |  Утвердил: Админ Петров          | |
|  | [Редактировать] [Отключить] [История версий] [Удалить]        | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | Правило: "Тендеры Газпром"          Активно [x]  Hits: 56    | |
|  | Тип: classification                 Приоритет: 50             | |
|  | Условия:                                                       | |
|  |   sender_pattern: /@gazprom/                                  | |
|  |   subject_pattern: /тендер|конкурс|закупк/i                   | |
|  | Действия:                                                      | |
|  |   category: existing_client, subcategory: tender              | |
|  |   urgency: high, assigned_mop_id: user_tender_spec            | |
|  | [Редактировать] [Отключить] [История версий] [Удалить]        | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  Предложенные правила (на основе corrections операторов):         |
|  +--------------------------------------------------------------+ |
|  | [!] 5 писем от *@bearing-world.de классифицированы вручную    | |
|  |     как vendor_offer. Создать правило?                        | |
|  |     [Создать правило] [Игнорировать]                          | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 10.6 Analytics Screen

```
+------------------------------------------------------------------+
|  Аналитика          Период: [Последние 7 дней v]  [Экспорт CSV]  |
+------------------------------------------------------------------+
|                                                                    |
|  Общая статистика                                                 |
|  +-------------------+-------------------+---------------------+  |
|  | Обработано: 3,412 | Авто-обработка:   | Среднее время       |  |
|  | Ошибок: 18 (0.5%) | 2,589 (75.8%)     | обработки: 42 сек   |  |
|  +-------------------+-------------------+---------------------+  |
|                                                                    |
|  По категориям               По ящикам                            |
|  +----------------------+    +-------------------------------+    |
|  | existing_client  48% |    | info@company.ru        812   |    |
|  | new_client       18% |    | sales@company.ru       645   |    |
|  | spam             22% |    | tender@company.ru      423   |    |
|  | vendor_offer      7% |    | moscow@company.ru      312   |    |
|  | other             5% |    | ...                          |    |
|  +----------------------+    +-------------------------------+    |
|                                                                    |
|  Тренд обработки (график)                                        |
|  +----------------------------------------------------------+    |
|  | 600|                                                      |    |
|  | 500|        *    *                                        |    |
|  | 400|  *   *   *    *   *                                  |    |
|  | 300|    *              *    *                              |    |
|  | 200|                                                      |    |
|  | 100|                                                      |    |
|  |   0+--+--+--+--+--+--+--+                                |    |
|  |    Mon Tue Wed Thu Fri Sat Sun                            |    |
|  +----------------------------------------------------------+    |
|                                                                    |
|  Производительность МОП                                           |
|  +------+------------------+----------+-----------+---------+     |
|  | Ранг | МОП              | Заявок   | Ср.время  | Конверт.|     |
|  +------+------------------+----------+-----------+---------+     |
|  | 1    | Сидоров А.В.     | 89       | 1.2 часа  | 34%     |     |
|  | 2    | Козлова М.И.     | 76       | 1.8 часа  | 28%     |     |
|  | 3    | Петров И.С.      | 71       | 2.1 часа  | 31%     |     |
|  +------+------------------+----------+-----------+---------+     |
+------------------------------------------------------------------+
```

### 10.7 Settings Screen

```
+------------------------------------------------------------------+
|  Настройки                                                        |
+------------------------------------------------------------------+
|  [Почтовые ящики] [Пользователи] [Бренды] [Назначения] [Система]|
+------------------------------------------------------------------+
|                                                                    |
|  Почтовые ящики (28)                        [+ Добавить ящик]    |
|  +--------------------------------------------------------------+ |
|  | Email              | Тип       | Статус    | Посл.синхр.     | |
|  +--------------------+-----------+-----------+-----------------+ |
|  | info@company.ru    | shared    | [Active]  | 2 мин назад     | |
|  | sales@company.ru   | shared    | [Active]  | 1 мин назад     | |
|  | tender@company.ru  | tender    | [Active]  | 3 мин назад     | |
|  | sidorov@company.ru | personal  | [Active]  | 5 мин назад     | |
|  | test@company.ru    | shared    | [Paused]  | 2 дня назад     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  Глобальные настройки:                                            |
|  Интервал опроса: [60] сек                                       |
|  Порог авто-обработки: [0.85]                                    |
|  Порог обязательной проверки: [0.70]                              |
|  Макс. размер вложения: [25] МБ                                  |
|  Хранение raw email: [90] дней                                   |
|  LLM провайдер: [OpenAI v]                                       |
|  DADATA токен: [********] [Тест]                                 |
+------------------------------------------------------------------+
```

---

## 11. Template Learning System

### How Operators Train the System

The learning system creates a feedback loop where operator corrections automatically improve classification and extraction accuracy over time.

#### Learning Flow

```
Operator corrects classification/extraction
         |
         v
learning_feedback record created
    (old_value, new_value, field_name)
         |
         v
Batch job: learning.process (runs every hour)
         |
         +---> Aggregate corrections by pattern
         |     GROUP BY from_domain, category_correction
         |     HAVING count >= 3
         |
         +---> Generate rule proposal
         |     INSERT INTO template_rules (is_active=false, created_by='system')
         |
         +---> Notify admin/operator
         |     "5 emails from @bearing-world.de were manually classified as
         |      vendor_offer. Proposed rule created. [Approve] [Reject]"
         |
         v
Admin approves --> rule becomes active
         |
         v
Rule versioned in template_versions
```

#### Correction Types

| Type | Example | Learning Action |
|------|---------|-----------------|
| classification_correction | spam -> vendor_offer | Generate sender_pattern rule |
| entity_correction | INN "770123456" -> "7701234567" | Improve regex, add to corpus |
| match_correction | "No match" -> client_id=xyz | Add email domain to client |
| brand_correction | "SKF" missed -> add "SKF" | Add alias to brand_dictionary |
| assignment_correction | МОП A -> МОП B | Adjust assignment_rules priority |

#### Confidence Recalibration

Every 24 hours, a background job recalculates confidence thresholds:

```sql
-- What % of auto-processed emails (confidence >= 0.85) were later corrected?
SELECT
    date_trunc('day', e.created_at) as day,
    COUNT(*) FILTER (WHERE lf.id IS NOT NULL) as corrected,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE lf.id IS NOT NULL)::float / COUNT(*) as correction_rate
FROM emails e
LEFT JOIN learning_feedback lf ON lf.email_id = e.id
WHERE e.confidence_score >= 0.85
GROUP BY 1
ORDER BY 1 DESC;

-- If correction_rate > 5%, raise threshold by 0.02
-- If correction_rate < 1%, lower threshold by 0.01 (min 0.80)
```

---

## 12. Security

### RBAC (Role-Based Access Control)

| Role | display_name | Key Permissions |
|------|-------------|-----------------|
| `admin` | Администратор | Full access: users.manage, rules.manage, settings.write, audit.read |
| `operator` | Оператор | emails.read, emails.review, emails.classify, clients.read, rules.suggest |
| `mop` | МОП (менеджер продаж) | emails.read (assigned only), clients.read, requests.read, requests.update |
| `sales_head` | Руководитель продаж | emails.read (all), clients.read, requests.read, analytics.read, emails.reassign |
| `analyst` | Аналитик | analytics.read, emails.read (metadata only), reports.export |
| `integrator` | Интегратор | api.full_access, webhooks.manage, settings.read |

### Permission Matrix

```
Resource          | admin | operator | mop | sales_head | analyst | integrator
------------------+-------+----------+-----+------------+---------+-----------
emails.read       |  ALL  |   ALL    | OWN |    ALL     |  META   |    ALL
emails.review     |   Y   |    Y     |  N  |     N      |    N    |     N
emails.reassign   |   Y   |    N     |  N  |     Y      |    N    |     N
clients.read      |   Y   |    Y     |  Y  |     Y      |    N    |     Y
clients.write     |   Y   |    Y     |  N  |     N      |    N    |     Y
requests.read     |   Y   |    Y     |  Y  |     Y      |    Y    |     Y
requests.write    |   Y   |    Y     |  Y  |     N      |    N    |     Y
rules.manage      |   Y   |    N     |  N  |     N      |    N    |     N
rules.suggest     |   Y   |    Y     |  N  |     N      |    N    |     N
settings.write    |   Y   |    N     |  N  |     N      |    N    |     N
analytics.read    |   Y   |    N     |  N  |     Y      |    Y    |     N
users.manage      |   Y   |    N     |  N  |     N      |    N    |     N
audit.read        |   Y   |    N     |  N  |     Y      |    N    |     N
```

### Audit Log

Every state-changing action writes to `audit_logs`:

```json
{
  "user_id": "uuid-of-operator",
  "action": "review.approve",
  "resource_type": "email",
  "resource_id": "uuid-of-email",
  "old_data": {"processing_state": "awaiting_review", "category": "unclassified"},
  "new_data": {"processing_state": "ready_to_sync", "category": "new_client_request"},
  "ip_address": "10.0.0.42",
  "user_agent": "Mozilla/5.0...",
  "created_at": "2026-03-11T10:34:56Z"
}
```

### Encryption

- **At rest:** PostgreSQL TDE (transparent data encryption) on Railway
- **IMAP passwords:** AES-256-GCM encryption with key from `ENCRYPTION_KEY` env var
- **S3:** Server-side encryption (SSE-S3) on Tigris
- **In transit:** TLS 1.3 for all connections (HTTPS, IMAPS, PostgreSQL SSL, Redis TLS)

### HTML Sanitization

All email HTML rendered in the UI passes through DOMPurify:

```javascript
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p','br','b','i','u','strong','em','a','table','tr','td','th',
                       'thead','tbody','ul','ol','li','h1','h2','h3','h4','img','span','div'];
const ALLOWED_ATTR = ['href','src','alt','style','class','colspan','rowspan'];

function sanitizeEmailHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
        ADD_TAGS: [],
        FORBID_TAGS: ['script','iframe','object','embed','form','input'],
        FORBID_ATTR: ['onerror','onload','onclick','onmouseover']
    });
}
```

### Rate Limiting

```
Redis-based sliding window rate limiting:

API endpoints:
  - /api/v1/*: 100 req/min per user
  - /api/v1/auth/login: 5 req/min per IP
  - /api/v1/emails/reprocess: 10 req/min per user
  - /api/v1/webhooks/*: 1000 req/min per API key

LLM calls:
  - OpenAI: 50 req/min (gpt-4o-mini limit management)
  - Claude: 30 req/min
  - DADATA: 20 req/sec (plan limit)
```

### PII Masking

Audit logs and analytics mask PII fields:

```javascript
function maskPII(data) {
    return {
        ...data,
        inn: data.inn ? data.inn.slice(0, 4) + '****' + data.inn.slice(-2) : null,
        phone: data.phone ? '+7 (***) ***-**-' + data.phone.slice(-2) : null,
        email: data.email ? data.email[0] + '***@' + data.email.split('@')[1] : null,
        full_name: data.full_name ? data.full_name.split(' ')[0] + ' *.' : null,
    };
}
```

---

## 13. API Design

### Base URL

```
Production: https://api.pochta.company.ru/api/v1
Internal:   http://api.railway.internal:4000/api/v1
```

### Authentication

All endpoints require `Authorization: Bearer <session_token>` except `/auth/login`.

### Key Endpoints

#### `POST /api/v1/auth/login`

```json
// Request
{
  "email": "operator@company.ru",
  "password": "securepassword"
}

// Response 200
{
  "token": "sess_abc123def456",
  "user": {
    "id": "b2c3d4e5-f6a7-8901-bcde-f01234567890",
    "email": "operator@company.ru",
    "full_name": "Иванова Мария",
    "role": "operator",
    "permissions": ["emails.read", "emails.review", "clients.read"]
  },
  "expires_at": "2026-03-12T10:34:56Z"
}
```

#### `GET /api/v1/emails`

```json
// Request: GET /api/v1/emails?state=awaiting_review&inbox=info@company.ru&page=1&limit=50

// Response 200
{
  "data": [
    {
      "id": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
      "from_address": "info@romtorg.ru",
      "from_name": "Петрова Анна",
      "subject": "Запрос цен на подшипники SKF",
      "date_received": "2026-03-11T10:34:00Z",
      "processing_state": "awaiting_review",
      "confidence_score": 0.7200,
      "has_attachments": true,
      "attachment_count": 2,
      "classification": {
        "category": "new_client_request",
        "subcategory": "mono_brand_request",
        "confidence": 0.9400,
        "brand_tags": ["SKF"]
      },
      "assigned_mop": {
        "id": "uuid",
        "full_name": "Сидоров А.В."
      },
      "inbox_account": {
        "email": "sales@company.ru",
        "display_name": "Отдел продаж"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 23,
    "total_pages": 1
  }
}
```

#### `GET /api/v1/emails/:id`

```json
// Response 200
{
  "id": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "from_address": "info@romtorg.ru",
  "from_name": "Петрова Анна",
  "to_addresses": [{"email": "sales@company.ru", "name": "Отдел продаж"}],
  "cc_addresses": [],
  "subject": "Запрос цен на подшипники SKF",
  "date_received": "2026-03-11T10:34:00Z",
  "processing_state": "awaiting_review",
  "confidence_score": 0.7200,
  "body": {
    "html": "<sanitized HTML>",
    "text_clean": "Добрый день! Прошу предоставить цены...",
    "signature": "С уважением, Петрова Анна, ООО РомТорг, ИНН 7701234567"
  },
  "attachments": [
    {
      "id": "att-uuid-1",
      "filename": "spec_6230.pdf",
      "content_type": "application/pdf",
      "size_bytes": 245000,
      "download_url": "/api/v1/attachments/att-uuid-1/download",
      "thumbnail_url": "/api/v1/attachments/att-uuid-1/thumbnail",
      "ocr_text": "Спецификация подшипник SKF 6230..."
    }
  ],
  "classification": {
    "category": "new_client_request",
    "confidence": 0.9400,
    "method": "hybrid",
    "brand_tags": ["SKF"],
    "urgency": "normal"
  },
  "entities": [
    {"entity_type": "company_name", "raw_value": "ООО РомТорг", "normalized_value": "ромторг", "confidence": 0.95},
    {"entity_type": "inn", "raw_value": "7701234567", "normalized_value": "7701234567", "confidence": 0.99},
    {"entity_type": "contact_name", "raw_value": "Петрова Анна", "confidence": 0.92},
    {"entity_type": "brand", "raw_value": "SKF", "normalized_value": "SKF", "confidence": 0.99},
    {"entity_type": "sku", "raw_value": "6230", "normalized_value": "SKF 6230", "confidence": 0.95},
    {"entity_type": "sku", "raw_value": "22220E", "normalized_value": "SKF 22220E", "confidence": 0.95},
    {"entity_type": "sku", "raw_value": "7310", "normalized_value": "SKF 7310", "confidence": 0.95},
    {"entity_type": "quantity", "raw_value": "100шт", "normalized_value": "100", "confidence": 0.90},
    {"entity_type": "deadline", "raw_value": "до 20.03.2026", "normalized_value": "2026-03-20", "confidence": 0.88}
  ],
  "crm_match": {
    "match_method": "inn",
    "match_confidence": 0.0,
    "is_new_client": true,
    "client": null,
    "candidates": []
  },
  "thread": {
    "id": "thread-uuid",
    "message_count": 1,
    "subject_normalized": "запрос цен на подшипники skf"
  }
}
```

#### `POST /api/v1/emails/:id/review`

```json
// Request
{
  "decision": "corrected",
  "corrected_data": {
    "classification": {
      "category": "new_client_request",
      "subcategory": "mono_brand_request"
    },
    "entities": {
      "company_name": "ООО \"РомТорг\"",
      "inn": "7701234567"
    },
    "crm_action": "create_new_client",
    "assigned_mop_id": "uuid-of-mop"
  },
  "notes": "Новый клиент, проверила ИНН в ДАДАТА"
}

// Response 200
{
  "email_id": "e3f2a1b4-...",
  "new_state": "ready_to_sync",
  "review_id": "review-uuid",
  "learning_feedback_ids": ["fb-uuid-1", "fb-uuid-2"]
}
```

#### `PATCH /api/v1/emails/:id/assign`

```json
// Request
{
  "assigned_mop_id": "uuid-of-new-mop",
  "reason": "Передача клиента по региону"
}

// Response 200
{
  "email_id": "e3f2a1b4-...",
  "assigned_mop": {"id": "uuid-of-new-mop", "full_name": "Козлова М.И."},
  "audit_log_id": "audit-uuid"
}
```

#### `GET /api/v1/analytics/dashboard`

```json
// Request: GET /api/v1/analytics/dashboard?period=7d

// Response 200
{
  "period": {"from": "2026-03-04", "to": "2026-03-11"},
  "totals": {
    "emails_received": 3412,
    "emails_processed": 3394,
    "emails_failed": 18,
    "auto_processed": 2589,
    "auto_rate": 0.758,
    "avg_processing_time_ms": 42000,
    "new_clients_created": 67,
    "requests_created": 412
  },
  "by_category": {
    "existing_client": 1637,
    "new_client_request": 614,
    "spam": 750,
    "vendor_offer": 239,
    "system_notification": 102,
    "other": 70
  },
  "by_inbox": [
    {"email": "info@company.ru", "count": 812},
    {"email": "sales@company.ru", "count": 645}
  ],
  "by_brand": [
    {"brand": "SKF", "count": 234},
    {"brand": "Timken", "count": 156}
  ],
  "daily_trend": [
    {"date": "2026-03-04", "received": 478, "auto_processed": 362},
    {"date": "2026-03-05", "received": 512, "auto_processed": 401}
  ]
}
```

#### `GET /api/v1/inbox-accounts`

```json
// Response 200
{
  "data": [
    {
      "id": "inbox-uuid-1",
      "email": "info@company.ru",
      "display_name": "Общий info",
      "mailbox_type": "shared_sales",
      "is_active": true,
      "sync_state": {
        "last_sync_at": "2026-03-11T10:32:00Z",
        "sync_status": "idle",
        "total_messages": 15420
      },
      "stats_today": {
        "received": 42,
        "processed": 39,
        "pending": 3
      }
    }
  ]
}
```

#### `POST /api/v1/emails/:id/reprocess`

```json
// Request
{
  "from_step": "classify"  // restart pipeline from this step
}

// Response 202
{
  "email_id": "e3f2a1b4-...",
  "job_id": "bullmq-job-id-789",
  "message": "Reprocessing started from classify step"
}
```

---

## 14. Queue/Workers Design

### Queue Architecture

```
Redis (BullMQ)
|
|-- email.fetch          Fetches new emails from IMAP
|   |-- concurrency: 3 (limited by IMAP connections)
|   |-- repeat: every 60s per inbox
|   +-- timeout: 30s
|
|-- email.parse          Parses raw email, stores body + attachments
|   |-- concurrency: 10
|   |-- timeout: 60s
|   +-- depends on: email.fetch
|
|-- email.classify       Runs classification (rules + LLM)
|   |-- concurrency: 5
|   |-- timeout: 30s
|   +-- depends on: email.parse
|
|-- email.extract        Extracts entities from body + attachments
|   |-- concurrency: 5
|   |-- timeout: 45s
|   +-- depends on: email.classify
|
|-- email.crm-match      Runs CRM matching cascade
|   |-- concurrency: 5
|   |-- timeout: 30s (DADATA calls)
|   +-- depends on: email.extract
|
|-- email.sync           Writes to CRM API
|   |-- concurrency: 3
|   |-- timeout: 30s
|   +-- depends on: email.crm-match (or manual review)
|
|-- attachment.process   OCR + structured data extraction from attachments
|   |-- concurrency: 2 (memory-intensive: Tesseract.js)
|   |-- timeout: 120s
|   +-- triggered by: email.parse (for each attachment)
|
+-- DLQ (dead letter queue)
    |-- email.fetch.dlq
    |-- email.parse.dlq
    |-- email.classify.dlq
    |-- email.extract.dlq
    |-- email.crm-match.dlq
    |-- email.sync.dlq
    +-- attachment.process.dlq
```

### Worker Implementation Pattern

```javascript
// workers/email-classify.worker.js
import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';

const worker = new Worker('email.classify', async (job) => {
    const { emailId } = job.data;

    // Idempotency check
    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (email.processing_state !== 'parsed') {
        job.log(`Skipping: email ${emailId} is in state ${email.processing_state}, expected 'parsed'`);
        return { skipped: true, reason: 'wrong_state' };
    }

    // Process
    const body = await prisma.emailBody.findUnique({ where: { emailId } });
    const classification = await classifyEmail(email, body);

    // Write results in transaction
    await prisma.$transaction([
        prisma.emailClassification.create({ data: { emailId, ...classification } }),
        prisma.email.update({ where: { id: emailId }, data: { processing_state: 'classified' } }),
        prisma.processingJob.update({
            where: { bullmqJobId: job.id },
            data: { status: 'completed', completedAt: new Date(), durationMs: Date.now() - job.timestamp }
        })
    ]);

    // Enqueue next step
    await classifyQueue.add('email.extract', { emailId }, {
        jobId: `extract-${emailId}`,  // idempotent job ID
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }
    });

    return { emailId, category: classification.category, confidence: classification.confidence };
}, {
    connection: redis,
    concurrency: 5,
    limiter: { max: 50, duration: 60000 },  // rate limit LLM calls
});
```

### Retry Policy

| Queue | Max Attempts | Backoff Type | Initial Delay | Max Delay |
|-------|-------------|-------------|---------------|-----------|
| email.fetch | 5 | exponential | 10s | 5min |
| email.parse | 3 | exponential | 5s | 1min |
| email.classify | 3 | exponential | 5s | 2min |
| email.extract | 3 | exponential | 5s | 2min |
| email.crm-match | 4 | exponential | 10s | 5min |
| email.sync | 5 | exponential | 15s | 10min |
| attachment.process | 2 | fixed | 30s | 30s |

### DLQ Strategy

After exhausting all retry attempts, jobs move to the corresponding DLQ:

1. Email `processing_state` set to `failed` with error message
2. `processing_jobs.status` set to `failed`
3. Alert sent to `#pochta-alerts` Slack channel (via webhook)
4. DLQ jobs reviewed daily by operator
5. Manual retry available via `POST /api/v1/emails/:id/reprocess`

### Idempotency

Every job uses a deterministic `jobId` to prevent duplicate processing:

```javascript
await queue.add('email.parse', { emailId }, {
    jobId: `parse-${emailId}`,  // same emailId = same jobId = no duplicate
});
```

State checks at the start of each worker ensure correct ordering:

```javascript
// Only process if email is in the expected state
if (email.processing_state !== expectedState) {
    return { skipped: true };
}
```

---

## 15. Rollout Plan

### Phase 1: Shadow Mode (Weeks 1-4)

**Goal:** Validate accuracy without affecting production CRM.

| Item | Detail |
|------|--------|
| Mailboxes | All 28 (read-only IMAP, no SMTP) |
| Processing | Full pipeline: fetch -> parse -> classify -> extract -> match |
| CRM writes | **DISABLED** — no creates, no updates |
| Review UI | Active — operators see results, provide corrections |
| Learning | Active — corrections feed template_rules |
| Metrics target | Classification accuracy > 85%, Entity extraction > 80% |
| Exit criteria | 2 consecutive weeks with accuracy > 85% |

### Phase 2: Limited Inbox Rollout (Weeks 5-8)

**Goal:** Validate CRM sync on low-volume mailboxes.

| Item | Detail |
|------|--------|
| Mailboxes | 3 selected: info@, one regional, one personal МОП |
| Processing | Full pipeline with CRM sync |
| CRM writes | **ENABLED** with mandatory operator review (confidence threshold = 1.0) |
| Review UI | All items require review before sync |
| Metrics target | CRM sync success rate > 95%, zero duplicate clients |
| Exit criteria | 500 emails synced without critical errors |

### Phase 3: Partial Automation (Weeks 9-14)

**Goal:** Enable auto-sync for high-confidence items.

| Item | Detail |
|------|--------|
| Mailboxes | 12 highest-volume mailboxes |
| Processing | Full pipeline |
| CRM writes | **AUTO** for confidence >= 0.90, **REVIEW** for < 0.90 |
| Auto-sync rate target | > 60% |
| Spot-check | Sales head reviews 10% random sample daily |
| Metrics target | Auto-sync accuracy > 97%, < 2% correction rate |
| Exit criteria | 4 weeks with correction rate < 3% |

### Phase 4: Full Automation (Week 15+)

**Goal:** All 28 mailboxes, maximum automation.

| Item | Detail |
|------|--------|
| Mailboxes | All 28 |
| CRM writes | **AUTO** for confidence >= 0.85, **REVIEW** for < 0.85 |
| Auto-sync rate target | > 70% |
| Monitoring | Real-time dashboard, daily accuracy report |
| Ongoing | Weekly rule review, monthly confidence recalibration |

---

## 16. Risks and Mitigations

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|-------------|------------|
| 1 | LLM API downtime (OpenAI/Claude) | Classification stops | Medium | Fallback to rule-only classification; cache recent LLM results; queue with long retry |
| 2 | IMAP connection limits (28 simultaneous) | Missed emails | Medium | Connection pooling via imapflow; staggered polling schedules; IDLE for high-priority boxes only |
| 3 | Duplicate client creation in CRM | Data quality degradation | High | INN dedup check before create; fuzzy name matching; 24h cooldown on new client auto-create |
| 4 | OCR processing overloads worker memory | Worker crashes | Medium | Memory limit per Tesseract.js instance (512MB); sharp resize images before OCR; skip files > 10MB |
| 5 | Russian text encoding issues (win-1251, KOI8-R) | Garbled text, missed entities | Medium | mailparser handles encoding detection; fallback iconv-lite; store raw .eml for reprocessing |
| 6 | DADATA rate limiting / quota exhaustion | Enrichment stops | Low | Redis cache with 30d TTL; batch INN lookups; fallback to manual entry |
| 7 | Email thread detection failure | Duplicate requests for same inquiry | Medium | In-Reply-To + References header matching; Subject normalization; sender+recipient pair grouping |
| 8 | PII leak in logs/analytics | Compliance violation | Low | PII masking in all logs; audit_logs encrypted; RBAC on analytics endpoints |
| 9 | Railway platform outage | Full system downtime | Low | Health checks with auto-restart; Redis AOF persistence; PostgreSQL daily backups; documented manual recovery |
| 10 | Template rules conflict (contradicting rules) | Unpredictable classification | Medium | Rule priority system; conflict detection on save; dry-run mode for new rules |
| 11 | CRM API rate limiting | Sync queue backs up | Medium | Exponential backoff; batch sync operations; off-peak scheduling |
| 12 | Malicious email attachments | Security breach | Low | No server-side execution; sandboxed OCR; file type allowlist; ClamAV scan for downloads |

---

## 17. Observability

### Logging

```
Structured JSON logs via pino (Fastify default logger):

{
  "level": "info",
  "time": 1741686896000,
  "service": "worker",
  "worker": "email.classify",
  "emailId": "e3f2a1b4-...",
  "jobId": "classify-e3f2a1b4",
  "msg": "Classification completed",
  "category": "new_client_request",
  "confidence": 0.94,
  "method": "hybrid",
  "duration_ms": 1234
}

Log levels:
  - fatal: System cannot continue (DB connection lost)
  - error: Operation failed (LLM API error, parse failure)
  - warn:  Degraded operation (fallback to rules-only, retry)
  - info:  Normal operations (email processed, job completed)
  - debug: Detailed trace (LLM prompt/response, SQL queries)

Log destinations:
  - stdout (Railway captures automatically)
  - Railway Log Explorer (search, filter)
  - Optional: Datadog/Grafana Cloud integration via log drain
```

### Metrics

```
Custom metrics (exposed via GET /api/v1/metrics in Prometheus format):

# Pipeline throughput
pochta_emails_received_total{inbox="info@company.ru"}
pochta_emails_processed_total{category="new_client_request"}
pochta_emails_failed_total{step="classify",error="llm_timeout"}

# Processing latency
pochta_pipeline_duration_seconds{step="parse"}    histogram
pochta_pipeline_duration_seconds{step="classify"}  histogram
pochta_pipeline_duration_seconds{step="extract"}   histogram
pochta_pipeline_duration_seconds{step="crm_match"} histogram

# Queue health
pochta_queue_depth{queue="email.classify"}
pochta_queue_active{queue="email.classify"}
pochta_queue_failed{queue="email.classify"}
pochta_queue_dlq_depth{queue="email.classify.dlq"}

# LLM usage
pochta_llm_requests_total{model="gpt-4o-mini",status="success"}
pochta_llm_tokens_total{model="gpt-4o-mini",type="prompt"}
pochta_llm_cost_usd{model="gpt-4o-mini"}

# CRM sync
pochta_crm_sync_total{status="success"}
pochta_crm_sync_total{status="failed"}
pochta_crm_clients_created_total
pochta_crm_requests_created_total

# Accuracy
pochta_auto_process_rate     gauge
pochta_correction_rate       gauge
pochta_classification_accuracy gauge
```

### Alerts

| Alert | Condition | Severity | Channel |
|-------|-----------|----------|---------|
| Pipeline Stalled | No emails processed in 15 min (during business hours) | Critical | Slack #pochta-alerts |
| High Error Rate | > 5% emails failed in last hour | High | Slack #pochta-alerts |
| DLQ Growing | Any DLQ depth > 10 | High | Slack #pochta-alerts |
| IMAP Connection Failed | Any inbox sync_status='error' for > 5 min | Medium | Slack #pochta-ops |
| LLM Quota Warning | Daily LLM cost > $10 | Medium | Slack #pochta-ops |
| Low Accuracy | Auto-process correction rate > 5% (24h window) | Medium | Slack #pochta-ops, email to admin |
| Database Space | PostgreSQL storage > 80% | Medium | Slack #pochta-ops |
| Worker OOM | Worker restart count > 3 in 1 hour | High | Slack #pochta-alerts |

---

## 18. Testing Strategy

### Unit Tests

```
Location: tests/unit/

Coverage targets: > 80% for business logic

Key test files:
  tests/unit/classification/rule-engine.test.js
    - Tests each rule type against sample emails
    - Tests rule priority ordering
    - Tests conflict detection

  tests/unit/extraction/entity-extractor.test.js
    - INN regex: valid 10-digit, 12-digit, with/without spaces
    - Company name normalization: ООО/ЗАО/ИП stripping
    - Phone normalization: +7, 8, (495), various formats
    - Brand matching against brand_dictionary

  tests/unit/matching/crm-matcher.test.js
    - Each cascade step independently
    - Fuzzy name matching with pg_trgm similarity
    - Domain extraction and matching

  tests/unit/parsing/email-parser.test.js
    - Signature detection and stripping
    - Quote detection (>, "On ... wrote:")
    - Encoding handling (UTF-8, windows-1251, KOI8-R)
    - Thread detection (In-Reply-To, References, Subject)

  tests/unit/assignment/assignment-engine.test.js
    - Brand-based assignment
    - Round-robin distribution
    - Fallback logic
    - Inactive user handling

Framework: node:test + node:assert (following existing project conventions)
Run: node --test tests/unit/**/*.test.js
```

### Integration Tests

```
Location: tests/integration/

Setup: Docker Compose with PostgreSQL + Redis test instances

Key test files:
  tests/integration/pipeline.test.js
    - Full pipeline: raw email -> synced state
    - Validates all state transitions
    - Checks database records at each step

  tests/integration/imap-fetch.test.js
    - Uses GreenMail or test IMAP server
    - Tests fetch, dedup, UID tracking

  tests/integration/bullmq-workers.test.js
    - Tests job creation, processing, retry, DLQ
    - Tests idempotency (duplicate job submission)
    - Tests concurrency limits

  tests/integration/api-endpoints.test.js
    - RBAC enforcement (each role)
    - Pagination, filtering, sorting
    - Review workflow (approve, correct, reject)

Run: docker compose -f docker-compose.test.yml up -d && node --test tests/integration/**/*.test.js
```

### E2E Tests

```
Location: tests/e2e/

Tool: Playwright

Key test files:
  tests/e2e/login.spec.js
    - Login flow for each role
    - Session persistence
    - Unauthorized access redirect

  tests/e2e/inbox.spec.js
    - Email list loading and filtering
    - Email detail card rendering
    - Attachment download

  tests/e2e/review.spec.js
    - Operator review workflow
    - Correction form submission
    - State change verification

  tests/e2e/analytics.spec.js
    - Dashboard data loading
    - Chart rendering
    - CSV export

Run: npx playwright test
```

### Test Data

```
Location: tests/fixtures/

  emails/
    simple-text.eml              - Plain text email, single brand
    html-rich.eml                - HTML email with tables, images
    multi-attachment.eml         - 3 attachments (PDF, XLS, image)
    windows-1251.eml             - Windows-1251 encoded Russian text
    thread-reply.eml             - Reply in thread (In-Reply-To)
    spam-typical.eml             - Typical spam email
    vendor-offer.eml             - Vendor price list
    multi-brand.eml              - Request with 5 brands
    scanned-pdf-attachment.eml   - Scanned PDF requiring OCR
    empty-body.eml               - Attachment-only email

  companies/
    dadata-response-7707083893.json  - Sample DADATA response
    crm-clients-sample.json          - 100 sample CRM clients for matching tests
```

---

## 19. Example Scenario

### Tracing One Email: Arrival to CRM Entity Creation

**Scenario:** New client "OOO РомТорг" sends a price inquiry for SKF bearings to sales@company.ru.

#### Step 1: Ingestion (email.fetch worker)

```
IMAP FETCH from sales@company.ru
UID: 15420, UIDVALIDITY: 1234567890
```

Worker creates email record:

```json
{
  "id": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "inbox_account_id": "inbox-sales-uuid",
  "message_id": "<CABx+XJ2abc@mail.gmail.com>",
  "from_address": "info@romtorg.ru",
  "from_name": "Петрова Анна",
  "to_addresses": [{"email": "sales@company.ru", "name": ""}],
  "subject": "Запрос цен на подшипники SKF",
  "date_received": "2026-03-11T10:34:00Z",
  "has_attachments": true,
  "attachment_count": 2,
  "imap_uid": 15420,
  "raw_s3_key": "raw-emails/2026/03/11/e3f2a1b4.eml",
  "processing_state": "received"
}
```

Enqueues: `email.parse` job with `jobId: "parse-e3f2a1b4"`

#### Step 2: Parsing (email.parse worker)

Reads raw .eml from S3, parses with mailparser:

```json
// email_bodies record
{
  "email_id": "e3f2a1b4-...",
  "body_html": "<html>...<p>Добрый день!</p><p>Прошу предоставить цены на следующую номенклатуру:</p><ol><li>SKF 6230 - 100шт</li><li>SKF 22220E - 50шт</li><li>SKF 7310 - 200шт</li></ol><p>Срок поставки: до 20.03.2026</p>...",
  "body_text_clean": "Добрый день!\n\nПрошу предоставить цены на следующую номенклатуру:\n1. SKF 6230 - 100шт\n2. SKF 22220E - 50шт\n3. SKF 7310 - 200шт\n\nСрок поставки: до 20.03.2026",
  "signature_text": "С уважением,\nПетрова Анна\nМенеджер по закупкам\nООО \"РомТорг\"\nИНН 7701234567\nТел: +7 (495) 123-45-67",
  "body_language": "ru"
}
```

Attachments saved to S3:

```json
[
  {
    "filename": "spec_6230.pdf",
    "content_type": "application/pdf",
    "size_bytes": 245000,
    "s3_key": "attachments/2026/03/11/e3f2a1b4/spec_6230.pdf",
    "checksum_sha256": "a1b2c3d4..."
  },
  {
    "filename": "price_request.xlsx",
    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "size_bytes": 18200,
    "s3_key": "attachments/2026/03/11/e3f2a1b4/price_request.xlsx",
    "checksum_sha256": "e5f6a7b8..."
  }
]
```

State: `received` -> `parsed`

Enqueues: `email.classify` + `attachment.process` (x2)

#### Step 3: Classification (email.classify worker)

**Rule engine pass:**
- No spam pattern match
- No system_notification match
- No clarification_reply match
- Sender @romtorg.ru not in vendor list
- Subject contains "запрос цен" -> suggests `new_client_request` (confidence: 0.80)

**LLM pass (gpt-4o-mini):**

```json
// LLM structured output
{
  "category": "new_client_request",
  "subcategory": "mono_brand_request",
  "confidence": 0.96,
  "brand_tags": ["SKF"],
  "urgency": "normal",
  "reasoning": "Price inquiry from unknown sender for SKF bearings with specific part numbers and quantities"
}
```

**Hybrid merge:** Rule (0.80) + LLM (0.96) agree -> confidence = 0.96

```json
// email_classification record
{
  "email_id": "e3f2a1b4-...",
  "category": "new_client_request",
  "subcategory": "mono_brand_request",
  "confidence": 0.9600,
  "method": "hybrid",
  "brand_tags": ["SKF"],
  "urgency": "normal",
  "is_spam": false,
  "llm_model": "gpt-4o-mini",
  "llm_prompt_tokens": 847,
  "llm_completion_tokens": 62
}
```

State: `parsed` -> `classified`

#### Step 4: Entity Extraction (email.extract worker)

Combines regex extraction + LLM extraction (Claude claude-sonnet-4-20250514):

```json
// extracted_entities records
[
  {
    "entity_type": "company_name",
    "raw_value": "ООО \"РомТорг\"",
    "normalized_value": "ромторг",
    "confidence": 0.9500,
    "source": "signature",
    "extraction_method": "regex"
  },
  {
    "entity_type": "inn",
    "raw_value": "7701234567",
    "normalized_value": "7701234567",
    "confidence": 0.9900,
    "source": "signature",
    "extraction_method": "regex"
  },
  {
    "entity_type": "contact_name",
    "raw_value": "Петрова Анна",
    "normalized_value": "Петрова Анна",
    "confidence": 0.9200,
    "source": "signature",
    "extraction_method": "llm"
  },
  {
    "entity_type": "phone",
    "raw_value": "+7 (495) 123-45-67",
    "normalized_value": "+74951234567",
    "confidence": 0.9500,
    "source": "signature",
    "extraction_method": "regex"
  },
  {
    "entity_type": "brand",
    "raw_value": "SKF",
    "normalized_value": "SKF",
    "confidence": 0.9900,
    "source": "body",
    "extraction_method": "dictionary"
  },
  {
    "entity_type": "sku",
    "raw_value": "SKF 6230",
    "normalized_value": "SKF 6230",
    "confidence": 0.9500,
    "source": "body",
    "extraction_method": "llm"
  },
  {
    "entity_type": "quantity",
    "raw_value": "100шт",
    "normalized_value": "100",
    "confidence": 0.9000,
    "source": "body",
    "extraction_method": "llm"
  },
  {
    "entity_type": "deadline",
    "raw_value": "до 20.03.2026",
    "normalized_value": "2026-03-20",
    "confidence": 0.8800,
    "source": "body",
    "extraction_method": "llm"
  }
]
```

State: `classified` -> `entities_extracted`

#### Step 5: CRM Matching (email.crm-match worker)

Cascade execution:

```
Step 1 (INN): SELECT * FROM clients WHERE inn = '7701234567'
  -> No match

Step 2 (Company name): SELECT * FROM clients
  WHERE company_name_normalized = 'ромторг'
  -> No match
  Fuzzy: SELECT *, similarity(company_name_normalized, 'ромторг') as sim
  FROM clients WHERE similarity(company_name_normalized, 'ромторг') > 0.6
  -> No match

Step 3 (Contact email): SELECT * FROM client_contacts
  WHERE email = 'info@romtorg.ru'
  -> No match

Step 4 (Email domain): SELECT DISTINCT client_id FROM client_contacts
  WHERE email LIKE '%@romtorg.ru'
  -> No match

Step 5 (DADATA): POST /suggestions/api/4_1/rs/findById/party
  {"query": "7701234567"}
  -> Response: {
       "value": "ООО \"РОМТОРГ\"",
       "data": {
         "inn": "7701234567",
         "kpp": "770101001",
         "ogrn": "1027700132195",
         "address": {"value": "г Москва, ул Ленина, д 1"},
         "management": {"name": "Иванов Иван Иванович"}
       }
     }
  Retry Step 2 with enriched name -> Still no match

Step 6 (Manual): No automatic match. Flag as new client.
```

```json
// crm_matches record
{
  "email_id": "e3f2a1b4-...",
  "client_id": null,
  "contact_id": null,
  "match_method": "manual",
  "match_confidence": 0.0000,
  "is_new_client": true,
  "match_details": {
    "cascade_results": [
      {"step": "inn", "result": "no_match", "query": "7701234567"},
      {"step": "company_name", "result": "no_match", "query": "ромторг", "best_similarity": 0.0},
      {"step": "contact_email", "result": "no_match", "query": "info@romtorg.ru"},
      {"step": "email_domain", "result": "no_match", "query": "romtorg.ru"},
      {"step": "dadata", "result": "enriched_no_match", "dadata_name": "ООО РОМТОРГ"}
    ],
    "dadata_cached": true
  }
}
```

Since `is_new_client=true` and overall confidence 0.72 < 0.85:

State: `entities_extracted` -> `crm_matched` -> `awaiting_review`

#### Step 6: Operator Review (Manual via UI)

Operator opens review queue, sees email. System pre-fills all extracted data. Operator verifies:

```json
// POST /api/v1/emails/e3f2a1b4-.../review
{
  "decision": "corrected",
  "corrected_data": {
    "classification": {"category": "new_client_request"},
    "entities": {
      "company_name": "ООО \"РомТорг\"",
      "inn": "7701234567"
    },
    "crm_action": "create_new_client"
  },
  "notes": "Новый клиент, ИНН подтверждён в ДАДАТА. Создать клиента и заявку."
}
```

Creates `operator_reviews` + `learning_feedback` records.

State: `awaiting_review` -> `ready_to_sync`

#### Step 7: CRM Sync (email.sync worker)

Creates client, contact, and request in CRM:

```json
// New client record
{
  "company_name": "ООО \"РомТорг\"",
  "inn": "7701234567",
  "kpp": "770101001",
  "ogrn": "1027700132195",
  "legal_address": "г Москва, ул Ленина, д 1",
  "region": "Москва",
  "source": "email_auto",
  "assigned_mop_id": "uuid-sidorov"  // SKF specialist via assignment_rules
}

// New contact record
{
  "client_id": "new-client-uuid",
  "full_name": "Петрова Анна",
  "email": "info@romtorg.ru",
  "phone": "+74951234567",
  "position": "Менеджер по закупкам",
  "is_primary": true
}

// New request record
{
  "request_number": "REQ-2026-003847",
  "client_id": "new-client-uuid",
  "contact_id": "new-contact-uuid",
  "email_id": "e3f2a1b4-...",
  "request_type": "price_inquiry",
  "status": "new",
  "assigned_mop_id": "uuid-sidorov",
  "brand_tags": ["SKF"],
  "source_inbox": "sales@company.ru",
  "deadline": "2026-03-20T00:00:00Z"
}

// Request items
[
  {"brand": "SKF", "article_number": "6230", "quantity": 100, "unit": "шт"},
  {"brand": "SKF", "article_number": "22220E", "quantity": 50, "unit": "шт"},
  {"brand": "SKF", "article_number": "7310", "quantity": 200, "unit": "шт"}
]
```

State: `ready_to_sync` -> `synced`

**Total pipeline time:** 42 seconds (fetch: 2s, parse: 3s, classify: 8s, extract: 12s, match: 15s, sync: 2s). Operator review took 2 minutes 15 seconds.

---

## 20. Event Payloads

### Internal Events (BullMQ job data)

#### email.fetch job

```json
{
  "inboxAccountId": "inbox-sales-uuid",
  "fetchBatchSize": 50,
  "sinceUid": 15419
}
```

#### email.parse job

```json
{
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "rawS3Key": "raw-emails/2026/03/11/e3f2a1b4.eml",
  "inboxAccountId": "inbox-sales-uuid"
}
```

#### email.classify job

```json
{
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "useLlm": true,
  "llmModel": "gpt-4o-mini"
}
```

#### email.extract job

```json
{
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "extractFromAttachments": true,
  "ocrEnabled": true
}
```

#### email.crm-match job

```json
{
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "cascadeSteps": ["inn", "company_name", "contact_email", "email_domain", "dadata", "manual"],
  "dadataEnabled": true
}
```

#### email.sync job

```json
{
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "syncActions": ["create_client", "create_contact", "create_request"],
  "clientData": {
    "company_name": "ООО \"РомТорг\"",
    "inn": "7701234567",
    "kpp": "770101001"
  },
  "requestData": {
    "request_type": "price_inquiry",
    "brand_tags": ["SKF"],
    "items_count": 3
  }
}
```

#### attachment.process job

```json
{
  "attachmentId": "att-uuid-1",
  "emailId": "e3f2a1b4-c5d6-7890-abcd-ef0123456789",
  "s3Key": "attachments/2026/03/11/e3f2a1b4/spec_6230.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 245000,
  "ocrEnabled": true,
  "generateThumbnail": true
}
```

### Webhook Events (External Consumers)

The system can emit webhooks to external systems. Configure via `POST /api/v1/webhooks`.

#### `email.processed`

```json
{
  "event": "email.processed",
  "timestamp": "2026-03-11T10:34:42Z",
  "data": {
    "email_id": "e3f2a1b4-...",
    "processing_state": "synced",
    "category": "new_client_request",
    "confidence": 0.9600,
    "brand_tags": ["SKF"],
    "is_new_client": true,
    "client_id": "new-client-uuid",
    "request_id": "new-request-uuid",
    "request_number": "REQ-2026-003847",
    "assigned_mop_id": "uuid-sidorov",
    "processing_time_ms": 42000,
    "auto_processed": false,
    "inbox_email": "sales@company.ru"
  }
}
```

#### `email.needs_review`

```json
{
  "event": "email.needs_review",
  "timestamp": "2026-03-11T10:34:40Z",
  "data": {
    "email_id": "e3f2a1b4-...",
    "reason": "new_client",
    "confidence": 0.7200,
    "category": "new_client_request",
    "from_address": "info@romtorg.ru",
    "subject": "Запрос цен на подшипники SKF",
    "review_url": "https://pochta.company.ru/review/e3f2a1b4-..."
  }
}
```

#### `email.failed`

```json
{
  "event": "email.failed",
  "timestamp": "2026-03-11T10:35:00Z",
  "data": {
    "email_id": "e3f2a1b4-...",
    "failed_step": "crm_match",
    "error": "DADATA API timeout after 3 retries",
    "attempts": 3,
    "dlq_job_id": "dlq-crm-match-e3f2a1b4",
    "requires_manual_action": true
  }
}
```

#### `client.created`

```json
{
  "event": "client.created",
  "timestamp": "2026-03-11T10:34:42Z",
  "data": {
    "client_id": "new-client-uuid",
    "company_name": "ООО \"РомТорг\"",
    "inn": "7701234567",
    "source": "email_auto",
    "source_email_id": "e3f2a1b4-...",
    "assigned_mop_id": "uuid-sidorov",
    "created_by": "system"
  }
}
```

#### `daily.report`

```json
{
  "event": "daily.report",
  "timestamp": "2026-03-11T23:59:59Z",
  "data": {
    "date": "2026-03-11",
    "emails_received": 487,
    "emails_auto_processed": 371,
    "emails_reviewed": 98,
    "emails_failed": 3,
    "emails_spam": 89,
    "auto_rate": 0.762,
    "avg_processing_time_ms": 38400,
    "new_clients": 12,
    "new_requests": 67,
    "top_brands": [
      {"brand": "SKF", "count": 34},
      {"brand": "Timken", "count": 22},
      {"brand": "NTN", "count": 18}
    ],
    "correction_rate": 0.024,
    "alerts": [
      "IMAP connection to ural@company.ru failed 3 times between 14:00-14:15"
    ]
  }
}
```

---

*This document is maintained by the Pochta Platform team. For questions, contact the system architect or post in #pochta-dev.*
