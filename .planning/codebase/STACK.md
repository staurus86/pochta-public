# Technology Stack

**Analysis Date:** 2026-04-19

## Languages

**Primary:**
- **Node.js** 20+ (ESM modules) - Backend server, email analysis, job scheduling, all orchestration
- **TypeScript** 5.7+ - New monorepo modules (apps/api, apps/web, apps/worker, packages/db)
- **Python** 3.11 - IMAP mail parsing and import (`project 2/tender_parser.py`, `project 3/mailbox_file_runner.py`)
- **JavaScript** (vanilla, no transpilation for v1 server) - Frontend SPA in `public/`

**Secondary:**
- **SQL** - SQLite queries in `src/services/detection-kb.js`, Prisma migrations for PostgreSQL v2

## Runtime

**Environment:**
- **Node.js** >= 20 (Dockerfile uses `node:25-bookworm-slim`, nixpacks specifies `nodejs_20`)
- **Python** 3.11 with venv isolation (in Dockerfile: `python3-venv`, activated in `/opt/venv`)
- **npm** 10+ (monorepo workspaces: `packages/*`, `apps/*`)

**Package Manager:**
- **npm** (root `package.json` with workspaces)
- **pip** (Python deps: `gspread`, `google-auth`, `imaplib`, `email`)
- Lockfile: `package-lock.json` present

## Frameworks

**Core (v1 — Legacy Server):**
- **Node.js HTTP module** (`node:http`) - No Express, pure HTTP server in `src/server.js`
- **No web framework** - Manual routing via `url.pathname` parsing and regex matching
- **Static file serving** from `public/` directory

**Core (v2 — New Monorepo):**
- **Fastify** 5.2.1 - Backend API (`apps/api/src/server.ts`)
  - Plugins: `@fastify/cors`, `@fastify/jwt`, `@fastify/multipart`, `@fastify/swagger`, `@fastify/rate-limit`
- **Next.js** 15.1.0 - Frontend (`apps/web/`, React 19)
- **React** 19.0.0 - UI framework
- **Tailwind CSS** 3.4.16 - Utility-first styling
- **Prisma** 6.4.1 - ORM for PostgreSQL (`packages/db/`)

**Testing:**
- **Node.js built-in `node:test`** - Test runner for v1 (plain assert, no external test framework)
- Plain assertions via `node:assert` module

**Build/Dev:**
- **TypeScript** 5.7.3 - Compilation for apps/api, apps/web, packages/db
- **tsx** 4.19.2 - TypeScript execution for dev (apps/api)
- **tsc** - TypeScript compiler
- **ESBuild** (via Next.js) - Production builds for web

**Queue/Workers:**
- **BullMQ** 5.34.8 - Job queue for email processing workers (`apps/worker/`)
- **ioredis** 5.4.2 - Redis client for queue

**Utilities:**
- **mailparser** 3.7.2 - Parse MIME emails (apps/api)
- **imap** 0.8.19 - IMAP protocol client
- **sharp** 0.33.5 - Image processing for attachments
- **tesseract.js** 5.1.1 - OCR for attachment images
- **sanitize-html** 2.14.0 - HTML sanitization
- **zod** 3.24.2+ - Schema validation (both v1 and v2)
- **pino** 9.6.0 - Structured logging (apps/api)
- **TanStack Query** 5.62.0 - Data fetching (frontend, apps/web)
- **Zustand** 5.0.2 - State management (frontend)
- **recharts** 2.15.0 - Charts (analytics dashboard)
- **date-fns** 4.1.0 - Date utilities
- **lucide-react** 0.468.0 - Icon library

**Database (v1):**
- **SQLite** (via `node:sqlite` — `DatabaseSync`) - Detection knowledge base (`data/detection-kb.sqlite`)
- **JSON** file-based storage - Projects metadata (`data/projects.json`)

**Database (v2):**
- **PostgreSQL** 16 (docker-compose service)
- **Prisma** ORM - 27 models, 12 enums
- **Redis** 7 - Cache, session store, BullMQ queue backend

**Object Storage:**
- **MinIO** (local dev, docker-compose)
- **Tigris** (Railway production, S3-compatible)
- S3 client library (via `@aws-sdk` or S3-compatible adapters in apps/api)

## Key Dependencies

**Critical (v1):**
- `node:sqlite` (`DatabaseSync`) - In-process SQLite, no external server
- `node:http`, `node:fs`, `node:crypto`, `node:path`, `node:url` - Native Node APIs only
- Google Sheets integration: `gspread`, `google-auth` (Python, for Project 2)

**Critical (v2):**
- `@prisma/client` 6.4.1 - Database client
- `bullmq` - Async job processing (7 workers: fetch, parse, classify, extract, crm-match, sync, attachment-process)
- `fastify` - REST API framework
- `ioredis` - Redis connection
- `mailparser` - Email MIME parsing

**Infrastructure:**
- `@fastify/jwt` - JWT authentication
- `@fastify/swagger` - OpenAPI documentation
- `@fastify/rate-limit` - API rate limiting
- `sanitize-html` - Prevent HTML injection in message bodies
- `sharp` - Image resize/convert for attachment previews
- `tesseract.js` - OCR capability (optional, for scanned document extraction)
- `pino` - Structured JSON logging

## Configuration

**Environment Variables (v1 Legacy Server):**

*HTTP Server:*
- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `3000`)
- `DATA_DIR` (default: `./data`)

*Detection Knowledge Base:*
- No direct config, SQLite auto-created at `data/detection-kb.sqlite`

