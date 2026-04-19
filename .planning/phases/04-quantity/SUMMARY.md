# Phase 04 — Quantity Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-20 · **Deadline:** 2026-04-21

## Goal

Закрыть 11 категорий дефектов TZ в поле «Количество» (из бизнес-аудита):

1. **Нет отдельного qty-поля в XLSX** → добавлены колонки «Количество» + «Ед.»
2. **Глобальные формы qty**: `2шт`, `82ШТ`, `2 шт`, `2 pcs`
3. **Labeled prefix**: `в кол-ве 5 шт`, `Количество: 10`, `qty 7`
4. **Pack structure**: `3 комплекта по 4 шт` → pack+item+totalCount
5. **Technical-spec false positives**: `90 мм`, `240V`, `50Hz`, `2.20 kW`, `1500 min-1`, `250 bar`, `60 °C`
6. **Phone/date/hours false positives**: `+375 33 343-99-61`, `21.04.2026`, `9.00-18.00`
7. **Article-boundary**: `9226513-4 шт` → qty=4 (не 13)
8. **Locale ambiguity**: `1,000 шт` → 1000 (ambiguous flag)
9. **Non-count unit rejection**: `м/кг/л` → rejected (не count)
10. **Outlier rejection**: qty > 100k → reject (likely ID/article)
11. **Unit canonicalization**: `штук/штуки/pcs/ea` → `шт`; `комплект/к-т/set` → `компл`

## Delivered

Три новых модуля + интеграция + XLSX колонки:

| Файл | Назначение |
|------|-----------|
| `src/services/quantity-filters.js` | 11 predicates: `isDimensionLike`, `isWeightLike`, `isPowerLike`, `isVoltageLike`, `isPressureLike`, `isFrequencyLike`, `isRpmLike`, `isTemperatureLike`, `isPhoneLike`, `isDateLike`, `isHoursLike` + composite `isTechnicalSpec` |
| `src/services/quantity-normalizer.js` | `normalizeQtyUnit` (канонизация: штук/штука/pcs/ea → шт), `parseQuantityForm` (2шт/82ШТ/2.5 л), `parseInKolve` (в кол-ве 5 шт / Количество: 10), `parsePackStructure` (3 компл. по 4 шт), `parseLocaleNumeric` (1,000 vs 1.5 thousand-sep awareness) |
| `src/services/quantity-extractor.js` | Facade `extractQuantities(text, {articles})` → `{primary, items, rejected, needsReview}` с pipeline: article-boundary → locale-mask → pack → labeled → inline |

Интеграция в `email-analyzer.js` (после Phase 3 sanitization):
- `lead.primaryQuantity` — число из primary candidate (по priority: pack > article_boundary > labeled > inline > locale)
- `lead.quantityUnit` — канон. unit (шт/компл/пар/…)
- `lead.totalQuantity` — сумма из items (pack.totalCount учитывается)
- `lead.quantitiesClean[]` — все принятые {value, unit, source}
- `lead.quantitiesRejected[]` — rejected с reason (trimmed 20, debug)
- `lead.quantityNeedsReview` — флаг для ambiguous locale (`1,000 шт`)
- In-place sanitize: `lead.lineItems[].unit` → канон, `quantity` → range-check (0 < qty ≤ 100 000)

XLSX (`public/app.js`) — добавлены 2 новые колонки между «Название товара» и «LLM Тип запроса»:
- **Количество** — сумма qty из lineItems > `primaryQuantity` > `totalQuantity`
- **Ед.** — unit (шт по умолчанию)

## Tests

- `tests/quantity-extractor.test.js` — **39/39 green**
  - Filters: dimension/weight/power/voltage/pressure/frequency/rpm/temperature/phone/date/hours + composite
  - Normalizer: unit canon, value+unit parse, fractional, locale (1,000 / 10 000 / 2,5), `в кол-ве`, pack structure
  - Facade: простые, glued `2шт`, `82ШТ`, `в кол-ве`, pack, filters, article-boundary (`9226513-4 шт`, `11TC080-1шт`), multi-line, locale `1,000 шт` (ambiguous), outlier reject, empty input, dedup, object input, rejected with reason
- Полный suite: **141 PASS / 3 FAIL** (3 pre-existing — docx/xlsx attachment parsers, R. Stahl alias — не связано с этим phase)

## Key design decisions

