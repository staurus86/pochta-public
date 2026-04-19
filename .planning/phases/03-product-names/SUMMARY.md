# Phase 03 — Product Name Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-20 · **Deadline:** 2026-04-21

## Goal

Закрыть 7 категорий дефектов TZ в поле «Название товара» (из бизнес-аудита 1826 строк):

1. **Overcapture**: 164/50/21 строк >200/500/1000 символов
2. **Multi-item collapse**: 259 строк = список, 319 с qty markers
3. **Contact/signature contamination**: +375, 9.00-18.00, «Дордаль Артем Инженер-механик», Tel:
4. **Document/accounting contamination**: «паспорт физического лица», «акт сверки», «карточка предприятия», «03. Поступление на расчётный счёт»
5. **HTML/PDF/doc noise**: `<span>`, `&#1058;`, `/Document /FillIn /Delete`, `WordSection`, `page:`
6. **Code-only fallback**: `4.5015-24`, `EA4073`, `8-10-375-17-225-10-95` без human-readable product noun
7. **Under-extraction**: 750 пустых при наличии brand/article, 190 с явными товарными терминами

## Delivered

Три новых модуля + интеграция в pipeline:

| Файл | Назначение |
|------|-----------|
| `src/services/product-name-filters.js` | 8 predicates: `isPhoneLike`, `isContactLike`, `isDocumentLike`, `isPdfOpsLike`, `isHtmlResidueLike`, `isCodeOnly`, `isOverlong`, `isMultiItemList` + composite `isBadProductName` |
| `src/services/product-name-normalizer.js` | 7 strippers + facade: `stripHtmlResidue`, `stripPdfOps`, `stripContactTail`, `stripQuantityTail`, `collapseWhitespace`, `capLength` (sentence-aware), `splitMultiItem`, `normalizeProductName` |
| `src/services/product-name-extractor.js` | Facade `sanitizeProductNames(raw, {subject, maxLen})` → `{names, primary, items, rejected}` с pipeline: unwrap objects → multi-item split → normalize → filter → dedup → pick primary → subject fallback |

Интеграция в `email-analyzer.js` (после dedup productNames/lineItems):
- `lead.productNamePrimary` — короткое чистое имя (≤200 символов, субъект-aware)
- `lead.productLineItems[]` — массив чистых имён если multi-item
- `lead.productNamesClean[]` — все принятые нормализованные имена
- `lead.productNamesRejected[]` — rejected с reason (debug, trimmed 20)
- In-place sanitize: `lead.productNames[].name` — normalize + cap до 200, bad → null
- In-place sanitize: `lead.lineItems[].descriptionRu` — normalize + cap + reject noise

## Tests

- `tests/product-name-extractor.test.js` — **35/35 green**
  - Filters: phone/contact/doc/pdf/html/code/overlong/multi-item + composite
  - Normalizer: HTML strip (+entity decode), PDF ops strip, contact tail, qty tail, whitespace, length cap (sentence-aware), multi-item split
  - Facade: reject bad, pick primary (subject-aware), length cap, multi-item → items[], subject fallback, dedup, HTML/PDF cleaned, code-only rejected, object unwrap, real-world noisy
- Полный suite: **141 PASS / 3 FAIL** (3 pre-existing — docx/xlsx attachment parsers, R. Stahl alias — не связано с этим phase)

## Key design decisions

1. **JS `\b` не матчит кириллицу** → все predicates на русских словах без `\b`; там где нужна точность (NAME_TITLE/REGARDS/DOC) используются прямые substring-матчи с учётом контекста. (Та же проблема что в Phase 1/2.)
2. **Consumer-side sanitize, не replacement** — существующий `extractProductNames` и `lineItem.descriptionRu` pipeline сохранены; sanitize применяется поверх как post-filter. Защищает ~6k строк legacy от regression.
3. **In-place mutation** `productNames[].name` и `lineItems[].descriptionRu` — минимальная инвазия, UI/XLSX продолжают работать через `getLeadProductNameList()` (уже читает оба источника).
4. **Sentence-aware capLength** — не рубит посреди слова, приоритет `. ! ?` > `, ` > ` ` > hard cut. Cap = 200 (по аудиту 164 строк были overlong).
5. **splitMultiItem только на `;` и `\n`** — не на запятую (запятая часто внутри нормального имени: «Клапан, нерж.сталь 316L»).
6. **Primary picking scoring** — subject-aligned (+5 за совпадающий токен), длина 12-80 (+4), brand-like капслок+слово (+2), штраф за >150 символов и >3 знаков препинания.
7. **Subject fallback** — если все raw rejected, пытаемся subject (если не Re:/Fw: и проходит bad-filter).
8. **`isCodeOnly` на letter-run ≥3** — `4.5015-24` нет runs, reject; `Датчик VEGABAR` есть «Датчик» (6 букв), accept.

## Закрытые кейсы из аудита

| Паттерн | Пример input | Output |
|---------|-------------|--------|
| Phone contamination | `+375 33 343-99-61` | rejected |
| Hours | `9.00-18.00` | rejected |
| Signature | `Дордаль Артем Инженер-механик` | rejected |
| Paspoort | `паспорт физического лица` | rejected |
| Accounting | `03. Поступление на расчётный счёт` | rejected |
| Act | `Акт сверки взаиморасчетов` | rejected |
| PDF ops | `/Document Add /FillIn /Delete` | rejected |
| HTML | `<span>Датчик</span>` | clean → `Датчик` |
| Entity | `&#1058;ип` | decode → `Тип` |
| Code-only | `4.5015-24` | rejected (no product noun) |
| Mixed: name+contact | `Датчик +375 33 123` | clean → `Датчик` |
| Overlong | `x`×500 символов | cap → 200 |
| Multi-item | `Клапан A; Клапан B; Клапан C; Клапан D` | split → items[], primary=shortest-or-subject |
| Subject fallback | raw=[phone, pdf], subject=`ДАТЧИК VEGABAR 28` | primary = `ДАТЧИК VEGABAR 28` |

## Railway deploy

Файлы синхронизированы в `.railway-deploy/src/services/` (diff пуст):
`product-name-filters.js`, `product-name-normalizer.js`, `product-name-extractor.js`, `email-analyzer.js`.

## Out of scope (следующие фазы)

- **UI/XLSX integration** `productNamePrimary` / `productLineItems` — текущий `getLeadProductNameList` читает уже-санитизированные `productNames[].name` и `lineItems[].descriptionRu`, поэтому XLSX уже получает чистые строки ≤200. Отдельная колонка «Название товара (основное)» и «Позиций» — следующий sprint.
- **Zoning-aware extraction** — signature/quoted/footer убираются уже существующим `extractSignature`/`separateQuotedText`; полная zone-scored extraction (subject > product_lines > body > signature) — следующий sprint если метрики покажут необходимость.
- **Under-extraction (750+190 empty cases)** — фаза закрывает качество уже извлечённого, не добавляет новых источников кандидатов. Subject fallback покрывает часть (~subject-явные товары), но systematic under-extraction требует item-line pattern matching в отдельной фазе.
- Pre-existing docx/xlsx/brand-alias failures.
