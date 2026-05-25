# Research Summary — v1.1 Detection Quality Sprint

**Date:** 2026-05-25
**Confidence:** HIGH across all four research areas

---

## Executive Summary

pochta-platform v1.1 is a targeted accuracy sprint on a working production system. The system already parses ~2500 Russian B2B industrial emails with contact-field extraction working correctly via zone-aware facades (phases 05-09). The sprint closes 7 field-level defects reported by client Siderus.

**Highest-leverage single action:** wire `article-extractor.js` — a complete zone-aware facade that exists in `src/services/` but is **imported nowhere** — into `extractLead()` inside `email-analyzer.js`, replacing a 500-line unzoned inline regex cascade.

All other P1 fixes are small targeted patches. No new NLP frameworks needed — all improvements are regex/rule-based. Three small library additions are optional: `libphonenumber-js/min` (phones), `ru-validation-codes` (INN checksum), `fast-levenshtein` (brand fuzzy match).

---

## Stack Additions

| Addition | Purpose | Size | Required? |
|----------|---------|------|-----------|
| `libphonenumber-js/min` | International phone normalization (+375/+86/+994) | ~80 KB ESM | Recommended |
| `ru-validation-codes` or inline | INN checksum (10-line algorithm, official FTS weights) | tiny | Optional |
| Nothing else | All extraction improvements are pure regex | — | — |

No Russian NLP library is worth adding — all are English-first or Python-only.

---

## Feature Table Stakes (must fix this milestone)

### Articles
- Wire `article-extractor.js` into `extractLead()` (zone-aware, unzoned = root cause)
- Reject phone fragments 3-3-2-2 format not yet fully covered
- Reject UUID/form metadata tokens
- Fix dedup: `MD-025-6L` ≡ `MD 025-6L` (BUG-A06)

### Quantity
- Fix positions/totalQty: positions = unique article count, totalQty = sum (Belgormash bug)
- Depends on article list being clean first

### ИНН
- Propagate ИНН from attachment реквизиты text to `sender.inn`
- INN checksum validation: reject 10-digit numbers failing mod-11 checksum
- Currently only 18% of letters have ИНН extracted

### ФИО
- Template contamination blocklist: "Екатерина Попова" from robot@siderus.ru form body appears for 3+ different companies
- Russian surname suffix confidence scoring (`-ов/-ова/-ский/-ская/-ин/-ич/-ович/-овна`)

### Телефон
- International format support (+375 Belarus, +86 China, +994 Azerbaijan) — 81 missing phones
- `libphonenumber-js/min` replaces hand-rolled `canonicalToPlus7`

### Бренды
- Subject-line brand priority boost (not currently prioritized)
- Alias minimum-length rule (≤3 char aliases rejected as too noisy)
- Currently 58% detection rate

### Названия товаров
- Strip raw "1. X - N шт." format from productNames output
- One-line normalizer fix

---

## Architecture Findings

### Critical Discovery
`article-extractor.js` is a **complete, zone-aware facade** that was built during the entity extraction sprint but **has 0 importers**. `email-analyzer.js` still uses a 500-line inline cascade on the raw unzoned body — this is the primary source of signature-zone and quoted-thread contamination in articles.

### Build Order (Suggested 4 Phases)

| Phase | Focus | Key Change |
|-------|-------|-----------|
| 10 | Audit + Baseline | Fetch n8n feedback + run 50-letter manual audit → bug report |
| 11 | Article Foundation | Wire `article-extractor.js` into `extractLead()` + UUID/phone filters + dedup fix |
| 12 | Quantity + INN | Fix positions/totalQty + INN from attachments + INN checksum |
| 13 | Contact Fields | ФИО template guard + phone international + surname scoring |
| 14 | Brands + ProductNames | Subject boost + alias length rule + raw format strip |

---

## Top Pitfalls

| Risk | Severity | Prevention |
|------|----------|-----------|
| Over-tightening article filters kills valid SKUs | HIGH | Paired positive+negative tests for every new filter |
| `src/` vs `.railway-deploy/src/` drift | HIGH | Mandatory sync step in every commit |
| Pipeline ordering desync (repeat of commit 375978f) | MEDIUM | Code comment + defensive assertion at hydration points |
| Signature cluster filter misidentifies request brands | MEDIUM | Body-position check before cluster suppression |
| LLM cache bypass skips new post-processors | MEDIUM | Reanalysis test after every pipeline change |

---

## Research Flags

No additional research needed. All implementation points are identified:
- `article-extractor.js:0` importers → wire into `email-analyzer.js:extractLead()`
- `fio-extractor.js` → add `likelySurname()` predicate
- `phone-normalizer.js` → replace with `libphonenumber-js/min`
- `article-filters.js` → add INN checksum inline (10 lines)
- `product-name-normalizer.js` → strip `^\d+\.\s+.+\s+-\s+\d+\s+шт\.?` format
