# pochta-platform

## What This Is

Email-парсинг платформа для клиента **Siderus**: забирает входящие письма из 28 IMAP-ящиков, классифицирует (клиент / спам / поставщик), извлекает структурированные поля (ФИО, компания, ИНН, телефон, бренды, артикулы, названия товаров) и отдаёт готовые заявки в CRM-систему через **n8n** webhook.

Single-tenant: если появится второй клиент, разворачивается отдельная копия.

## Core Value

**≥50% входящих писем детектятся 7/7 полей perfect** (без мусора, ошибок, дублей) и попадают в n8n без ручной правки. Всё остальное — второстепенно.

---

## Current State (after v1.1)

**Shipped:** v1.1 Detection Quality Sprint — 2026-05-28

### What Works

- **Классификация:** Клиент / Спам / Поставщик через SQLite detection-kb (15 454 алиасов)
- **Артикулы:** zone-aware `article-extractor.js`, UUID/hex rejected, signature-excluded, dedup нормализован
- **ИНН:** FNS mod-11 checksum validation в `normalizeInn` + attachment-content; `validateInnChecksum` exported
- **Позиции/количества:** `finalizeLeadCounts()` — уникальные артикулы × qty (Belgormash: 18-dup→2-positions)
- **ФИО:** `FIO_TEMPLATE_BLOCKLIST` блокирует «Екатерина Попова» и аналогичные robot@ placeholders
- **Телефон:** +375/+86/+994 (BY/CN/AZ) работают через `extractPhoneV2` + `INTL_PHONE_RE`
- **Бренды:** `subjectGroundedBrands` — бренды из Subject выживают в P15/P18 grounding gates; ≤2-char aliases rejected
- **productNames:** `canonicalNameKey` с `stripHtmlResidue`; numbered-list cleanup; audit script честный
- **Аудит:** 4 baselines (v1-v4), `audit_baseline.py` измеряет 8 полей с delta-tracking

### Production Metrics (baseline_v4.json, n=300, seed=42)

| Field | present% | noise_free% |
|-------|----------|-------------|
| fio | 95.3% | 94.0% |
| inn | 76.3% | 76.3% |
| phone | 74.3% | 74.3% |
| article | 75.0% | 74.7% |
| brand | 65.0% | 58.3% |
| product_name | 68.3% | 68.3% |

_Note: brand/article improvements from v1.1 fixes will show in fresh post-deploy analyses._

### Key Decisions (v1.1)

| Decision | Rationale |
|----------|-----------|
| n8n вместо Directus | Клиент переключился на n8n как CRM layer — Directus dropped |
| LLM отключён | Стоимость; все фиксы rule-based |
| ≤2-char alias threshold (не ≤3) | `"abb"` (3-char) = легитимный алиас ABB — пороговое значение понижено |
| Attachment-content.js local copy validateInnChecksum | Нет shared-utils модуля; дублирование алгоритма допустимо |

---

## Next Milestone Goals (v1.2 — TBD)

Приоритеты для следующего milestone определяются через `/gsd:new-milestone`.

**Кандидаты на основе текущих метрик:**
- brand.noise_free 58.3% → цель 70%+ (ghost brands, false positives)
- brand.present 65% → цель 75%+ (missed brands)
- qty/positions: 0% на старом snapshot → измерить на post-deploy данных
- deploy автоматизация: `src/` ↔ `.railway-deploy/src/` sync (REQ-SYNC-01)

---

## Infrastructure

- **Stack:** Node.js ≥25 ESM + SQLite `DatabaseSync` + Python 3 (без фреймворков)
- **Deploy:** Railway, из `.railway-deploy/src/` (зеркало `src/`); изменения копировать в ОБА места
- **Tests:** `node:test` + `node:assert`, `npm test`, pre-existing 2 FAIL (docx/xlsx)
- **Secrets:** base64 env vars (`ADMIN_PASSWORD`, `PROJECT2_*_B64`)
- **Production:** `https://pochta-production.up.railway.app/` — admin/LgxaZ@ZDgNBXgSpnmTHEW6MC

## Out of Scope

- OCR вложений — нет подходящего API
- Multi-tenant / SaaS — single-tenant
- RBAC — один оператор (Станислав)
- v2 монорепо rewrite — до `REQ-V2-AUDIT`
- Directus интеграция — заменена на n8n

---

<details>
<summary>History — v1.0 Entity Extraction Sprint (shipped 2026-04-22)</summary>

Phases 01-09 + 01-detection-fixes: 9 entity extractors (ФИО, компания, ИНН, телефон, email, должность, артикулы, бренды, названия товаров). Accuracy 97.26% refined на 1753 client emails. P0/P1 regression cycles (bugs A01-A06, B01-B03). 15 454 алиасов в KB, brand detection 58%.

[Full archive: milestones/v1.0-ROADMAP.md]

</details>

---
*Last updated: 2026-05-28 — Milestone v1.1 Detection Quality Sprint SHIPPED*
