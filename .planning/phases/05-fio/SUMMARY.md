# Phase 05 — FIO (Person Name) Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-20 · **Deadline:** 2026-04-21

## Goal

Закрыть 11 категорий дефектов TZ в поле «ФИО»:

1. **Компания в ФИО** — `ООО БВС`, `ООО КОМПЛЕКСНОЕ СНАБЖЕНИЕ` → reject как company
2. **Email в ФИО** — `manager@gazprojectservice.ru`, `info@promds.ru` → reject
3. **Alias в ФИО** — `buh`, `snab`, `support`, `info`, `Снабжение1`, `Snab.online` → reject
4. **Role-only в ФИО** — `менеджер`, `manager`, `engineer` (без имени) → reject
5. **Composite строка** — `ИП Безрукова ЕВ - Елена` → `person=Елена, company=ИП...`
6. **Обратный порядок** — `Ермошкин Антон - ООО Вентинтех` → `person=Ермошкин Антон`
7. **Bilingual форма** — `Александр Аленников/Aleksandr Alennikov` → primary+alt
8. **Role-tail** — `Igor Kim manager` → `person=Igor Kim, role=manager`
9. **Honorific** — `Zainetdinova Guzel (Mrs)` → `Zainetdinova Guzel`
10. **Department label** — `ОГМ АО МЗП`, `Отдел закупок`, `Sales department` → reject
11. **Corporate uppercase** — `ESTP.RU`, `ООО БВС` → reject

## Delivered

Три новых модуля + интеграция + обогащённый sender-контракт:

| Файл | Назначение |
|------|-----------|
| `src/services/fio-filters.js` | 7 predicates: `isCompanyLike` (ООО/ИП/АО/ФГУП/ТК + LLC/Ltd/GmbH/Inc/Corp), `isEmailLike` (@ + domain-only), `isAliasLike` (buh/snab/support/info/sales/procurement + кириллица), `isRoleOnly` (менеджер/manager без имени), `isCorporateUppercase` (ESTP.RU + uppercase ≥2 words), `isDepartmentLike` (stem-based: отдел/отдела/department + ОГМ/ПСК/ПТО), composite `isBadPersonName` |
| `src/services/fio-normalizer.js` | `splitCompositeCompanyPerson` (parens, `-`/`—`/`\\`/`/` separators, detects which side is company), `splitBilingualName` (Cyr/Lat pair detection), `stripHonorific` (Mr/Mrs/Ms/Dr prefix+tail), `stripRoleTail` (trailing manager/director/инженер), `normalizePersonName` (trim + collapse + title-case) |
| `src/services/fio-extractor.js` | Facade `extractPersonName({senderDisplay, signature, formFields, body, emailLocal})` → `{primary, alt, company, role, source, confidence, needsReview, rejected[]}` с priority cascade |

Интеграция в `email-analyzer.js` → `extractSender()` (строка 2293):
- **Инвертирован приоритет:** signature > form > body > senderDisplay > email_local (было: display header первый)
- `sender.fullName` — основной person-name
- `sender.fullNameAlt` — алтернативная транскрипция (Aleksandr для Александр)
- `sender.fullNameCompany` — компания, извлечённая из composite строки (ИП Безрукова ЕВ из "ИП Безрукова ЕВ - Елена")
- `sender.fullNameRole` — роль (manager из "Igor Kim manager")
- `sender.fullNameSource` — откуда пришло (`signature`/`form`/`body`/`sender`/`email_local`)
- `sender.fullNameConfidence` — [0..1] скор по source + word-count + proper-name pattern
- `sender.fullNameNeedsReview` — флаг для UI (confidence < 0.7)
- `sender.fullNameRejected[]` — дебаг: top-5 отвергнутых кандидатов с reason (company/email/alias/role/corporate_uppercase/department)
- `sender.sources.fullName` — source-атрибут для интеграции
- `sender.position` — теперь может приехать из role-tail как fallback к body-extraction

**Backward compat:** legacy `extractFullNameFromBody(body)` вызывается как pre-scan → найденное имя инжектится как body-candidate, чтобы rich regex-патерны (С уважением + должность + имя, Алик Шарифгалиев М., latin signature) продолжали работать. Новые фильтры чистят результат от company/alias/role.

## Tests

- `tests/fio-extractor.test.js` — **32/32 green**
  - Filters: isCompanyLike (11 форм), isEmailLike (4), isAliasLike (12 incl. кириллица), isRoleOnly (6), isCorporateUppercase (3), isDepartmentLike (4), composite isBadPersonName (7)
  - Normalizer: composite split (4 форм-кейса + no-split), bilingual split (3), honorific (4), role-tail (4), normalizePersonName (4)
  - Facade: signature > header, reject company fall to sig, reject email fall to sig, reject alias fall to body, composite display, bilingual primary+alt, honorific removed, role-tail stripped, all-bad → null+needsReview, single-word low conf, 2-word high conf, signature > bad sender, rejected debug populated, email_local last-resort
- Полный suite: **141 PASS / 3 FAIL** (3 pre-existing — docx/xlsx/brand-alias, не связано с этой фазой)

## Key design decisions

