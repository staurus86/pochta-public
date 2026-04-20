# Phase 06 — Company Extraction Refactor (Summary)

**Status:** ✅ Shipped · **Date:** 2026-04-20 · **Deadline:** 2026-04-21

## Goal

Закрыть 11 категорий дефектов TZ в поле «Компания»:

1. **Empty** — 287 строк пусты; нужен fallback на email-domain (weak)
2. **Domain-like labels** — 316 строк вроде "Hhr", "Rdegroup", "Karatsc" — доменные ярлыки без legal marker
3. **Company == second-level domain** — 275 строк "Yandex", "Gmai", "Foxmail" из бесплатных провайдеров
4. **Person names in company** — "Алексей", "Аббос", "Иван Иванов" попадают как company
5. **Departments/Roles as company** — "Отдел закупок", "Procurement Specialist", "Менеджер"
6. **Overcapture with requisite tail** — "ООО X ИНН 7700 Дата регистрации 2009 Устав..."
7. **Company = ФИО** — 47 строк company совпадает с ФИО
8. **Composite not split** — "ИП Серебряков А.А. - Алексей" → нужно разнести на company+person
9. **Email as company** — значение содержит `@`
10. **Generic providers as company** — Yandex.ru / Gmail.com / Mail.ru
11. **No scoring/source** — не различали уверенность и источник извлечения

## Delivered

Три новых модуля + интеграция + обогащённый sender-контракт:

| Файл | Назначение |
|------|-----------|
| `src/services/company-filters.js` | 7 predicates: `isGenericProvider` (yandex/gmail/mail/outlook/...), `isPersonLikeCompany` (2-3 Title-Case слов + single-token через `RU_FIRST_NAMES` для "Алексей"/"Аббос"), `isDepartmentCompany` (stem-based: отдел/подразделени/департамент), `isRoleCompany` (менеджер/manager с учётом позиции в строке), `isOvercaptureBlob` (ИНН/ОГРН/КПП/Дата/Устав/адрес — Cyrillic-safe word boundaries через `(?:^|[^A-Za-zА-Яа-яЁё0-9_])`), `isDomainLabelOnly` (одиночный Title-Case без legal marker), composite `isBadCompany` |
| `src/services/company-normalizer.js` | `stripRequisiteTails` (20+ regex для хвостов ИНН/КПП/ОГРН/Дата регистрации/действующий на основании Устава/г.Город/ул./БИК/р-с + trailing `--` signature separator), `splitCompositeForCompany` (parens + `-`/`—`/`\\`/`/` separators; **skip при unbalanced quotes** — предотвращает порчу вложенных кавычек типа `АО "Концерн "Моринсис - Агат"`), `normalizeLegalQuotes` (ASCII `"` → `«»`; conservative — пропускает nested/malformed случаи), `normalizeCompanyName` (trim+collapse) |
| `src/services/company-extractor.js` | Facade `extractCompany({formFields, signature, body, senderDisplay, emailDomain, personHint})` → `{primary, alt, source, personHint, confidence, needsReview, rawCandidates[], rejected[]}` с priority cascade и кросс-полевой проверкой (personHint conflict) |

Интеграция в `email-analyzer.js` → `extractSender()`:
- **Приоритет:** form (upstream) > signature > body > sender display > email_domain (weak)
- `sender.companyName` — нормализованное имя компании
- `sender.companyAlt` — alt кандидат (вторая по скору)
- `sender.companyNameSource` — `signature` / `body` / `sender` / `email_domain` / `fio_composite`
- `sender.companyNameConfidence` — [0..1]
- `sender.companyNameNeedsReview` — флаг для UI (confidence < 0.6 или отсутствует)
- `sender.companyNameRejected[]` — top-5 отвергнутых с reason: `generic_provider`, `person_like`, `department`, `role`, `overcapture`, `domain_label_only`, `matches_person_hint`, `email`, `bad_company`
- `sender.sources.company` — source-атрибут

**Fallback цепочка:**
1. Form fields (`Компания`/`Организация`/`Company`) — score 0.9
2. Signature legal-entities (`ООО «X»`, `АО ...`, `ИП Фамилия`) + labeled patterns — 0.85
3. Body legal-entities + labeled — 0.8
4. Sender display (composite-aware) — 0.7
5. Email domain → Title-Case label (gmail/yandex/outlook отсекаются) — 0.35