1. **Priority cascade**: `pack (5) > article_boundary (4) > labeled (3) > inline (2) > locale (1)`. Pack найден → inline не запускается на той же line (избегаем dubbed "3 + 4" как 2 candidate).
2. **Locale-first detection + masking** — `"Партия 1,000 шт"` сначала проверяется на en-locale (`1,000 шт` = 1000 thousand-sep), потом masked → INLINE_QTY_RE не матчит `000 шт` как value=0.
3. **Article-boundary priority** — если передан `{articles: [...]}`, сначала пробуем split `article + hyphen + qty`, чтобы `9226513-4 шт` дал qty=4, а не `13` из хвоста артикула.
4. **PHONE pattern tightened** — строгая проверка: `+` intl OR `(XXX)` OR 3+ digit groups `XX-XX-XX-XX`. Артикулы типа `H0019-0008-28` больше НЕ ложно матчат phone (fixed after regression test).
5. **Только count-units** принимаются как qty: `шт/компл/пар/уп/бух/рул/ед`. Юниты `м/кг/л` reject (это dimensions/weight/volume).
6. **JS `\b` не работает с кириллицей** → unit boundaries через negative lookahead `(?![A-Za-zА-Яа-яЁё])` (та же проблема, что в Phase 1/2/3).
7. **`в кол-ве` / `кол-во` / `Кол-ве`** — падежи через `кол(?:ичеств[оаеу]|-?в[оеау]|\\.)?` (родительный/предложный).
8. **Consumer-side sanitize, не replacement** — существующий `PRODUCT_QTY_PATTERN` и line-item qty extraction сохранены; новый extractor добавляет отдельные поля.
9. **In-place lineItems sanitize** — только канон unit + range-check. `isTechnicalSpec` на sourceLine НЕ применяется (ложные позитивы на длинных описаниях с артикулами-тире).
10. **Outlier threshold 100k** — больше = likely ID/article (было >1B в pre-existing `outlier_quantity` check). Для qty специально строже.

## Закрытые кейсы из аудита

| Паттерн | Пример input | Output |
|---------|-------------|--------|
| Simple | `Клапан - 2 шт` | `{value:2, unit:"шт"}` |
| Glued | `Муфта 2шт` | `{value:2, unit:"шт"}` |
| Uppercase | `Заказ 82ШТ` | `{value:82, unit:"шт"}` |
| Labeled | `в кол-ве 5 шт` | `{value:5, unit:"шт"}` |
| Colon | `Количество: 10` | `{value:10, unit:"шт"}` |
| Pack | `3 комплекта по 4 шт` | `{value:3, unit:"компл", itemCount:4, totalCount:12}` |
| Dimension | `Клапан 90 мм` | `primary=null` (tech spec) |
| Power | `Двигатель 2.20 kW` | `primary=null` |
| Voltage | `240V 50Hz` | `primary=null` |
| Pressure | `250 bar` | `primary=null` |
| Frequency | `50/60HZ` | `primary=null` |
| RPM | `1500 min-1` | `primary=null` |
| Phone | `+375 33 343-99-61` | `primary=null` |
| Date | `21.04.2026` | `primary=null` |
| Hours | `9.00-18.00` | `primary=null` |
| Article-boundary | `9226513 - 4 шт` | `{value:4, unit:"шт"}` (не 13) |
| Glued article | `11TC080-1шт` | `{value:1, unit:"шт"}` |
| Multi-line | 3 строки с `- 3/5/10 шт` | 3 items, primary=pack или first |
| Locale en | `Партия 1,000 шт` | `{value:1000, unit:"шт", ambiguous:true}` |
| Outlier | `ИНН 7722334455` | `primary=null` |
| Mixed | `DN 65 - 1 шт` | `{value:1, unit:"шт"}` (count выигрывает) |

## Railway deploy

Файлы синхронизированы в `.railway-deploy/`:
- `.railway-deploy/src/services/quantity-filters.js`
- `.railway-deploy/src/services/quantity-normalizer.js`
- `.railway-deploy/src/services/quantity-extractor.js`
- `.railway-deploy/src/services/email-analyzer.js`
- `.railway-deploy/public/app.js`

Все diffs пустые.

## Out of scope (следующие фазы)

- **UI chip/section** для primaryQuantity в правой панели — сейчас видно только в XLSX; отдельная колонка в inbox-grid — следующий sprint.
- **Quantity zoning** — сейчас qty ищется по всему `primaryBody + subject + lineItem.sourceLine`. Zoning (priority: form_fields > signature > body > subject) — следующий sprint если метрики покажут необходимость.
- **Price/currency extraction** — TZ focus был quantity, не price.
- **Lead-time/delivery date extraction** — отдельная сущность.
- Pre-existing docx/xlsx/brand-alias failures.