*Project 2 (Tender Parser — Python):*
- `PROJECT2_RUNTIME_DIR` - Working directory for credentials/state
- `PROJECT2_GMAIL_USER`, `PROJECT2_GMAIL_PASSWORD` - IMAP credentials
- `PROJECT2_IMAP_HOST` (default: `mail.klvrt.ru`), `PROJECT2_IMAP_PORT` (default: `993`)
- `PROJECT2_GOOGLE_SHEETS_ID` - Target spreadsheet ID
- `PROJECT2_GOOGLE_CREDENTIALS` / `PROJECT2_GOOGLE_CREDENTIALS_B64` / `PROJECT2_GOOGLE_CREDENTIALS_JSON` - Service account auth
- `PROJECT2_SEEN_FILE`, `PROJECT2_SEEN_B64` - Tracked email message IDs (state file)
- `PROJECT2_LOG_FILE`, `PROJECT2_LOG_B64` - Run log

*Project 3 (Mailbox File Parser — Python):*
- `PROJECT3_RUNTIME_DIR` - Working directory
- Config TSV read from `1.txt` (columns: mailbox, webmail_url, password, collector_email, site_url, brand)
- Results written to `data/` as JSON

*AI Classification (Optional):*
- `AI_ENABLED=true` - Enable LLM-based second opinion
- `AI_API_KEY` - API key (fallback: `LLM_EXTRACT_API_KEY`)
- `AI_BASE_URL` (default: `https://api.artemox.com/v1`)
- `AI_MODEL` (default: `gpt-4.1-mini`)
- `AI_CONFIDENCE_THRESHOLD` (default: `0.75`)
- `AI_TIMEOUT_MS` (default: `15000`)

*LLM Entity Extraction (Optional):*
- `LLM_EXTRACT_ENABLED=true` - Enable
- `LLM_EXTRACT_API_KEY` - API key
- `LLM_EXTRACT_BASE_URL` (default: `https://api.artemox.com/v1`)
- `LLM_EXTRACT_MODEL` (default: `gpt-4o-mini`)
- `LLM_EXTRACT_TIMEOUT_MS` (default: `30000`)
- `LLM_EXTRACT_LOG_SUGGESTIONS=true` - Write hints to `data/llm-suggestions.jsonl`

*CRM Sync:*
- `CRM_ENABLED=true` - Enable CRM push
- `CRM_TYPE=amocrm|bitrix24|1c|generic`
- `CRM_BASE_URL` - CRM API endpoint
- `CRM_API_KEY` - CRM authentication
- `CRM_TIMEOUT_MS` (default: `15000`)
- `CRM_PIPELINE_ID`, `CRM_STATUS_ID`, `CRM_RESPONSIBLE_USER_ID` - CRM-specific IDs
- `SYNC_DRY_RUN=true` - Test mode (no actual CRM writes)

*Background Jobs:*
- `LEGACY_BACKGROUND_ROLE=all|scheduler|webhook` - What background tasks to run
- `LEGACY_BACKGROUND_JOB_TTL_MS` (default: `3600000` = 1 hour)
- `LEGACY_MAX_JSON_BODY_BYTES` (default: `65536`)

*Manager UI Auth:*
- `ADMIN_PASSWORD` - Set password for `/api/auth/login` (optional, no env → no auth required)

**Environment Variables (v2 New Stack):**

*Database & Queue:*
- `DATABASE_URL=postgresql://user:pass@postgres:5432/pochta` - Prisma DSN
- `REDIS_URL=redis://redis:6379` - BullMQ queue backend

*API (Fastify):*
- `PORT=4000` - Server port
- `JWT_SECRET` - JWT signing key
- `LOG_LEVEL=debug|info|warn|error`
- `CORS_ORIGIN=http://localhost:3000` - CORS allowed origin

*Storage (S3-compatible):*
- `S3_ENDPOINT=http://minio:9000` (MinIO local) or Tigris URL (Railway)
- `S3_ACCESS_KEY` - S3 access key
- `S3_SECRET_KEY` - S3 secret
- `S3_BUCKET=pochta-emails` - Bucket name
- `S3_REGION=us-east-1` - AWS region (for Tigris)

*Worker (BullMQ):*
- Same as API (DATABASE_URL, REDIS_URL, S3_*)
- `SYNC_DRY_RUN=true` (default in docker-compose)

*Frontend (Next.js):*
- `NEXT_PUBLIC_API_URL=http://localhost:4000` - Backend API URL (public, sent to browser)

**Build Configuration:**
- `tsconfig.json` - TypeScript settings (root + per-app)
- `.eslintrc.*` (if present) - Linting rules
- `.prettierrc` (if present) - Code formatting
- `next.config.js` - Next.js build config (apps/web)
- `tailwind.config.js` - Tailwind CSS config (apps/web)

## Platform Requirements

**Development:**
- Node.js >= 20
- Python 3.11+ (for Project 2/3 runners)
- npm 10+
- Docker & Docker Compose (for local Postgres + Redis + MinIO)

**Production (Railway):**
- Railway.app hosting
- PostgreSQL plugin (managed)
- Redis plugin (managed)
- Tigris object storage (managed)
- Dockerfile: `node:25-bookworm-slim` with Python 3.11 venv
- Start command: `node src/server.js` (v1 legacy) or orchestrated monorepo startup

**Deployment Pipeline:**
- Railway auto-builds from git (Dockerfile or nixpacks.toml)
- nixpacks.toml specifies `nodejs_20` + `python311`
- Secrets passed as base64-encoded env vars (for v1 Project 2/3 credentials)

---

*Stack analysis: 2026-04-19*
