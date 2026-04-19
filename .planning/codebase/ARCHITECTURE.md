# Architecture

**Analysis Date:** 2026-04-19

## Pattern Overview

**Overall:** Dual-layer hybrid system combining a monolithic Node.js HTTP server (v1, production) with an emerging v2 monorepo (Next.js web + Fastify API + BullMQ workers). Email processing pipeline flows through rule-based classification, entity extraction, CRM matching, and human review. Three distinct project types manage different processing workflows (single-email analysis, tender imports via Python, bulk mailbox parsing).

**Key Characteristics:**
- Monolithic Node.js HTTP server with manual routing (no Express/Fastify in v1)
- SQLite knowledge base (KB) for classification rules, brand aliases, sender profiles
- Three parallel processing tracks (email-parser, tender-importer, mailbox-file-parser)
- Node.js ↔ Python integration via `child_process.spawn` with stdout JSON markers
- Emerging v2: Monorepo with microservice-style separation (web, API, workers)
- SPA frontend in `public/app.js` + legacy manager interface in `public/manager.html`

---

## Layers

**HTTP Request Entry Point:**
- Purpose: Route incoming requests to handlers, serve static files, manage server lifecycle
- Location: `src/server.js`
- Contains: Core routing logic (regex-based path matching), rate limiting, SSE broadcast, background job tracking, graceful shutdown
- Depends on: ProjectsStore, email-analyzer, detection-kb, all integration clients, scheduler, webhook dispatcher
- Used by: Browsers, API clients, integration webhooks, internal background processes

**Detection Knowledge Base (KB):**
- Purpose: Centralized SQLite database for classification rules, brand aliases, sender profiles, field patterns, message corpus
- Location: `src/services/detection-kb.js` + `data/detection-kb.sqlite`
- Contains: Rule engine for classification (client/spam/vendor), brand canonicalization, semantic matching, numeric validation
- Depends on: Node.js SQLite driver (DatabaseSync), attachment content extraction
- Used by: email-analyzer, project3-runner, manager UI via REST API

**Email Analysis Service:**
- Purpose: Single-email processing pipeline: parse → classify → extract entities → match in CRM → quality gate
- Location: `src/services/email-analyzer.js`
- Contains: Regex-based entity extraction (phone, INN, article, company), detection-kb classification, LLM optional extraction, AI confidence hybrid scoring
- Depends on: detection-kb, attachment-content.js, crm-matcher.js, llm-extractor.js, quality-gate.js, ai-classifier.js
- Used by: Email parser project, mailbox file parser, background LLM reanalysis

**CRM Matching Service:**
- Purpose: Map extracted company info (INN, domain, contact) → known companies in project config
- Location: `src/services/crm-matcher.js`
- Contains: Cascade matching (INN → domain → fuzzy name → email domain → manual override)
- Depends on: ProjectsStore for known company list
- Used by: email-analyzer (post-extraction step)

**Project Storage & Lifecycle:**
- Purpose: Persist projects, analyses, runs, messages across restarts
- Location: `src/storage/projects-store.js` + `data/projects.json`
- Contains: Project CRUD, message append/replace, run history, schedule tracking
- Depends on: Node.js fs, path normalization utilities
- Used by: All project runners, scheduler, HTTP routes, background processors

**Project Scheduler:**
- Purpose: Automatic trigger of Project 2 (tender) and Project 3 (mailbox) at scheduled times
- Location: `src/services/project-scheduler.js`
- Contains: `setInterval(1 hour)` loop checking due schedules, runner delegation, error handling
- Depends on: ProjectsStore, tender-runner.js, project3-runner.js
- Used by: server.js (started on startup)

**Project 2: Tender Importer:**
- Purpose: IMAP → SAP SRM tender parsing → Google Sheets automation
- Location: `src/services/tender-runner.js` + `project 2/tender_parser.py`
- Contains: Python process spawn, env-var config passing, stdout JSON parsing (SUMMARY_JSON=), retry logic
- Depends on: ProjectsStore, spawn from child_process, email-analyzer for analysis
- Used by: Scheduler, HTTP routes for manual trigger

**Project 3: Mailbox File Parser:**
- Purpose: Bulk email fetch from 28 mailboxes (configured in `1.txt`), per-email analysis, SQLite corpus
- Location: `src/services/project3-runner.js` + `project 3/mailbox_file_runner.py`
- Contains: Config parser (TSV → mailbox list), Python spawn with IMAP params, per-email analysis loop, attachment extraction
- Depends on: ProjectsStore, email-analyzer, mailbox-config-parser.js, attachment-content.js
- Used by: Scheduler, HTTP routes for manual trigger

