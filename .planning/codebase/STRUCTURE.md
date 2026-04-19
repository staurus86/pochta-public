# Codebase Structure

**Analysis Date:** 2026-04-19

## Directory Layout

```
pochta/
├── .planning/                   # GSD planning + codebase analysis (auto-generated)
├── .railway-deploy/             # CRITICAL: Mirror of src/ for Railway deploy
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── Dockerfile
│   └── requirements.txt
├── apps/                        # V2 monorepo (emerging microservice architecture)
│   ├── api/                     # Fastify backend (TypeScript)
│   ├── web/                     # Next.js 15 frontend (React 19, Tailwind)
│   └── worker/                  # BullMQ email processing workers
├── packages/                    # Monorepo shared packages
│   ├── db/                      # @pochta/db — Prisma schema + client
│   └── shared/                  # @pochta/shared — Shared TS types, constants
├── scripts/                     # Utility scripts (audit, import, export)
├── src/                         # V1 production codebase (Node.js ESM)
│   ├── server.js                # HTTP server entry point, routing, request handlers
│   ├── services/                # Core processing services
│   ├── storage/                 # Data persistence (ProjectsStore)
│   └── utils/                   # Helper utilities
├── public/                      # Static files, SPA frontend, manager UI
├── tests/                       # Unit tests (Node.js plain assert, no frameworks)
├── data/                        # Runtime data (projects.json, SQLite DB, cached JSON)
├── project 2/                   # Tender importer runtime (Python)
├── project 3/                   # Mailbox file parser runtime (Python)
├── docs/                        # Architecture docs, reports, audit notes
├── CLAUDE.md                    # Project conventions + overview (checked into git)
├── package.json                 # Root workspace config (npm workspaces)
├── docker-compose.yml           # Local dev: Postgres, Redis, MinIO
├── Dockerfile                   # Production image
├── railway.json                 # Railway deploy config
└── requirements.txt             # Python dependencies
```

## Directory Purposes

**`.planning/codebase/`:**
- Purpose: Auto-generated analysis documents by `/gsd:map-codebase` (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md, STACK.md, INTEGRATIONS.md)
- Contains: Markdown reference docs for future Claude instances
- Generated: Yes (do NOT edit manually)
- Committed: Yes (check into git)

**`.railway-deploy/`:**
- Purpose: **CRITICAL SYNC POINT** — Mirror of `src/` and `public/` for Railway deployment. Railway runs from this directory, not from `src/` root.
- Contains: Full copy of src/, public/, scripts/, package.json, Dockerfile, requirements.txt
- Key rule: After modifying `src/services/*.js` or `public/app.js`, ALWAYS copy same file to `.railway-deploy/src/services/` or `.railway-deploy/public/`
- Committed: Yes (synced manually or via CI)
- Impact: Mismatches between src/ and .railway-deploy/ cause production bugs (example: attachment-content.js was out of sync, breaking file extraction on Railway)

**`apps/api/`:**
- Purpose: Fastify HTTP backend for v2 architecture
- Contains: TypeScript source (src/), config, middleware, plugins, queues, routes, services, Prisma integration
- Key files: `src/server.ts` (Fastify app setup), `src/plugins/auth.ts` (JWT + RBAC), `src/routes/*.ts` (email, clients, dashboard, templates)
- Generated: No
- Committed: Yes

**`apps/web/`:**
- Purpose: Next.js 15 frontend for v2 architecture
- Contains: React 19 components, app router, Tailwind CSS, TanStack Query hooks, Zustand stores
- Key files: `src/app/page.tsx` (root), `src/app/inbox/page.tsx` (message list), `src/app/inbox/[id]/review/page.tsx` (review modal), `src/components/email/*.tsx` (email display components)
- Generated: Next.js build artifacts (.next/)
- Committed: Source only

**`apps/worker/`:**
- Purpose: BullMQ workers for v2 pipeline (background job processing)
- Contains: TypeScript worker logic, queue subscriptions, error handlers
- Key files: `src/workers/*.ts` (fetch, parse, classify, extract, crm-match, sync, attachment-process)
- Generated: No
- Committed: Yes

**`packages/db/`:**
- Purpose: Shared Prisma ORM + database schema (@pochta/db)
- Contains: `prisma/schema.prisma` (27 models, 12 enums), migration files
- Key files: `prisma/schema.prisma` (source of truth), `src/client.ts` (exported Prisma client)
- Generated: Prisma-generated types in node_modules/@prisma/client/
- Committed: schema.prisma + migrations only (not generated/)