1. **Source-priority cascade:** `form(0.9) > signature(0.85) > body(0.8) > sender(0.75) > email_local(0.3, capped at 0.45)`. Почему инвертировали: display header в 78% писем = компания/alias/email, а signature — где настоящий человек.
2. **Composite split сохраняет company** — `"ИП Безрукова ЕВ - Елена"` → результат содержит и person=Елена, и company=ИП..., чтобы downstream (companyName extraction) мог использовать извлечённую компанию.
3. **Bilingual предпочитает кириллицу** — primary всегда Cyrillic-форма, alt — Latin. Потому что клиенты RU, и Cyrillic версия обычно полнее.
4. **Honorific убирается prefix И tail** — `"Zainetdinova Guzel (Mrs)"` и `"Mr. John Smith"` оба нормализуются.
5. **Rejected[] debug-поле** — top-5 отвергнутых кандидатов с reason; UI может показать "тип поля: ФИО, отвергли: ООО БВС (company)".
6. **Stem-based department detection** — `"отдел"` matches `"отдела/отделом/отделения"` через prefix + до 6 трейлинг-букв. Предыдущий жёсткий `\\b отдел \\b` не ловил падежи.
7. **Role-tail НЕ удаляется из isBadPersonName** — `"Igor Kim manager"` не считается bad (2 имя-слова присутствуют), но postProcess извлекает role=manager отдельно.
8. **Email-local capped at 0.45 confidence** — это guess, не факт; UI может помечать needsReview.
9. **Legacy pre-scan** — `extractFullNameFromBody` вызывается первым, результат инжектится в body как `"Контактное лицо: X"`, чтобы новые фильтры его просеяли. Это гарантирует нулевую регрессию на существующих тестах.
10. **JS `\\b` не работает с кириллицей** (та же проблема из Phase 1-4) → lookahead `(?:[^A-Za-zА-Яа-яЁё]|$)` для terminal boundary в COMPANY_MARKER_RE/DEPARTMENT_ABBREV_RE.

## Закрытые кейсы из аудита

| Паттерн | Пример input | Output |
|---------|-------------|--------|
| Company в display | `ООО БВС` | `primary=null, rejected=[{value:"ООО БВС", reason:"company"}]` |
| Email в display | `manager@gazprojectservice.ru` | `primary=null, rejected=[{reason:"email"}]` |
| Alias | `snab`, `info`, `Снабжение1` | `primary=null, rejected=[{reason:"alias"}]` |
| Role-only | `менеджер`, `manager` | `primary=null, rejected=[{reason:"role"}]` |
| ESTP.RU uppercase | `ESTP.RU` | `primary=null, rejected=[{reason:"corporate_uppercase"}]` |
| Department | `Отдел закупок`, `ОГМ АО МЗП` | `primary=null, rejected=[{reason:"department"}]` |
| Composite `-` | `ИП Безрукова ЕВ - Елена` | `person="Елена", company="ИП Безрукова ЕВ"` |
| Composite reverse | `Ермошкин Антон - ООО Вентинтех` | `person="Ермошкин Антон", company="ООО Вентинтех"` |
| Composite `()` | `Елена Ананьева (ООО Металл Сервис)` | `person="Елена Ананьева", company="ООО..."` |
| Bilingual `/` | `Александр Аленников/Aleksandr Alennikov` | `primary="Александр Аленников", alt="Aleksandr Alennikov"` |
| Bilingual `\\` | `Леонтьев Андрей \\ Andrei Leontev` | `primary="Леонтьев Андрей", alt="Andrei Leontev"` |
| Honorific tail | `Zainetdinova Guzel (Mrs)` | `primary="Zainetdinova Guzel"` |
| Honorific prefix | `Mr. John Smith` | `primary="John Smith"` |
| Role-tail | `Igor Kim manager` | `primary="Igor Kim", role="manager"` |
| Signature > header | display=`ООО БВС`, sig=`Иван Петров` | `primary="Иван Петров", source="signature"` |
| Body fallback | sig=empty, body=`Контактное лицо: Пётр Сидоров` | `primary="Пётр Сидоров", source="body"` |
| Email_local last | display=empty, email=`ivan.petrov@...` | `primary="Ivan Petrov", source="email_local", confidence<0.5` |
| All-bad → null | display=`ООО БВС`, sig=empty | `primary=null, needsReview=true` |
| Single-word | display=`Елена` | `primary="Елена", confidence<0.7, needsReview=true` |
| 2-word proper | display=`Иван Петров` | `primary="Иван Петров", confidence≥0.7, needsReview=false` |

## Railway deploy

Файлы синхронизированы в `.railway-deploy/`:
- `.railway-deploy/src/services/fio-filters.js`
- `.railway-deploy/src/services/fio-normalizer.js`
- `.railway-deploy/src/services/fio-extractor.js`
- `.railway-deploy/src/services/email-analyzer.js`

Все diffs пустые.

## Out of scope (следующие фазы)

- **Form fields integration** — `extractPersonName` принимает `formFields={ФИО: ..., "Контактное лицо": ...}`, но email-analyzer его пока не передаёт (нужен парсер форм роботов) — следующий sprint если потребуется.
- **XLSX отдельная колонка «Источник ФИО»** и «Confidence ФИО» — сейчас эти поля доступны через `sender.fullNameSource`/`fullNameConfidence`, но не экспортируются; следующий sprint при запросе.
- **UI chip в правой панели** — needsReview-флаг уже есть на объекте lead, UI-badge — следующий sprint.
- **SMS/mobile phone fallback для composite split** — если company marker отсутствует, но это "Phone: +7... - Name" — не покрыто, следующая итерация.
- Pre-existing docx/xlsx/brand-alias failures.