**Attachment Content Extractor:**
- Purpose: Extract text from PDF, DOCX, XLSX files for entity extraction pipeline
- Location: `src/services/attachment-content.js`
- Contains: File type detection, format-specific extraction (pdf-parse, docx, xlsx libraries)
- Depends on: npm packages (pdf-parse, docx, xlsx)
- Used by: email-analyzer (optional attachment processing)

**Integration API (Legacy):**
- Purpose: External API clients (B2B partners, legacy systems) submitting emails, querying state, webhook delivery
- Location: `src/services/integration-api.js` + `src/services/integration-clients.js` + `src/services/integration-openapi.js`
- Contains: Message/thread/delivery CRUD, webhook management, OpenAPI spec generation, change tracking
- Depends on: ProjectsStore
- Used by: HTTP routes at `/api/integration/*`

**Manager Authentication:**
- Purpose: Admin password-based auth for `/manager` UI
- Location: `src/services/manager-auth.js` + `data/manager-auth.sqlite`
- Contains: SQLite session store, password validation, session expiry
- Depends on: Node.js crypto, DatabaseSync
- Used by: HTTP routes for /manager endpoints

**Static File Serving:**
- Purpose: Serve SPA frontend, styles, and legacy manager UI
- Location: `public/app.js`, `public/index.html`, `public/manager.html`, `public/manager.js`, `public/styles.css`
- Contains: Vue-like SPA framework, Tailwind CSS, responsive inbox grid, modal dialogs
- Depends on: HTTP server
- Used by: Browsers accessing `/` and `/manager`

**Webhook Dispatcher:**
- Purpose: Asynchronous delivery of new message notifications to external webhooks
- Location: `src/services/webhook-dispatcher.js`
- Contains: Queue-based delivery, exponential backoff, timeout handling
- Depends on: ProjectsStore, HTTP client
- Used by: server.js (background service), project runners (enqueue on new messages)

**Quality Gate (Pipeline Filter):**
- Purpose: Mark messages requiring review if data is incomplete/dirty (missing ФИО, invalid INN, etc.)
- Location: `src/services/quality-gate.js`
- Contains: Validation rules for ready_for_crm vs review bucket
- Depends on: Field validation helpers
- Used by: email-analyzer (post-classification step)

---

## Data Flow

**Email Parser (Project 1) Flow:**

1. HTTP `POST /api/projects/:id/analyze` receives email JSON
2. `email-analyzer.analyzeEmail()` invokes:
   - Parse subject/body (normalize HTML, strip signature)
   - Call `detection-kb.classifyEmail()` → label (Клиент/Спам/Поставщик)
   - Extract entities: phone, INN, company name, articles, brands (via KB)
   - `crm-matcher.matchCompanyInCrm()` → known company ID or null
   - Optional LLM extraction (if `AI_ENABLED`)
   - `quality-gate.annotateQualityGate()` → ready_for_crm vs review
3. Store analysis in message object
4. Return analysis JSON
5. Frontend displays classification, extracted entities, confidence scores

**Tender Importer (Project 2) Flow:**

1. Scheduler triggers at scheduled time or HTTP endpoint manual trigger
2. `project-scheduler.executeProject()` → `tender-runner.runTenderImporter()`
3. `spawn("python", ["project 2/tender_parser.py"], { env: {...} })`
4. Python process:
   - IMAP connect to SAP tender mailbox
   - Fetch unread, mark as read
   - Parse tender structure (document, requester, items)
   - Output `SUMMARY_JSON={...}` on stdout
5. Node.js stdout reader extracts and parses JSON
6. Store run result in ProjectsStore
7. Webhook dispatch notifications

**Mailbox File Parser (Project 3) Flow:**

1. Read `1.txt` config file (TSV: mailbox | password | brand | site)
2. `project-scheduler.executeProject()` → `project3-runner.runMailboxFileParser()`
3. `spawn("python", ["project 3/mailbox_file_runner.py"], { PROJECT3_SOURCE_FILE: ..., PROJECT3_DAYS: 1, ... })`
4. Python process:
   - Loop over mailboxes from config
   - IMAP fetch emails from past N days
   - For each email, extract: from, subject, body, attachments (base64)
   - Output `PROJECT3_JSON={emails: [{...}]}` on stdout
