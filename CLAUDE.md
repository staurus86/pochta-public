# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**pochta-platform** — MVP-платформа для парсинга входящих email-писем, классификации (клиент / спам / поставщик) и маршрутизации заявок в CRM. Написана на Node.js (ESM, без фреймворков) с Python-скриптами для IMAP-парсинга.

## Commands

```bash
npm install                # установка зависимостей
npm run dev                # запуск dev-сервера (node --watch)
npm start                  # запуск production-сервера
npm test                   # запуск всех тестов

# запуск одного теста:
node tests/email-analyzer.test.js

# Python-зависимости (для project 2/3 runners):
python -m pip install -r requirements.txt
```

## Architecture

### HTTP-сервер (`src/server.js`)
Чистый `node:http` без Express. Роутинг реализован через ручной парсинг `url.pathname` и regex-матчи. Статика раздаётся из `public/`. Healthcheck: `GET /api/health`.

### Три типа проектов
Платформа управляет тремя типами проектов, хранящимися в `data/projects.json` через `ProjectsStore`:

1. **`email-parser`** — анализ одного письма через `POST /api/projects/:id/analyze`. Цепочка: `email-analyzer.js` → `detection-kb.js` (классификация) → `crm-matcher.js` (поиск клиента в CRM) → результат с `intakeFlow`.

2. **`tender-importer`** — запуск Python-скрипта (`project 2/tender_parser.py`) через `child_process.spawn`. IMAP → SAP SRM → Google Sheets. Обмен данными: Python выводит `SUMMARY_JSON={}` в stdout.

3. **`mailbox-file-parser`** — массовый забор писем из нескольких почтовых ящиков (`project 3/mailbox_file_runner.py`). Конфигурация из TSV-файла (`1.txt`). Python выводит `PROJECT3_JSON={}` в stdout. Каждое письмо прогоняется через `email-analyzer` и сохраняется в SQLite-корпус.

### Detection Knowledge Base (`detection-kb.js`)
SQLite-БД (`node:sqlite` — `DatabaseSync`) в `data/detection-kb.sqlite`. Хранит правила классификации, brand aliases, sender profiles, field patterns и message corpus. Управляется через REST API (`/api/detection-kb/*`). Сидирует дефолтные правила при первом запуске.

### Планировщик (`project-scheduler.js`)
`setInterval` (1 час) проверяет расписания проектов и автоматически запускает runner-ы. Расписание привязано к таймзоне через `Intl.DateTimeFormat`.

### Хранение данных
- `data/projects.json` — проекты, анализы, запуски (JSON, `ProjectsStore`)
- `data/detection-kb.sqlite` — база знаний классификатора
- `project 2/` — рабочая директория tender-importer (credentials, seen_emails, лог)
- `project 3/` — рабочая директория mailbox-file-parser

### Node.js ↔ Python интеграция
Python-процессы запускаются через `spawn("python", ...)` с передачей конфигурации через env-переменные. Результат парсится из stdout по маркерам `SUMMARY_JSON=` и `PROJECT3_JSON=`.

## Conventions

- **ESM modules** (`"type": "module"` в package.json), все импорты через `import`
- **Node.js >= 25** (используется `node:sqlite` — `DatabaseSync`)
- **Без фреймворков** — чистый `node:http`, `node:fs`, `node:crypto`
- **camelCase** для переменных/функций, **kebab-case** для файлов
- **4 пробела** для отступов
- Тесты — plain Node.js с `node:assert` и `node:test`, без test-фреймворков

## Deployment

Деплоится на Railway. Dockerfile на базе `node:25-bookworm-slim` с Python venv. Конфигурация в `railway.json` и `nixpacks.toml`. Секреты (credentials, seen state) передаются через base64-encoded env-переменные (`PROJECT2_GOOGLE_CREDENTIALS_B64`, `PROJECT2_SEEN_B64`, `PROJECT2_LOG_B64`).

---

## New Email Module (v2)

### Monorepo Structure
```
apps/
  web/       — Next.js 15 frontend (premium CRM dashboard)
  api/       — Fastify backend API
  worker/    — BullMQ email processing workers
packages/
  db/        — Prisma schema + client (@pochta/db)
  shared/    — Shared types, constants (@pochta/shared)
docs/
  ARCHITECTURE.md — full architecture spec
```

### Commands (new module)
```bash
# Local development with Docker (Postgres + Redis + MinIO)
docker compose up postgres redis minio

# Database
npm run db:generate          # generate Prisma client
npm run db:migrate           # run migrations
npm run db:push              # push schema to DB
npm run db:studio            # Prisma Studio GUI

# Services
npm run dev:api              # Fastify API on :4000
npm run dev:web              # Next.js on :3000
npm run dev:worker           # BullMQ workers

# Full stack via Docker
docker compose up
```

### New Architecture
- **Frontend**: Next.js 15, React 19, Tailwind CSS, shadcn/ui-style components, TanStack Query, Zustand
- **Backend**: Fastify with JWT auth, RBAC, Zod validation, Swagger
- **Workers**: 7 BullMQ workers (fetch → parse → classify → extract → crm-match → sync + attachment-process)
- **DB**: PostgreSQL via Prisma (27 models, 12 enums)
- **Queue**: Redis + BullMQ with DLQ, exponential backoff, idempotency
- **Storage**: S3-compatible (Tigris on Railway, MinIO locally)
- **LLM**: Optional AI layer for classification/extraction (Claude API)

### Railway Services
- `web` — Next.js frontend (port 3000)
- `api` — Fastify backend (port 4000)
- `worker` — BullMQ workers (no port)
- PostgreSQL plugin
- Redis plugin
- Tigris object storage

### Feature Flags
- `SYNC_DRY_RUN` — disable CRM writes
- `AI_ENABLED` — enable LLM classification/extraction
- `SHADOW_MODE` — run new pipeline in parallel without affecting old system

### Email Pipeline States
received → normalized → parsed → classified → entities_extracted → crm_matched → awaiting_review → ready_to_sync → synced | failed | quarantined
