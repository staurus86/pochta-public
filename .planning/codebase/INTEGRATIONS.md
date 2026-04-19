# External Integrations

**Analysis Date:** 2026-04-19

## APIs & External Services

**Email Delivery (IMAP):**
- **Purpose:** Fetch inbound emails from mailboxes for parsing and classification
- **Protocol:** IMAP (port 993 TLS)
- **Clients:**
  - Project 2 (Python): `imaplib` → `mail.klvrt.ru` (Tender parser mailbox)
  - Project 3 (Python): `imaplib` → Multiple mailboxes (TSV config from `1.txt`)
  - v2 (Node.js): `imap` npm package (mailparser integration in `apps/api`)
- **Auth:** Email + password (stored in env vars: `PROJECT2_GMAIL_USER`, `PROJECT2_GMAIL_PASSWORD`)
- **Scope:** Read emails, track seen message IDs (state file), extract body + attachments

**Google Workspace (Project 2 — Tender Import):**
- **Service:** Google Sheets + Google Drive
- **SDK:** `gspread` (Python), `google-auth` (OAuth2)
- **Auth:** Service account credentials (JSON key file)
  - Env vars: `PROJECT2_GOOGLE_CREDENTIALS`, `PROJECT2_GOOGLE_CREDENTIALS_B64`, `PROJECT2_GOOGLE_CREDENTIALS_JSON`
  - At runtime: decoded to `/opt/venv/credentials.runtime.json` (base64 for Railway)
- **Purpose:** Import SAP SRM tender data → Google Sheets (`PROJECT2_GOOGLE_SHEETS_ID`)
- **Scope:** Create/append rows in target spreadsheet

**CRM Systems (Incoming Sync):**
- **Supported Types:** amoCRM, Bitrix24, 1С, generic (webhook)
  - Adapters: `src/services/crm-adapters.js` (v1), `apps/api/src/crm/` (v2)
- **Trigger:** Messages in `ready_for_crm` status
- **Payload:** Leads with contact info, company, detected brands, articles
- **Auth:** API key or Bearer token per CRM type
  - Env vars: `CRM_ENABLED`, `CRM_TYPE`, `CRM_BASE_URL`, `CRM_API_KEY`
  - Or per-project config in `data/projects.json`
- **Request Options:**
  - **amoCRM (v4):** `POST /api/v4/leads/complex`, Bearer auth
  - **Bitrix24:** `POST /rest/{apiKey}/crm.lead.add.json`
  - **1С:** `POST /hs/pochta/incoming`, Basic auth
  - **Generic:** `POST {baseUrl}`, X-Api-Key header
- **Timeout:** `CRM_TIMEOUT_MS` (default 15s)
- **State:** sync_status tracked per message (synced/failed/pending)

**LLM API (Optional AI Classification & Extraction):**
- **Providers:** Artemox (OpenAI-compatible), Claude API (future), OpenAI direct
- **Services:**
  - **AI Classification** (second opinion on rules-based detector)
    - Env: `AI_ENABLED`, `AI_API_KEY`, `AI_BASE_URL` (default: `https://api.artemox.com/v1`)
    - Model: `gpt-4.1-mini` (default)
    - Endpoint: Compatible with OpenAI `/chat/completions`
    - Timeout: `AI_TIMEOUT_MS` (default 15s)
  - **LLM Entity Extraction** (fills gaps in regex-based extraction)
    - Env: `LLM_EXTRACT_ENABLED`, `LLM_EXTRACT_API_KEY`, `LLM_EXTRACT_BASE_URL`, `LLM_EXTRACT_MODEL`
    - Model: `gpt-4o-mini` (default)
    - Timeout: `LLM_EXTRACT_TIMEOUT_MS` (default 30s)
    - Logging: Detection hints written to `data/llm-suggestions.jsonl` if enabled
- **Scope:** Email classification (Клиент/СПАМ/Поставщик/Не определено), entity extraction (INN, phone, company, etc.)
- **Threshold:** Only invoke if `confidence < AI_CONFIDENCE_THRESHOLD` (default 0.75)

**Diadoc / Kontur EDO (Mentioned, Not Yet Integrated):**
- **Pattern Detection:** EDO system mentions detected in email body via regex
  - Pattern: `EDO_CONTEXT_PATTERN = /(?:диадок|diadoc|сбис|sbis|контур|kontur|оператор\s+эдо|эдо\s+оператор|электронный\s+документооборот|подключен\s+к)\s{0,20}/i`
  - Location: `src/services/email-analyzer.js` (line ~219)
- **Current State:** Flagged in lead metadata, not yet pushing to EDO API
- **Expected Integration:** Future phase — send invoices/documents to EDO operator

## Data Storage

**Databases (v1 Legacy):**

