# Phase 12: Quantity and INN - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Исправить счётчики позиций/количеств (`positions`, `totalQty`) и добавить валидацию ИНН по контрольной сумме (mod-11, ФНС). Не трогать логику брендов, ФИО, телефона, productNames.

**CONTACT-01 уже реализован** — `mergeAttachmentRequisites()` вызывается на строке 1003 `email-analyzer.js` и читает `file.detectedInn[]` из `attachment-content.js`. Основная работа Phase 12 — ART-04 + CONTACT-02.

</domain>

<decisions>
## Implementation Decisions

### ART-04: positions/totalQty (имена полей и логика)

- **D-01:** Переименовать `totalPositions` → `positions` во всех местах `email-analyzer.js`. CRM-адаптер `crm-adapters.js` читает `lead.total_positions` — обновить и его.
- **D-02:** Добавить поле `totalQty` = сумма qty по **уникальным** позициям (deduplicated по `normalizeArticleCode(article)`). `null` qty в сумме считается 0.
- **D-03:** Вычислять `positions` и `totalQty` в **пост-процессинге** — добавить финальный шаг `finalizeLeadCounts(lead)` в `email-analyzer.js` после всех merge-шагов (последний вызов `lead.totalPositions` сейчас на строке ~1562). Деdup: одна итоговая запись на нормализованный article code — выбирать наибольшее qty среди дублей.
- **D-04:** `positions` = количество уникальных article code (не длина `lineItems`). `totalQty` = сумма qty по этим уникальным позициям.

### CONTACT-02: INN checksum validation

- **D-05:** Реализовать `validateInnChecksum(digits)` — отдельная функция рядом с `normalizeInn()`:
  - 10-значный ИНН (юрлица): коэффициенты `[2,4,10,3,5,9,4,6,8,0]`, контрольная цифра = `(sum(digit[i]*coeff[i]) % 11) % 10`, проверить `digit[9]`.
  - 12-значный ИНН ИП: две контрольных цифры (digit[10] и digit[11]), с разными наборами коэффициентов (официальный алгоритм ФНС).
  - 9-значный Belarus УНП — checksum не применять (пропустить как есть).
- **D-06:** Интеграция: применять `validateInnChecksum()` в `normalizeInn()` — если checksum fail, возвращать `null` (полный отказ, не сохранять сомнительный ИНН).
- **D-07:** Применять checksum-фильтр **везде**, где ИНН принимается: тело письма (`extractRequisites()`), вложения (`attachment-content.js detectedInn`), форма-парсер.
- **D-08:** Для отклонения 10-значных чисел **как артикулов**: в `isInnLike()` / `rejectArticleCandidate()` добавить флаг — если число 10 цифр и **прошло** checksum, это ИНН (не артикул). Если 10 цифр и **не прошло** — не принимать ни как ИНН, ни как артикул.

### Audit gate (audit_baseline.py)

- **D-09:** Добавить метрику `positions` в `fields`:
  - `present`: % писем где `positions > 0`
  - `noise_free`: % писем где `totalQty > 0` (из писем с `articles > 0`)
- **D-10:** Добавить `inn_valid_rate` в отдельный блок или как `inn.noise_free`: % писем где `inn` присутствует **и** прошёл checksum (в скрипте применить ту же логику mod-11).

### Claude's Discretion

- Порядок дедупликации в `finalizeLeadCounts`: при нескольких lineItems с одним article code брать тот у которого qty != null (если несколько с qty — максимальный).
- `positions` = 0 когда нет артикулов (не `undefined`).
- Имя финального шага: `finalizeLeadCounts(lead)` — можно выбрать другое если вписывается в стиль файла.
- Regression-тесты: минимум один тест для Belgormash-случая (18/7 → 2/5) и один для checksum 10-значного ИНН.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### positions/totalQty
- `src/services/email-analyzer.js` — основной файл: `extractLead()` (~строка 2758), все строки с `totalPositions` (~1059, 1089, 1134, 1448, 1562, 1746, 3064, 3183)
- `src/services/crm-adapters.js` — читает `lead.total_positions` (строки 133, 167) — обновить при переименовании
- `src/services/attachment-content.js` — `mergeAttachmentLeadData()` — источник lineItems из вложений