**Cross-field conflict:** если `cleaned == personHint` (ФИО совпадает) → отвергается с reason `matches_person_hint`.

**Fallback на fullNameCompany из Phase 5:** если facade не нашёл primary, но Phase 5 извлёк компанию из composite ФИО строки (`ИП Безрукова ЕВ - Елена`) — используется как `source=fio_composite`, confidence 0.7.

## Tests

- `tests/company-extractor.test.js` — **33/33 green**
  - Filters: isGenericProvider (10), isPersonLikeCompany (7), isDepartmentCompany (6), isRoleCompany (6), isOvercaptureBlob (7), isDomainLabelOnly (7), isBadCompany composite (7)
  - Normalizer: stripRequisiteTails (5 форм-кейсов + preserves legitimate), splitCompositeForCompany (5 кейсов: ИП-Person, Person-Company, parens, Person|Brand, empty), normalizeLegalQuotes (4), normalizeCompanyName (3)
  - Facade: legal pattern wins domain, generic provider rejected, yandex.ru не Yandex, corporate domain fallback, signature beats domain, overcapture cleanup, department/role rejected, person-like rejected, composite ИП-Person, composite ООО-Person, form priority, empty inputs, email as company rejected, personHint conflict, body legal pattern, rejected/raw debug
- Полный suite: **141 PASS / 3 FAIL** (3 pre-existing — brand aliases KB / docx-tar / xlsx-tar, не связано с этой фазой)

## Key design decisions

1. **Source-priority cascade** — `form(0.9) > signature(0.85) > body(0.8) > sender(0.7) > email_domain(0.35)`. Email domain получает только Title-Case label после отсечения generic provider.
2. **Generic provider hard-filter** — отдельный `GENERIC_PROVIDER_DOMAINS` set (gmail.com / yandex.ru / ya.ru / mail.ru / bk.ru / list.ru / outlook.com / icloud.com / me.com / proton.me и пр.) + фильтр second-level label (gmail / yandex / bk / icloud / foxmail / qq / 163 и пр.). Пройдя TLD strip, ядро сравнивается по core-label.
3. **Single-token person-name disambiguation** — регекс `^[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}$` требует минимум 2 слова (ловит "Иван Иванов"). Одиночные токены разрешаются через `RU_FIRST_NAMES` set (62 русских имени: Алексей / Александр / Аббос / Анна / Ольга / ...). Так "Tatenergo" не считается person-like (попадает в `isDomainLabelOnly`), а "Алексей" — считается.
4. **Cyrillic-safe word boundaries** — JS `\b` не работает на кириллических стыках (та же проблема из Phase 1-5). Заменили на `(?:^|[^A-Za-zА-Яа-яЁё0-9_])...(?:[^A-Za-zА-Яа-яЁё0-9_]|$)` для всех REQUISITE_MARKERS (ИНН/КПП/ОГРН/Дата регистрации/действующий на основании/г.Город и пр.).
5. **Unbalanced-quote detection в composite split** — если в строке нечётное число `"` или `«»`, не применяем separator split. Предотвращает порчу вложенных кавычек: `АО "Концерн "Моринсис - Агат"` сохраняется целиком, не разваливается на `АО "Концерн "Моринсис` + `Агат`.
6. **Conservative normalizeLegalQuotes** — ASCII → guillemets только когда закрывающая кавычка стоит у границы (пробел, пунктуация, конец строки). Malformed nested-quote строки остаются как есть.
7. **Line-bounded greedy regex для вложенных кавычек** — паттерн `/(?:ООО|...)\s+"[^\n]{2,150}"/g` сначала, до более коротких паттернов. Ловит полный span `АО "Концерн "Моринсис - Агат"` прежде чем `[^«»"]` версии подрежут.
8. **Cyrillic support в findLegalEntities** — заменили `\w` (ASCII-only в JS) на `[А-Яа-яЁё\w\-.]` для Cyrillic tails типа `АО Татэнерго`.
9. **Requisite tail strip включает signature-separator** — добавили `\s+-{2,}\s*.*$` и trailing dash strip, чтобы `ООО ПКФ Монарх --\nтел...` не выдавал `ООО ПКФ Монарх --`.
10. **Legacy extractCompanyName как pre-scan** — инжектируется в body как `Компания: X`, чтобы legacy-логика (sender-profile patterns, lookup в directory) продолжала работать, но результат просеивается через новые фильтры и нормализацию.
11. **Rejected[] debug-поле** — top-5 отвергнутых с reason; UI может показать "тип поля: Компания, отвергли: Yandex (generic_provider)".
12. **fio_composite как отдельный source** — когда Phase 5 ФИО-парсер извлёк company из composite строки (`ИП Безрукова ЕВ - Елена`), но facade company-extractor не нашёл ничего в подписи/body/domain — используется это значение с conf 0.7.