**`packages/shared/`:**
- Purpose: Shared TypeScript types, constants, validation (@pochta/shared)
- Contains: Enum definitions, shared request/response types, Zod validation schemas
- Generated: No
- Committed: Yes

**`src/`:**
- Purpose: Production-ready v1 codebase (Node.js ESM, no frameworks)
- Contains: HTTP server, core services, storage layer, utilities
- Key entry: `src/server.js` (main HTTP entry point)
- Generated: No
- Committed: Yes

**`src/services/`:**
- Purpose: Core business logic modules (extraction, classification, CRM matching, scheduling)
- Contains: 27 service files (see Key File Locations below)
- Naming: kebab-case files (email-analyzer.js, detection-kb.js, crm-matcher.js, etc.)
- Committed: Yes

**`src/storage/`:**
- Purpose: Data persistence layer
- Contains: `projects-store.js` (ProjectsStore class for projects.json CRUD)
- Committed: Yes

**`src/utils/`:**
- Purpose: Helper utilities
- Contains: `slug.js` (URL-safe slugs), other string manipulation
- Committed: Yes

**`public/`:**
- Purpose: Static assets + SPA frontend + manager UI
- Contains: HTML, CSS, JavaScript
- Key files:
  - `index.html` — SPA root (inbox app)
  - `app.js` — Single-file SPA implementation (~216KB, Vue-like framework)
  - `styles.css` — Tailwind CSS compiled
  - `manager.html` — Admin UI for rule management
  - `manager.js` — Manager UI JavaScript
- Note: ALWAYS sync changes to `public/app.js` → `.railway-deploy/public/app.js`
- Committed: Yes

**`tests/`:**
- Purpose: Unit tests for services
- Contains: 27 test files (one per major service)
- Naming: `{service-name}.test.js`
- Framework: Node.js built-in `node:test` + `node:assert` (no external test runner)
- Committed: Yes

**`scripts/`:**
- Purpose: Utility and audit scripts (Python + Node.js)
- Contains:
  - Audit scripts: `audit_prod_json.py`, `audit_refined.py`, `audit_gaps.py` (analyze inbox correctness)
  - Import scripts: `import-nomenclature.js`, `import_company_directory.py` (seed KB)
  - Export scripts: `export-detected-article-contexts.js`, `export_inbox_csv.py`
  - Compare scripts: `compare_abc.py`, `compare_d.py`, etc. (diff test batches)
- Generated: No
- Committed: Yes

**`data/`:**
- Purpose: Runtime data directory
- Contains:
  - `projects.json` — All project configs, recent analyses, message history (hot-loaded/persisted by ProjectsStore)
  - `detection-kb.sqlite` — SQLite database for classification rules, brand aliases, sender profiles, field patterns (DatabaseSync)
  - `brand-catalog.json` — Full brand list (auto-imported into KB at startup if aliases < 5000)
  - `product-types.json` — Request type signal keywords
  - `attachments/{messageKey}/` — Extracted attachment files (PDF, DOCX, XLSX text)
  - Temp files: `.prod_kb.json`, `.proj_tmp.json`, `_baseline_*.json` (audit intermediates)
- Generated: Yes (hot-written by server at runtime)
- Committed: No (but projects.json and *.sqlite are tracked in git for audit trail)

**`project 2/`:**
- Purpose: Tender importer runtime directory
- Contains:
  - `tender_parser.py` — IMAP → SAP SRM tender parser (executable)
  - `credentials.json` — Google Sheets API service account
  - `seen_emails.json` — Idempotency: set of already-parsed email IDs
  - `tender_parser.log` — Runtime log file
- Working directory for: `runTenderImporter()` (spawned Python process)
- Committed: .py source only (not credentials, logs, or seen state)

**`project 3/`:**
- Purpose: Mailbox file parser runtime directory
- Contains:
  - `mailbox_file_runner.py` — IMAP fetch from 28 mailboxes via `1.txt` config (executable)
  - `__pycache__/` — Python bytecode cache
- Working directory for: `runMailboxFileParser()` (spawned Python process)
- Committed: .py source only

**`docs/`:**
- Purpose: Architecture specs, audit reports, research notes
- Contains:
  - `ARCHITECTURE.md` — v2.0 system design (98KB)
  - `generate_audit.py` — Audit script generator
  - `Pochta_Platform_Report.docx` — Stakeholder report
  - Report + research files (PNG, XLSX, TXT)
- Generated: Some (audit reports)
- Committed: Source specs only

## Key File Locations

**Entry Points:**

- `src/server.js` — Main HTTP server, routing, scheduler, webhook dispatcher startup
- `apps/api/src/server.ts` — Fastify API server (v2)
- `apps/web/src/app/page.tsx` — Next.js root page (v2)