*SQLite (Detection Knowledge Base):*
- **File:** `data/detection-kb.sqlite`
- **Client:** Node.js `node:sqlite` (`DatabaseSync` — synchronous, no external server)
- **Schema:** 
  - Brands & aliases (15,454+ entries)
  - Sender profiles (email patterns, roles, confidence)
  - Message corpus (parsed email samples)
  - Detection rules (regex patterns, field patterns)
  - API clients (for integration auth)
- **Access:** `src/services/detection-kb.js` (full CRUD via REST `/api/detection-kb/*`)
- **Seeding:** Default rules auto-created on first run

*JSON File Storage:*
- **File:** `data/projects.json`
- **Purpose:** Projects metadata, recent analyses, recent runs, integration messages
- **Client:** `src/storage/projects-store.js` (fs-based, with locking)
- **Format:** JSON object with array of project records

**Databases (v2 New Stack):**

*PostgreSQL:*
- **Version:** 16 (docker-compose service)
- **Client:** Prisma ORM (`packages/db/`)
- **Schema:** 27 models covering:
  - Email messages (fetch/parse/classify/extract/crm-match states)
  - Integration threads (conversation threading)
  - CRM sync tracking (delivery, external IDs)
  - Attachment metadata (filename, content type, S3 path)
  - Job queue state (BullMQ synchronization)
- **Connection:** `DATABASE_URL=postgresql://pochta:pwd@postgres:5432/pochta`
- **Migrations:** Prisma `migrate dev` / `migrate deploy`

*Redis:*
- **Version:** 7 (docker-compose service, or Railway managed)
- **Client:** `ioredis` 5.4.2
- **Purpose:**
  - BullMQ job queue backend (fetch → parse → classify → extract → crm-match → sync workers)
  - Session store (JWT tokens for manager auth)
  - Cache (optional, for KB lookups)
- **Connection:** `REDIS_URL=redis://redis:6379`

**File Storage (Attachments):**

*v1 Legacy:*
- **Location:** `data/` directory (local filesystem)
- **Tracking:** `src/services/attachment-content.js` stores file metadata

