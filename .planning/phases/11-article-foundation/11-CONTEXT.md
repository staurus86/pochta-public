# Phase 11: Article Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Подключить `src/services/article-extractor.js` в `extractLead()` внутри `email-analyzer.js`, заменив 500-строчный inline-каскад. Добавить hard-exclude подписей, UUID/hex-фильтр, и убедиться что dedup по пробелу/дефису работает. Не трогать логику брендов, количеств, ФИО и других полей.

</domain>

<decisions>
## Implementation Decisions

### Стратегия миграции (ART-01)
- **D-01:** Полная замена inline-каскада сразу — удалить 500-строчный inline-код из `extractLead()`, заменить вызовом `extractArticles()` из `article-extractor.js`. Никакого shadow-режима.
- **D-02:** После замены запустить reanalysis и сравнить `article.present%` с baseline Phase 10 (80.7%). Если падение > 5%, остановиться и расследовать.
- **D-03:** `extractArticles()` принимает `{ subject, body, attachmentText }` и `{ knownBrands, minScore }`. Результат: `{ articles, rawCandidates, rejectedCandidates, strictMode, confidence }`. Использовать `articles` как замену inline-массива `allArticles`.

### Подписи и цитаты (ART-01, ART-03)
- **D-04:** Подписи (signature zone) — **hard-exclude**: артикулы из `ZONES.SIGNATURE` не проходят в итоговый массив, независимо от score. Добавить фильтр после scoring-шага: `passing.filter(a => a.zone !== ZONES.SIGNATURE)`.
- **D-05:** Цитаты (quoted thread zone) — **score-filter**: оставить существующий `score -= 2` в `scoreCandidate()`. Не hard-exclude, так как forwarded-письмо может нести реальный запрос в цитате.
- **D-06:** Если `currentMessage` + `attachmentText` дают 0 артикулов, но `quotedThread` даёт ≥ 1 с достаточным score — использовать их как fallback (уже реализовано существующим scoring).

### UUID-фильтр (ART-02)
- **D-07:** Отклонять оба паттерна в `rejectArticleCandidate()` в `article-filters.js`:
  1. UUID v4 формат: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
  2. Длинные hex-строки (без дефисов) ≥ 20 символов: `/^[0-9a-f]{20,}$/i`
  - Reason label: `"uuid_or_long_hex"`.

### Дедупликация (ART-03)
- **D-08:** `dedupKey()` в `article-normalizer.js` уже нормализует пробел и дефис — `MD-025-6L ≡ MD 025-6L`. Это **уже решено** в существующем коде. Никакой дополнительной работы не требуется.

### Claude's Discretion
- Выбор формы при collapse дублей (MD-025-6L vs MD 025-6L): оставить первую встреченную (как делает dedupeCaseInsensitive сейчас).
- Порядок зон при обходе: `SUBJECT → CURRENT → ATTACHMENT → SIGNATURE → QUOTED` (как в article-extractor.js).
- `minScore` оставить по умолчанию (3 для normal mode, 5 для strict mode) — не менять без измеренных данных.
- Тесты: добавить тест-кейс для UUID-отклонения и тест для signature hard-exclude в `tests/` с `node:test`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Article extraction pipeline
- `src/services/article-extractor.js` — Главный facade; `extractArticles(email, options)` — заменяет inline-каскад
- `src/services/email-zoning.js` — `splitZones()`, `ZONES`, `ZONE_PRIORITY` — зонирование писем
- `src/services/article-filters.js` — `rejectArticleCandidate(token, ctx)` — сюда добавляется UUID-фильтр
- `src/services/article-normalizer.js` — `normalizeArticleCode()`, `dedupeCaseInsensitive()`, `dedupKey()` — уже нормализует space/dash

### Место изменения
- `src/services/email-analyzer.js` lines 2758–2870 — функция `extractLead()` — основное место замены
- `.railway-deploy/src/services/email-analyzer.js` — MUST also be updated (зеркало; критично по CLAUDE.md)

### Требования
- `.planning/REQUIREMENTS.md` §ART-01, §ART-02, §ART-03
- `.planning/ROADMAP.md` §Phase 11 — Success Criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extractArticles(email, options)` из `article-extractor.js` — готов к использованию, 0 импортёров сейчас
- `rejectArticleCandidate(token, ctx)` в `article-filters.js` — место для UUID-правила
- `dedupeCaseInsensitive()` + `dedupKey()` — ART-03 уже реализован, не переписывать

### Established Patterns
- Все модули из Phases 05-09 используют паттерн: `*-filters.js` + `*-normalizer.js` + `*-extractor.js` → facade в `email-analyzer.js`
- Hard-exclude в email-analyzer реализован через `.filter()` после сбора кандидатов — тот же паттерн для signature zone
- `normalizeArticleCode` существует и в `email-analyzer.js` (legacy) и в `article-normalizer.js` (новый) — использовать новый из `article-extractor.js`

### Integration Points
- `extractLead()` в `email-analyzer.js:2758` — `allArticles` заменяется на `result.articles` из `extractArticles()`
- `lineItemsRaw` остаётся (использует отдельный `extractLineItems()`) — НЕ заменяется
- `attachments` join в `extractArticlesFromAttachments()` — заменяется передачей `attachmentText` в `extractArticles()`
- Deploy: изменения ОБЯЗАТЕЛЬНО дублировать в `.railway-deploy/src/services/email-analyzer.js`

</code_context>

<specifics>
## Specific Ideas

- После замены запустить `python scripts/audit_baseline.py --local --limit 300` и сравнить article.present% с 80.7% baseline. Это primary success gate для Phase 11.
- UUID hard-exclude добавляется до scoring, в `rejectArticleCandidate()` — не в post-processing.
- `lineItemsRaw` (tabular data extraction) остаётся на существующем `extractLineItems()` — не трогать.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-article-foundation*
*Context gathered: 2026-05-25*