5. Node.js stdout reader parses JSON, iterates emails:
   - Save attachment files to disk (`data/attachments/{messageKey}/`)
   - Call `email-analyzer.analyzeEmail()` for each
   - Append to project.recentMessages
6. Store run + new messages in ProjectsStore
7. Broadcast SSE notifications to connected clients

**State Management:**

- **Projects & Messages:** `data/projects.json` (ProjectsStore) — hot-loaded, persisted on each mutation
- **Classification Rules:** `data/detection-kb.sqlite` (DatabaseSync) — transactional, mutable REST API
- **Brand Catalog:** Imported into KB at startup if alias count < 5000 (auto-seeding from `data/brand-catalog.json`)
- **Attachment Content:** Disk cache in `data/attachments/{messageKey}/` before LLM extraction
- **Background Jobs:** In-memory Map, TTL-cleaned every 10 minutes, not persisted

---

## Key Abstractions

**Analysis Result Object:**
- Purpose: Immutable structured representation of email processing output
- Examples: `src/services/email-analyzer.js` (export `analyzeEmail`, `analyzeEmailAsync`)
- Pattern: Contains classification label + confidence, extracted entities (person, company, phone, INN, articles, brands), CRM match, quality gate status, LLM extraction result

**Classification Label:**
- Enum values: "Клиент" (client), "СПАМ" (spam), "Поставщик услуг" (vendor), "Поставщик" (vendor alias)
- Assigned by: detection-kb rule engine (rule-based matching + optional LLM override)
- Confidence: 0.0–1.0 (hybrid AI + rule-based scoring)

**Detection Rule (KB):**
- Purpose: Classifying emails by keywords, sender profile, TLD, attachment type
- Location: SQLite tables in `data/detection-kb.sqlite` (rules, brand_rules, sender_profiles, field_patterns)
- CRUD via: `detectionKb.addRule()`, `detectionKb.updateRule()`, REST API `/api/detection-kb/rules`

**Pipeline Status:**
- Values: "ready_for_crm", "review", "ignored_spam", "ignored_duplicate", "needs_clarification"
- Computed by: `computePipelineStatus()` in server.js based on classification + quality gate result
- Used by: Frontend inbox grouping, API filters

**Integration Client:**
- Purpose: External API consumer with API key + webhook URL
- Stored in: ProjectsStore + env-var clients (LEGACY_INTEGRATION_CLIENTS_*)
- Auth: Bearer token check in server.js route guards

**Project Schedule:**
- Fields: enabled, time (HH:MM), timezone, days (recurrence interval in days)
- Example: "enabled: true, time: '12:00', timezone: 'Europe/Moscow', days: 1" → daily at noon Moscow time
- Used by: ProjectScheduler.tick() for automated trigger

---

## Entry Points

**HTTP Server Root (`src/server.js`):**
- Location: `src/server.js`
- Triggers: `npm start` or `npm run dev` (with --watch)
- Responsibilities: Listen on port (env: PORT, default 3000), route requests, manage scheduler/webhook dispatcher, graceful shutdown

**API Route: Email Analysis (`POST /api/projects/:id/analyze`):**
- Location: `src/server.js` in `handleApi()` switch
- Triggers: POST request with email JSON body
- Responsibilities: Parse body, rate-limit client, call `email-analyzer.analyzeEmail()`, return analysis, store in ProjectsStore

**API Route: Project Execution (`POST /api/projects/:id/run`):**
- Location: `src/server.js` in `handleApi()` switch
- Triggers: HTTP POST to manually start project runner
- Responsibilities: Check if already running, spawn background job, call scheduler `executeProject()`, return job ID

**Project Scheduler Tick (`ProjectScheduler.tick()`):**
- Location: `src/services/project-scheduler.js`
- Triggers: Every 60 minutes (or on server startup)
- Responsibilities: Check all projects for due schedules, run eligible projects, persist results

**Manager Dashboard (`GET /manager`):**
- Location: `src/server.js` serveStatic handler
- Triggers: Browser request to `/manager` or `/manager/`
- Responsibilities: Serve `public/manager.html` + `public/manager.js` (vanilla JS with login gate)

**Manager API Routes (`/api/manager/...`):**
- Location: `src/server.js` in `handleApi()` switch
- Triggers: Manager dashboard JavaScript calls
- Responsibilities: Auth check via ManagerAuth, CRUD operations on projects/rules/KB

