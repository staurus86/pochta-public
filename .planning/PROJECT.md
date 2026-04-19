# pochta-platform

## What This Is

Email-парсинг платформа для клиента **Siderus**: забирает входящие письма из 28 IMAP-ящиков, классифицирует (клиент / спам / поставщик), извлекает структурированные поля (ФИО, компания, ИНН, телефон, бренды, артикулы, названия товаров) и отдаёт готовые заявки в **Directus** — откуда их забирает CRM клиента. Основной пользователь-оператор — Станислав (sk-seo.ru). Single-tenant: если появится второй клиент, разворачивается отдельная копия.

## Core Value

**≥50% входящих писем детектятся 7/7 полей perfect** (без мусора, ошибок, дублей) и попадают в Directus, откуда CRM Siderus забирает их без ручной правки. Всё остальное — второстепенно.

## Requirements

### Validated

<!-- Shipped and confirmed valuable (inferred from existing codebase). -->

- ✓ **DETECT-CORE**: email → classification (Клиент / Спам / Поставщик) через SQLite detection-kb (15 454 aliases, 81.4% brand detection) — existing
- ✓ **DETECT-BRAND**: brand extraction из KB + sender profiles + body grounding — existing (Batches A-J)
- ✓ **DETECT-CONTACT**: ФИО / компания / ИНН / телефон / email из подписи + форм robot/tilda — existing
- ✓ **DETECT-ARTICLES**: артикулы + количества + названия товаров из тела письма — existing (но имеет известные дефекты, см. Active)
- ✓ **INTAKE-IMAP**: fetch из 28 ящиков через `project 3/mailbox_file_runner.py` (IMAP → stdout JSON) — existing
- ✓ **STORAGE-CORPUS**: SQLite message corpus + JSON `projects.json` + brand-catalog.json — existing
- ✓ **UI-INBOX**: manager SPA (`public/app.js`, `manager.html`) с фильтрами, деталями заявки, XLSX/JSON экспортом — existing
- ✓ **AUTH-GATE**: login overlay с `ADMIN_PASSWORD` env, session-based — existing
- ✓ **RUNNER-TENDER**: `project 2/tender_parser.py` (SAP SRM → Google Sheets) — existing
- ✓ **DEPLOY-RAILWAY**: деплой из `.railway-deploy/src/` (зеркало `src/`) + Docker + Python venv — existing
- ✓ **REANALYZE**: endpoint переанализа всего корпуса с LLM cache + post-processor re-run — existing (commit `30e1c0c`)

### Active

<!-- Current scope for vторник-MVP + parameter-quality sprint. -->

**MVP blocker (до вторника 2026-04-21):**
- [ ] **REQ-K-ARTICLES-01**: Artикулы quality — 0 хладагентов-как-артикулы (R407C/R404A), 0 UUID/hash в articles, сохранение префиксов WR-/MWR- после тире-пробела, productNames без raw строк `1. X - N шт.`, без дублей cleaned↔raw, без фрагментов фраз («Вас сообщить…»), без бренда-в-productName («FESTO:»)
- [ ] **REQ-K-COUNT-01**: positions = uniq articles, totalQty = sum qty по уникальным позициям (Belgormash: 2 позиции / 5 шт, не 18/7)
- [ ] **REQ-BRAND-01**: Бренды quality — перекрыть остаточные false positives (address/city-as-brand, semantic-token шум, UI-labels)
- [ ] **REQ-DIRECTUS-01**: Directus client (POST `/items/leads`) + schema-proposal + env-config (`DIRECTUS_URL` / `DIRECTUS_TOKEN` / `DIRECTUS_ENABLED`) + idempotency (message-id)
- [ ] **REQ-DIRECTUS-02**: DRY-RUN режим по умолчанию + retry + DLQ + status per lead (synced / queued / failed)
- [ ] **REQ-DIRECTUS-03**: README/collection-schema.md — документ для клиента: какую коллекцию поднять, какие поля, какой API-token выдать
- [ ] **REQ-MVP-METRIC-01**: ≥50% писем детектят 7/7 полей perfect (audit-script метрика на production корпусе)

**Post-MVP parameter-phases (порядок зафиксирован):**
- [ ] **REQ-PRODNAMES-01**: Названия товаров quality (отдельная phase после MVP)
- [ ] **REQ-COMPANY-01**: Компания / ИНН quality
- [ ] **REQ-PERSON-01**: ФИО / должность quality
- [ ] **REQ-PHONE-01**: Телефон quality (intl fallback +375/+86/+994, phone extension strip)
- [ ] **REQ-EMAIL-01**: E-mail quality

**Infrastructure backlog:**
- [ ] **REQ-V2-AUDIT**: Аудит v2 монорепо (`apps/web` Next.js, `apps/api` Fastify, `apps/worker` BullMQ, `packages/db` Prisma) — понять что это, оставить или удалить
- [ ] **REQ-SYNC-01**: Разобраться с sync `src/` ↔ `.railway-deploy/src/` — устранить ручное дублирование (git subdir? build step? single source of truth?)
- [ ] **REQ-MANAGER-UX**: Улучшить manager UI для Станислава как основного оператора