## Закрытые кейсы из аудита

| Паттерн | Пример input | Output |
|---------|-------------|--------|
| Generic provider в company | `emailDomain=gmail.com` | `primary=null, rejected=[{reason:"generic_provider"}]` |
| Yandex.ru не Yandex | `emailDomain=yandex.ru` | `primary=null` |
| Corporate domain fallback | `emailDomain=tatenergo.ru, no sig` | `primary="Tatenergo", source="email_domain", conf<0.5` |
| Подпись побеждает domain | `sig="АО Татэнерго", emailDomain=tatenergo.ru` | `primary="АО Татэнерго", source="signature"` |
| Overcapture blob | `sig="ООО «ЛВН-Менеджмент» Дата регистрации 29.12.2009 ИНН 7700000000"` | `primary="ООО «ЛВН-Менеджмент»"` |
| Department reject | `senderDisplay="Отдел закупок"` | `primary !== "Отдел закупок"` |
| Role reject | `"Procurement Specialist"` | rejected with reason role |
| Person-like reject (single-token rus) | `"Алексей"` | rejected with reason person_like |
| Person-like reject (multi-word) | `"Иван Иванов"` | rejected with reason person_like |
| Tatenergo — domain label only | `"Tatenergo"` standalone | rejected with reason domain_label_only (кроме email_domain source) |
| Composite ИП-Person | `"ИП Серебряков А.А. - Алексей"` | `company="ИП Серебряков А.А.", personHint="Алексей"` |
| Composite ООО-Person | `"ООО Энерг - Цыганок Алексей Александрович"` | `company="ООО Энерг", personHint="Цыганок..."` |
| Parens composite | `"Елена Ананьева (ООО Металлургический Сервис)"` | `company="ООО Металлургический Сервис", personHint="Елена Ананьева"` |
| Pipe brand | `"Иван Иванов \| Neo"` | `company="Neo", person="Иван Иванов"` |
| Form priority | `formFields={Компания:"ООО ФормКомпани"}, sig="ООО СигнКомпани"` | `primary="ООО ФормКомпани", source="form"` |
| Empty → null | all empty | `primary=null, needsReview=true` |
| Email @ в company | value contains `@` | rejected with reason email |
| PersonHint conflict | `personHint="Иван Петров", sig mentions "Иван Петров"` | rejected with reason matches_person_hint |
| Nested quotes preserved | `"АО "Концерн "Моринсис - Агат""` | primary сохраняется как есть, не портится composite split |
| Trailing `--` стрип | `"ООО ПКФ Монарх --\nтел..."` | `primary="ООО ПКФ Монарх"` |
| Quote normalization | `'ООО "ПромСнаб"'` | `primary="ООО «ПромСнаб»"` |

## Railway deploy

Файлы синхронизированы в `.railway-deploy/`:
- `.railway-deploy/src/services/company-filters.js`
- `.railway-deploy/src/services/company-normalizer.js`
- `.railway-deploy/src/services/company-extractor.js`
- `.railway-deploy/src/services/email-analyzer.js`

Все diffs пустые.

## Out of scope (следующие фазы)

- **Company auto-enrichment из ИНН** — если есть ИНН, но нет компании, обращаться в справочник — следующий sprint.
- **Multiple company candidates UI** — в lead.companyAlt есть вторая по скору версия; UI-chip — следующий sprint.
- **Merge fio_composite с form source** — сейчас если ФИО-парсер дал company, но форма не дала — используется fio_composite; если форма дала одно, а ФИО-парсер другое — используется форма. Более умный merge — следующий sprint.
- **Sender-profile company learning** — когда accepted company найден для отправителя, сохранять в profile для будущих писем — следующий sprint.
- Pre-existing brand-aliases / docx / xlsx failures.