*v2 New Stack:*
- **Provider:** MinIO (local) or Tigris (Railway production)
- **S3-Compatible API:**
  - Endpoint: `S3_ENDPOINT` (default: `http://minio:9000`)
  - Bucket: `S3_BUCKET` (default: `pochta-emails`)
  - Region: `S3_REGION` (default: `us-east-1`)
  - Auth: `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- **Content:** Email attachments, attachment previews (via sharp), OCR results (via tesseract.js)
- **Size Limit:** 2 MB per attachment (Python: `MAX_ATTACHMENT_SIZE`)

**Caching:**
- **Redis** (v2 only, optional)
- **LLM Cache:** `src/services/llm-cache.js` — stores extraction results by email hash to avoid re-processing

## Authentication & Identity

**Manager UI Auth (v1):**
- **Type:** Session-based password auth (simple, no OAuth)
- **Client:** `src/services/manager-auth.js`
- **Storage:** SQLite (`data/manager-auth.sqlite`)
- **Endpoint:** `POST /api/auth/login` (optional, if `ADMIN_PASSWORD` env var set)
- **Default Credentials:** login = `admin`, password = value of `ADMIN_PASSWORD`
- **Session:** Returned as cookie/token, validated on subsequent requests

**API Auth (v2):**
- **Type:** JWT (Bearer token)
- **Issuer:** `@fastify/jwt` plugin (`apps/api`)
- **Secret:** `JWT_SECRET` env var
- **Scope:** All endpoints under `/api/v2/*` require valid JWT
- **Issuance:** Login endpoint (not yet fully specified, placeholder for RBAC)

**CRM API Auth:**
- **amoCRM:** Bearer token in `Authorization` header
- **Bitrix24:** API key embedded in URL path (`/rest/{apiKey}/...`)
- **1С:** Basic auth (base64 encoded key in `Authorization` header)
- **Generic:** `X-Api-Key` header

**IMAP Auth:**
- **Type:** Username + password (email address + app-specific password or account password)
- **Stored:** Env vars only (not in database for security)
- **Rotation:** Manual (update env var, redeploy)

## Monitoring & Observability

**Error Tracking:**
- **Implemented:** None (no Sentry, DataDog, etc.)
- **Local Logging:** 
  - v1: Console output + text log files (`project 2/tender_parser.log`, etc.)
  - v2: JSON structured logging via `pino` (`LOG_LEVEL` env var)

**Logs:**
- **v1 Legacy:**
  - Server: stdout (console.log, console.error)
  - Project 2: `project 2/tender_parser.log`
  - Project 3: Python stdout (captured in job output)
- **v2 New Stack:**
  - API: `pino` JSON logs to stdout (structured)
  - Worker: `pino` logs for job execution
  - Web: browser console
- **Aggregation:** None (local only in dev; Railway build logs in prod)

**Metrics:**
- **Processing Telemetry** (v1):
  - `src/server.js` tracks: batches, yields, processed count, total analysis time, max analysis time
  - Returned in `/api/projects/:id/reprocess-status`
- **v2:** No explicit metrics endpoint yet (future: Prometheus)

## CI/CD & Deployment

**Hosting:**
- **Platform:** Railway.app
- **Services:**
  - Web frontend: `apps/web/` (Next.js, port 3000)
  - API backend: `apps/api/` (Fastify, port 4000)
  - Worker: `apps/worker/` (BullMQ, no exposed port)
  - PostgreSQL: Managed plugin
  - Redis: Managed plugin
  - Tigris: Object storage (managed S3-compatible)

**CI Pipeline:**
- **Provider:** Railway auto-build (git push → Docker build)
- **Trigger:** Push to main branch
- **Build:**
  - Dockerfile: `node:25-bookworm-slim` with Python 3.11 venv (v1)
  - Nixpacks (alternative): `nodejs_20` + `python311`
- **Start Command:** `node src/server.js` (v1) or orchestrated monorepo startup (v2)
- **Health Check:** `GET /railway-health` (v1), path configurable in `railway.json`

**Deployment Config:**
- **railway.json:** Defines start command, health check path, restart policy
  ```json
  {
    "deploy": {
      "startCommand": "node src/server.js",
      "healthcheckPath": "/railway-health",
      "restartPolicyType": "ON_FAILURE",
      "restartPolicyMaxRetries": 10
    }
  }
  ```
- **nixpacks.toml:** Build phases (setup, install, start)
- **Dockerfile:** v1 legacy server build, workspaces field stripped before npm install

**Secrets Management:**
- **Method:** Environment variables via Railway dashboard
- **Base64 Encoding** (v1 Project 2/3 credentials):
  - `PROJECT2_GOOGLE_CREDENTIALS_B64` — service account JSON → base64
  - `PROJECT2_SEEN_B64` — tracked email IDs → base64
  - `PROJECT2_LOG_B64` — run log → base64
  - At runtime: decoded to `/opt/venv/credentials.runtime.json` by Python script
- **API Keys:** Plain text in env vars (`CRM_API_KEY`, `AI_API_KEY`, `JWT_SECRET`)
- **Database:** PostgreSQL password in `DATABASE_URL` connection string
- **S3:** `S3_ACCESS_KEY`, `S3_SECRET_KEY` for Tigris auth

## Webhooks & Callbacks

**Incoming (v1):**
- **Legacy Integration API:** `POST /api/legacy-integration/messages` — receive email events from external systems
  - Requires auth token in request (custom header)
  - Payload: Normalized message object with sender, subject, body, attachments
  - Response: `{ success, messageKey, conflicts }`
- **Deprecated:** Direct webhook input (no longer in use, replaced by integration API)

**Incoming (v2):**
- **Integration Webhook:** `POST /api/v2/webhooks/messages` (planned)
  - JWT-authenticated
  - Receive email from external source (e.g., external IMAP, manual forward)
  - Trigger full pipeline (parse → classify → extract → crm-match)

**Outgoing (v1):**
- **CRM Push:** One-way POST to CRM API (no callback)
  - Adapter: `src/services/crm-adapters.js`
  - Payload: amoCRM lead, Bitrix24 lead, 1С payload, or generic
  - No return value expected (fire-and-forget with retry logic)
- **Legacy Webhook Dispatcher:** `src/services/webhook-dispatcher.js`
  - Custom webhooks for back-compat (deprecated in v2)

**Outgoing (v2):**
- **CRM Sync Worker:** BullMQ job pushes to CRM on message ready
- **Audit Trail:** Integration events logged to PostgreSQL
- **No external webhooks yet:** Future phase

## Integration Contract & Versioning

**v1 Legacy Integration API:**
- **Version Endpoint:** `GET /api/legacy-integration/version` → returns contract version (e.g., "0.2.0")
- **OpenAPI Spec:** `GET /api/legacy-integration/openapi.json` (auto-generated from `src/services/integration-openapi.js`)
- **Changelog:** `GET /api/legacy-integration/changelog` (document per version from `src/services/integration-contract.js`)
- **Supported Fields:**
  - Message: subject, body, sender_email, sender_name, mailbox, attachments, detected_brands, articles, company, inn, phone, position
  - Classification: label (Клиент/СПАМ/Поставщик/Не определено), confidence
  - CRM state: ready_for_crm, sync_status, external_id (in linked CRM)

**v2 REST API:**
- **Base URL:** `http://localhost:4000` (dev) or Railway URL (prod)
- **Auth:** JWT Bearer token (from login endpoint)
- **Endpoints:**
  - `POST /api/v2/messages` — Create/receive email
  - `GET /api/v2/messages/{id}` — Retrieve parsed message
  - `GET /api/v2/threads/{threadId}` — Get conversation thread
  - `POST /api/v2/webhooks/messages` — External email webhook
  - `GET /api/v2/admin/health` — Health check
- **Swagger:** Enabled via `@fastify/swagger` plugin

---

*Integration audit: 2026-04-19*