**Configuration:**

- `CLAUDE.md` — Project conventions, commands, architecture summary (checked in)
- `package.json` — Root workspace, npm scripts, dependencies
- `package-lock.json` or `pnpm-lock.yaml` — Lockfile (track for reproducibility)
- `.env.example` — Template for env vars (PORT, DATA_DIR, RATE_LIMIT_MAX, etc.)
- `.railway-deploy/package.json` — Deployment-specific package config
- `Dockerfile` — Multi-stage Docker build for Railway
- `railway.json` — Railway deploy manifest

**Core Logic:**

**Email Processing Pipeline:**
- `src/services/email-analyzer.js` — Single-email analysis (parse, classify, extract entities)
- `src/services/detection-kb.js` — SQLite KB + rule engine for classification, brand matching
- `src/services/crm-matcher.js` — Company matching (cascade: INN → domain → fuzzy)
- `src/services/attachment-content.js` — PDF/DOCX/XLSX text extraction
- `src/services/llm-extractor.js` — Optional LLM extraction (Claude API) + caching
- `src/services/ai-classifier.js` — Hybrid classification (rules + LLM confidence)
- `src/services/quality-gate.js` — Pipeline filter (ready_for_crm vs review)

**Project Execution:**
- `src/services/tender-runner.js` — Project 2 executor (spawn tender_parser.py)
- `src/services/project3-runner.js` — Project 3 executor (spawn mailbox_file_runner.py)
- `src/services/project-scheduler.js` — Scheduled trigger (1h tick)
- `src/services/project-schedule.js` — Schedule normalization + due check

**Data & Storage:**
- `src/storage/projects-store.js` — ProjectsStore class (projects.json CRUD)
- `data/projects.json` — Persistent project state + recent messages
- `data/detection-kb.sqlite` — Transactional rule database

**Integration APIs:**
- `src/services/integration-api.js` — External API (message/thread/delivery endpoints)
- `src/services/integration-clients.js` — Client auth (env-var + DB clients)
- `src/services/integration-contract.js` — API contract + changelog
- `src/services/integration-openapi.js` — OpenAPI spec generator

**Authentication & Authorization:**
- `src/services/manager-auth.js` — Session store for /manager UI
- `data/manager-auth.sqlite` — Manager sessions

**Utilities:**
- `src/utils/slug.js` — URL-safe slug generation
- `src/services/http-json.js` — HTTP response helpers, body parsing
- `src/services/idempotency.js` — Idempotency key handling
- `src/services/background-role.js` — Multi-instance coordination (scheduler, webhooks)

**Static Files:**
- `public/index.html` — SPA root (inbox application)
- `public/app.js` — Main SPA JavaScript (Vue-like framework, Tailwind CSS utilities)
- `public/styles.css` — Global styles (Tailwind compiled)
- `public/manager.html` — Manager admin interface
- `public/manager.js` — Manager UI logic

**Testing:**
- `tests/email-analyzer.test.js` — Email analysis pipeline (133KB, 50+ test cases)
- `tests/detection-kb.test.js` — KB rule engine (27KB)
- `tests/projects-store.test.js` — ProjectsStore CRUD (13KB)
- `tests/batch-{c,d,e,f,g,h,i,j}-fixes.test.js` — Regression tests per improvement batch
- `tests/data/` — Test fixtures (sample emails, KB data)

## Naming Conventions

**Files:**
- Services: `kebab-case.js` (email-analyzer.js, detection-kb.js, crm-matcher.js)
- Tests: `{service-name}.test.js` (email-analyzer.test.js)
- Utilities: `kebab-case.js` (mailbox-config-parser.js)
- Python scripts: `snake_case.py` (tender_parser.py, mailbox_file_runner.py)

**Directories:**
- Services: lowercase singular or plural (src/services/, project 2/, project 3/)
- Static: lowercase (public/, data/, scripts/, tests/)

**Code Style:**
- Variables/functions: camelCase (analyzeEmail, detectionKb, formatInn)
- Classes: PascalCase (ProjectsStore, ManagerAuth, ProjectScheduler, HttpError)
- Constants: UPPER_SNAKE_CASE (RATE_LIMIT_MAX, DEFAULT_DATA_DIR, BRAND_FALSE_POSITIVE_ALIASES)
- Imports: ESM syntax (`import { X } from "module"`)
- Indentation: 4 spaces

**Export Naming:**
- Single default export: `export default class ProjectsStore { ... }`
- Named exports: `export function analyzeEmail() { ... }`, `export const detectionKb = ...`
- Re-exports in index files (barrel pattern): `export * from "./individual-module.js"`