### INN validation
- `src/services/email-analyzer.js` — `normalizeInn()` строка 253, `extractRequisites()` строка 2548, `mergeAttachmentRequisites()` строка 2156
- `src/services/attachment-content.js` — `detectedInn` extraction строки 223-235 (без checksum — добавить)
- `.planning/REQUIREMENTS.md` §CONTACT-01, §CONTACT-02

### Audit script
- `scripts/audit_baseline.py` — текущий скрипт метрик, добавить `positions.noise_free` и `inn.noise_free`
- `scripts/baselines/baseline_v1.json` — baseline Phase 10/11; новые метрики Phase 12 будут в `baseline_v2.json`

### Deploy (критично)
- `.railway-deploy/src/services/email-analyzer.js` — MUST зеркалить все изменения
- `.railway-deploy/src/services/attachment-content.js` — MUST зеркалить изменения checksum

### Требования
- `.planning/REQUIREMENTS.md` §ART-04, §CONTACT-01, §CONTACT-02
- `.planning/ROADMAP.md` §Phase 12 — Success Criteria 1-4

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `normalizeInn(v)` в `email-analyzer.js:253` — добавить checksum внутри (или вызов validateInnChecksum)
- `mergeAttachmentRequisites(sender, attachmentAnalysis)` в `email-analyzer.js:2156` — уже реализован и вызывается (строка 1003)
- `normalizeArticleCode(article)` — существует в `article-normalizer.js` и в `email-analyzer.js` (legacy) — использовать для dedup в finalizeLeadCounts
- `isInnLike` гард в строке 3600 — уже исключает 10-значные числа из qty outlier-конфликтов, расширить для article rejection

### Established Patterns
- Паттерн `*-filters.js` + `*-normalizer.js` → facade в `email-analyzer.js` (Phase 05-11)
- Regression-тесты в `tests/` через `node:test` + `node:assert`
- Hard-exclude через `.filter()` после сбора кандидатов (Phase 11, signature zone)

### Integration Points
- `analyzeEmailLead()` — точка после всех merge-шагов, куда добавляется `finalizeLeadCounts(lead)`
- `crm-adapters.js` — читает `lead.total_positions`; при переименовании в `positions` обновить здесь
- `validateSenderFields()` в `email-analyzer.js` — место где валидируется `sender.inn`; добавить checksum-check туда или в `normalizeInn()`
- Deploy: изменения в `src/` обязательно копировать в `.railway-deploy/src/`

</code_context>

<specifics>
## Specific Ideas

- Belgormash кейс (ART-04): 2 артикула × 5 шт каждый = `positions: 2, totalQty: 10`. Текущий результат 18/7 из-за дублирования lineItems по зонам.
- INN checksum baseline: baseline_v1.json показывает `inn.present: 76.3%`, `inn.noise_free: 73.7%` — после фикса ожидаем рост `noise_free` (сейчас нет checksum-фильтра).
- qty baseline: `qty.noise_free = -0.23` (отрицательное!) — метрика сломана из-за overcounting. Новая метрика `positions.noise_free = % с totalQty > 0` заменит её как осмысленный показатель.

</specifics>

<deferred>
## Deferred Ideas

- 12-значные Kazakhstan ИИН (checksum) — рассмотреть в Phase 13 или отдельным тикетом
- Belarus УНП checksum (алгоритм существует, но не задокументирован в требованиях) — будущее
- Автосинхронизация `src/` ↔ `.railway-deploy/src/` — REQ-SYNC-01, не в этой фазе

</deferred>

---

*Phase: 12-quantity-and-inn*
*Context gathered: 2026-05-28*