### Out of Scope

- **OCR вложений** — нет адекватного API; отложено до появления подходящего решения
- **Multi-tenant / SaaS** — single-tenant; для других клиентов разворачиваем копию деплоя и переконфигурируем
- **RBAC / ролевая модель** — один оператор (Станислав) + Siderus; ролей нет
- **Staging environment** — отложено, пока риск «каждый push в прод» приемлем
- **v2 монорепо rewrite** — до `REQ-V2-AUDIT` решения не трогаем, продолжаем в v1 (`src/server.js`, raw `node:http`)
- **Автоматические ответы клиентам** — вне scope парсера
- **Прямая интеграция с CRM** — CRM забирает из Directus, не из нашей платформы напрямую
- **Webhook push в CRM клиента** — только Directus; webhook-dispatcher.js трогать не будем

## Context

**Продукт в production** на Railway (`https://pochta-production.up.railway.app/`), активно используется Siderus. За предыдущие 30+ дней прошло 10 batch-спринтов повышения accuracy (A-J), текущая детект-метрика 97.26% refined accuracy на 1753 Клиент-письмах (batch-level), но MVP-метрика «7/7 полей perfect» значительно ниже — пользователь видит raw productNames, R407CR404A, UUID как артикул.

**Codebase mapped** в `.planning/codebase/`:
- `STACK.md` — Node 25 ESM + SQLite `DatabaseSync` + Python venv, без фреймворков (raw `node:http`)
- `ARCHITECTURE.md` — 3 типа проектов (email-parser / tender-importer / mailbox-file-parser), Node ↔ Python через `spawn + SUMMARY_JSON`
- `CONCERNS.md` — 13 областей tech-debt: `src/` vs `.railway-deploy/src/` drift, regex fragility, отсутствие staging, base64-secrets в env, v2 monorepo с неясной судьбой

**История работы** в `memory/MEMORY.md` — детальный лог 10+ batches, известные дефекты, deploy-flow, текущие метрики.

**Интеграционные файлы уже есть** в `src/services/` (`integration-api.js`, `integration-openapi.js`, `integration-contract.js`, `webhook-dispatcher.js`) — generic REST + OpenAPI, но НЕ Directus-специфичные. В `.railway-deploy/src/` версии рассинхронизированы с `src/` (4B-1.5KB разница), будет разобрано при старте Phase 3.

## Constraints

- **Tech stack**: Node.js ≥ 25 ESM (обязательно — `node:sqlite` `DatabaseSync`), Python 3 (`python` не `python3` на Windows), без фреймворков (raw `node:http/fs/crypto`). Не вводим Express/Fastify в v1 пока `REQ-V2-AUDIT` не решён
- **Timeline (MVP)**: вторник 2026-04-21 — жёсткий deadline. Всё что не входит в MVP-блок — после вторника
- **Deploy**: каждое изменение **должно быть** скопировано в `.railway-deploy/src/` (зеркало). Нарушение приводит к «правки не применились» (см. history commit `83e04b9`)
- **Tests**: все batch-фиксы обязаны иметь regression-тесты (`tests/batch-*-fixes.test.js`) через `node:test` + `node:assert`. Известны 3 pre-existing fails на Windows (`docx/xlsx` tar, `company-directory`) — игнорируются
- **Compatibility**: Directus instance ещё не поднят — наша сторона готовится полностью, клиент разворачивает Directus + применяет предложенную нами схему
- **Budget**: нет внешних API costs кроме Claude LLM (активен на reanalyze path). OCR-API отложен именно из-за cost concern
- **Security**: секреты через base64 env vars (`PROJECT2_GOOGLE_CREDENTIALS_B64`, `ADMIN_PASSWORD`, etc.) — не коммитятся; Directus-token добавится в тот же паттерн (`DIRECTUS_TOKEN`)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single-tenant, Siderus only | Мultiплицировать копию деплоя для других клиентов проще чем строить multi-tenant | — Pending |
| Parameter-sequenced quality phases, не batch-треадмилл | Каждый параметр (артикулы → бренды → productNames → …) доводится до 95%+ перед переходом к следующему | — Pending |
| Directus как middleware | Клиент забирает заявки из Directus, не из нашего API; снимает с нас нагрузку на CRM-specific протоколы | — Pending |
| OCR отложен | Нет подходящего API (Claude Vision/Tesseract/GPT-4o все имеют ограничения); вложения с реквизитами обрабатываются позже | — Pending |
| v2 monorepo не трогаем до аудита | Не знаем что это и зачем писалось; удалять без разбора опасно | — Pending |
| Остаёмся на raw `node:http` в v1 | Фреймворк (Fastify/Express) = большая миграция; в scope MVP не влезет | — Pending |
| Reanalyze path пере-прогоняет post-processors после LLM cache restore | Иначе правки regex не применяются к старым письмам (commit `30e1c0c`) | ✓ Good |
| Детекция с body-grounding + signature-cluster filter + image alt-chain strip | Убирает ghost brands из подписей, alt-text, capability lists | ✓ Good (commits `29f5456`, `70e4722`, `5ea1dfa`) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-19 after initialization (brownfield — existing production system at Siderus)*