## Where to Add New Code

**New Email Processing Feature:**
- Core logic: `src/services/email-analyzer.js` (add extraction regex or entity post-processor)
- KB rules: `src/services/detection-kb.js` (add classification rule or brand canonicalization)
- Tests: `tests/email-analyzer.test.js` (add test case, run `node tests/email-analyzer.test.js`)
- Quality gate check: `src/services/quality-gate.js` (if feature affects readiness assessment)

**New Project Type:**
- Create runner service: `src/services/{new-project}-runner.js`
- Add type check in scheduler: `src/services/project-scheduler.js` (add `else if (project.type === "...")`)
- Add test: `tests/{new-project}-runner.test.js`
- HTTP route: Add handler in `src/server.js` (handleApi switch case)

**New Manager Dashboard Feature:**
- UI component: `public/manager.html` (HTML structure) + `public/manager.js` (JavaScript)
- API endpoint: `src/server.js` (handleApi or new route handler)
- Test: Write manual test or add to integration-api.test.js

**New SPA Feature:**
- Component: Add to `public/app.js` (embedded Vue-like components with scoped CSS)
- Styling: Add to `public/styles.css` or inline `<style scoped>` in app.js
- API call: Use fetch to `/api/...` endpoints
- Test: Manual browser test (no automated SPA tests currently)

**New Utility Function:**
- Shared helpers: `src/utils/slug.js` (if general) or inline in service file (if single-use)
- Test: Add to relevant service test file or create new `tests/utils.test.js`

**New Database Table/Model:**
- SQLite (v1): Add to `data/detection-kb.sqlite` schema (no migrations, schema is baked)
- Prisma (v2): Add to `packages/db/prisma/schema.prisma`, run `npm run db:migrate`

**New Integration Client:**
- Env-var registration: `PROJECT2_GOOGLE_CREDENTIALS_B64=...` in Railway env
- DB registration: REST API `/api/detection-kb/api-clients` (POST)
- Auth check: Validate in `src/services/integration-clients.js`

**New Audit/Reporting Script:**
- Location: `scripts/{audit-or-report-name}.py` or `.js`
- Usage: `node scripts/export-detected-article-contexts.js` or `python scripts/audit_prod_json.py`
- Output: JSON, CSV, or text to stdout or file

## Special Directories

**`data/`:**
- Purpose: Runtime data (hot-written at startup and after mutations)
- Generated: Yes (server creates on first run)
- Committed: Baseline files only (projects.json, brand-catalog.json) for seeding; temp files (.proj_tmp.json, etc.) are gitignored

**`.railway-deploy/`:**
- Purpose: CRITICAL SYNC — Mirror of src/ + public/ for Railway deployment
- Generated: No (manually synced by developer or CI)
- Committed: Yes (must stay in sync with src/ or production breaks)
- Rule: After modifying `src/services/*.js` or `public/app.js`, copy to `.railway-deploy/src/services/` or `.railway-deploy/public/`

**`tests/data/`:**
- Purpose: Test fixtures (sample emails, KB dumps)
- Generated: No (checked in)
- Committed: Yes

**`scripts/`:**
- Purpose: Dev/audit scripts (not part of main application)
- Generated: Some (audit reports written to stdout or Excel)
- Committed: Source .py/.js files only (not generated reports)

**V2 Directories (`apps/`, `packages/`):**
- Purpose: Next-gen microservice architecture (coexists with v1, not yet production)
- Generated: Node modules, build artifacts (.next/, dist/)
- Committed: Source TypeScript only, not generated code

---

## Critical Sync Points

**1. `.railway-deploy/` Mirror (HIGHEST PRIORITY):**

After modifying:
- `src/services/*.js` → copy to `.railway-deploy/src/services/`
- `public/app.js` → copy to `.railway-deploy/public/app.js`
- `public/styles.css` → copy to `.railway-deploy/public/styles.css`
- `src/server.js` → copy to `.railway-deploy/src/server.js`
- `package.json` changes → copy to `.railway-deploy/package.json`

**2. Tests:**
- Run `npm test` after any service modification
- Expected: 91 tests, 3 pre-existing failures (docx/xlsx/company-directory unrelated)
- Fix failures before committing

**3. Data Directory:**
- `data/projects.json` — Committed for audit trail, but hot-modified at runtime (use git diff to see state)
- `data/detection-kb.sqlite` — Committed snapshot, but mutations only via REST API (no git tracking during session)
- `data/brand-catalog.json` — Committed baseline, auto-imported at startup

---

*Structure analysis: 2026-04-19*
