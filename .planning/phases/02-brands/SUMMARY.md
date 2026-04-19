# Phase 02 — Brand Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-20 · **Deadline:** 2026-04-21

## Goal

Закрыть 6 категорий дефектов TZ в brand extraction (из аудита бизнеса):

1. **Leak non-brands**: NBR, ISO, VAC, item, Single, P.A., EPDM, PTFE, DIN, IEC, VDC, Hz, qty, part
2. **Mass-brand dumps** из catalog/supplier-листов (20-36 брендов на письмо)
3. **Отсутствие канонизации**: `CONDUCTIX-WAMPFLER / Conductix-Wampfler`, `ebm-papst / Ebmpapst`
4. **Alias bundles как single string**: `"Buerkert / Burkert / Bürkert"` вместо трёх записей
5. **Missing brands**: HAWE, ABB, SMC, Rexroth, GEMÜ (через расширение KB alias map)
6. **No zoning**: signature/quoted/footer pollute brand field

## Delivered

Три новых модуля + два integration-point в `email-analyzer.js`:

| Файл | Назначение |
|------|-----------|
| `src/services/brand-negative-filters.js` | 4 negative dictionaries (materials, standards, units, stopwords) + `isNonBrandToken` predicate |
| `src/services/brand-normalizer.js` | `splitAliasBundle`, `canonicalizeBrand(brand, aliasMap)`, `dedupCanonical` с выбором представителя (mixed-case > Title > UPPER) |
| `src/services/brand-extractor.js` | Фасад `sanitizeBrands` (split → filter → canonicalize → dedup → classify) + `classifyBrandContext` с порогами (≥6 warning, ≥8 suspicious, ≥13 catalog) |

Расширение `detection-kb.js`:
- `BRAND_FALSE_POSITIVE_ALIASES` дополнен negative-dict токенами (NBR/EPDM/PTFE/ISO/DIN/IEC/GOST/VAC/VDC/Hz/kW/item/part/qty/model/type/series и др.)

Интеграция в `email-analyzer.js`:
- После `filterOwnBrands` в classification: `sanitizeBrands(raw, {aliasMap})` → `classification.detectedBrands`, `classification.brandContext`, `classification.brandMassFlag`
- После assembly `lead.detectedBrands`: аналогичный pipeline → `lead.brandContext`, `lead.brandMassFlag`

## Tests

- `tests/brand-extractor.test.js` — **25/25 green**
  - negative dict (materials/standards/units/stopwords)
  - real brands preserved (Siemens, ABB, Festo, HAWE, SMC, Rexroth, GEMÜ, ebm-papst)
  - `splitAliasBundle` корректно режет только `/\s+[/|]\s+/` (не ломает `WTO/MAS`)
  - `canonicalizeBrand` lowercase lookup в Map
  - `dedupCanonical` сворачивает surface-forms
  - `sanitizeBrands` end-to-end pipeline
  - mass-brand guard все 4 контекста (normal/warning/suspicious/catalog)
- Полный suite: **141 PASS / 3 FAIL** (3 pre-existing — docx/xlsx attachment parsers, R. Stahl alias — не связано с этим phase)

## Key design decisions

1. **Консервативный post-filter, не full replacement** — existing pipeline (6k+ строк) остаётся источником raw кандидатов, sanitize прогоняется финальным слоем. Иначе риск сломать legitimate detection.
2. **Alias map передаётся extern** — `detection-kb.js` строит Map<alias_lower, canonical>, а `brand-normalizer` чистый (без DB impact). Тестируется без fixture.
3. **Split только на `/\s+[/|]\s+/`** — slash с окружающими пробелами. `Buerkert / Burkert / Bürkert` → 3 записи; `WTO/MAS` остаётся одним токеном.
4. **Representative picking** — mixed-case приоритет, потом all-lower, потом ALL-UPPER; штраф за длину. Схлопывает `CONDUCTIX-WAMPFLER`→`Conductix-Wampfler`.
5. **Mass-brand thresholds без auto-reject** — 13+ не режем автоматом, а помечаем `brandContext: "catalog"` + `brandMassFlag: true`. Решение о рестрикции — на стороне UI/quality-gate.
6. **Negative dict на 2 уровнях** — в `BRAND_FALSE_POSITIVE_ALIASES` (detection-kb блокирует на чтении KB) + в `isNonBrandToken` (пост-фильтр после сборки). Двойная защита на случай, если токен попадает из HTML/artefacts, а не из KB.
7. **Unit/numeric reject** — `10Bar`, `63A`, `5P`, `IP66`, `50Hz`, чисто цифровые, одиночные латинские буквы.

## Railway deploy

Файлы синхронизированы в `.railway-deploy/src/services/` (diff пуст):
`brand-negative-filters.js`, `brand-normalizer.js`, `brand-extractor.js`,
`detection-kb.js`, `email-analyzer.js`.

## Out of scope (следующие фазы)

- Zoning-aware extraction (signature/quoted strip) — на текущий момент используем
  существующий `filterOwnBrands` + `stripBrandCapabilityListText`; полная замена
  zoning-based source selection выходит за рамки phase.
- Расширение KB alias map для HAWE/GEMÜ/SMC/Rexroth — отдельный KB-таск, данные уже есть (15 454 алиасов), но ручная проверка канонических форм требуется.
- Integration метрик brandContext в XLSX/UI (показывать catalog/suspicious в review).