**SPA Inbox (`GET /`):**
- Location: `src/server.js` serveStatic handler
- Triggers: Browser root request
- Responsibilities: Serve `public/index.html` + `public/app.js` (Vue-like SPA with Tailwind CSS)

**Integration API Routes (`GET/POST /api/integration/...`):**
- Location: `src/server.js` in `handleIntegrationApi()` switch
- Triggers: External API clients authenticated via API key
- Responsibilities: Message/thread CRUD, webhook management, change tracking

---

## Error Handling

**Strategy:** Categorized by layer with graceful fallbacks.

**Patterns:**

- **HTTP-level (server.js):** HttpError class with statusCode; 500 errors logged with details in dev, hidden in production
- **Service-level (email-analyzer, KB):** Try-catch with fallback to safe defaults (e.g., "Клиент" if classification fails, skip attachment if extraction fails)
- **Process-level (Python spawn):** stderr captured, JSON parse failures logged, run marked as error in ProjectsStore
- **Database (SQLite):** WAL mode (write-ahead logging) for crash recovery, prepared statements prevent injection
- **Background jobs:** Error stored in backgroundJobs map, not retried automatically (manual re-trigger via HTTP)
- **Shutdown:** SIGTERM/SIGINT caught, graceful close with 10s timeout before force-close

---

## Cross-Cutting Concerns

**Logging:** Console output to stdout/stderr. Production logs flow to Railway logs. Key events: server startup, project execution, KB mutations, HTTP errors, scheduler ticks.

**Validation:** 
- Email input: Zod or manual validation of JSON schema
- Project config: normalizeSchedule(), normalizeBackgroundRole()
- INN/phone/article extraction: Regex patterns with range checks (INN must be 10–12 digits, article must be 3+ chars)
- KB mutations: Type checks, enum validation for classification labels

**Authentication:** 
- Manager UI: Session-based (ManagerAuth sqlite store), login wall with password env var (ADMIN_PASSWORD)
- Integration API: Bearer token from env-var clients or DB-stored clients
- Background jobs: Internal only, no auth (SIGTERM/SIGINT triggers via process signals)

**Concurrency:**
- ProjectsStore: Synchronized writes via `persist()` (no async/await atomicity — naive but works for ~500/day throughput)
- Detection KB: SQLite DatabaseSync (blocking, single-threaded)
- Background jobs: Map-based, single JS event loop (no race conditions due to Node.js non-preemptive nature)
- Python processes: Spawned sequentially, one per project at a time (scheduler checks inFlightProjectIds)

**Rate Limiting:** Sliding-window (60s window, default 120 requests/window) keyed by client ID from Bearer token or IP. Headers: X-RateLimit-Remaining, Retry-After.

---

## V2 Monorepo Architecture (Emerging)

**Purpose:** Next-generation microservice-style processing pipeline with better scalability and dev experience.

**Structure:**

- `apps/web/` — Next.js 15 frontend (React 19, Tailwind, shadcn/ui components, TanStack Query, Zustand state)
- `apps/api/` — Fastify backend (HTTP API, JWT + RBAC auth, Zod validation, Swagger)
- `apps/worker/` — BullMQ workers (7 parallel: fetch → parse → classify → extract → crm-match → sync + attachment-process)
- `packages/db/` — Prisma ORM + schema (27 models: User, Email, Client, Request, etc.; 12 enums)
- `packages/shared/` — Shared TS types, constants, validation schemas

**Data Flow (v2):**

1. Fastify ingests email from IMAP/webhook
2. Enqueues Job (BullMQ on Redis)
3. Workers poll Redis queue:
   - Fetch worker: Download from IMAP
   - Parse worker: Normalize HTML, extract headers
   - Classify worker: Rule + LLM
   - Extract worker: Entity extraction
   - CRM-match worker: Cascade lookup
   - Sync worker: Write to CRM API
   - Attachment worker: Extract text, store S3
4. All state persisted in PostgreSQL (Prisma)
5. Next.js queries Fastify API (TanStack Query)
6. Feature flags (SYNC_DRY_RUN, AI_ENABLED, SHADOW_MODE) control behavior

**Deployment (Railway):**

- PostgreSQL plugin (managed)
- Redis plugin (managed)
- Tigris S3-compatible storage (managed)
- web service (port 3000)
- api service (port 4000)
- worker service (no port, background only)

---

*Architecture analysis: 2026-04-19*
