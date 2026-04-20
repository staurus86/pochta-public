# Phase 7 — Position (Должность) refactor

**Status:** ✅ Shipped 2026-04-20 · 35/35 new tests green · 141 pre-existing PASS / 3 FAIL (unrelated: docx/xlsx tar, R.Stahl KB alias)

## Goal
Закрыть defect-категории из аудита Должность (1826 строк, 821 заполнено, 45%):
- 43 строки — company markers в должности (ООО/АО/LLC)
- 25 строк — department-only («Отдел закупок» без роли)
- 47 строк — person fragments (ФИО вперемешку)
- 105 строк — overcapture 5+ слов
- 7 строк — Position == Company
- 3 строки — Position == ФИО
- contact garbage (телефоны, email, URL, адреса) в должности

Цели:
1. Поднять recall на 1005 пустых позиций за счёт greeting-adjacent + role-line sweep.
2. Разделить entity: `position` (чистая роль), `departmentName` (отдельное поле), `positionAlt` (bilingual EN), source/confidence/rejected.
3. Отсечь company/person/contact tail через normalizer, а не через reject.

## 3 новых модуля (зеркало в `.railway-deploy/src/services/`)

### `src/services/position-filters.js`
7 предикатов + `hasRoleWord` / `hasRoleNoun` helpers:
- `isCompanyInRole` — содержит ООО/АО/LLC/GmbH/Ltd/Corp/... (не начинает, а просто присутствует)
- `isPersonInRole` — детектит trailing initials «Иванов И.И.» + находит 2+ consecutive Title-case non-role token run (Cyr + Lat)
- `isDepartmentOnly` — dept stem (отдел/служба/департамент/бюро/department/...) И отсутствует role NOUN (менеджер/директор/specialist/...). Role adjectives (procurement/sales/главный) НЕ дисквалифицируют.
- `isContactGarbage` — pure phone, pure email, pure URL, адрес; substring match НЕ ловит (устранено: «Менеджер info@x.ru» → ни contact ни blob, стрипуется нормализатором)
- `isAddressLike` — «г.», «ул.», postal code prefix
- `isPhoneLike` — digits+format ≥ 7 OR «тел:…»
- `isFullSignatureBlob` — multi-line (≥3 строк) OR >150 chars OR phone+email в одной строке
- `isBadPosition` — composite: empty / phone / email / person-only / company-only / letters<3

Ключевые paste-safe конструкции:
- `WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])"` / `WE` lookarounds — JS `\b` не работает с Cyrillic.
- ROLE_NOUNS vs ROLE_ADJECTIVES split — адъективы не блокируют department-only, но учитываются в scoring.

### `src/services/position-normalizer.js`
- `stripCompanyTail` — вырезает " ООО/АО/LLC … $" справа
- `stripPersonTail` — вырезает trailing 2-3 Title-case Cyrillic/Latin слов + «Иванов И.И.», если в хвосте нет role word (чтобы не сожрать роль «Senior Manager»)
- `stripContactTail` — trailing phone («+7 …»), email («user@x.ru $»), URL («https://… $»)
- `splitBilingualRole` — «Главный инженер | Chief Engineer» → {ru, en}; разделители `|` и `/`
- `separateDepartmentFromRole` — «Начальник отдела закупок» → {role:«Начальник», department:«отдела закупок»}
- `normalizePosition` — pipeline: contact → company → person → trimEdges → collapse

### `src/services/position-extractor.js`
Facade cascade (источник → base confidence):
- `form` 0.95
- `signature` 0.9
- `body` 0.8
- `sender` 0.6

Candidate generation per zone:
1. Label match: `/Должность|Position|Title|Job Title|Role: X/`
2. `POSITION_SIGNATURE_PATTERN` — расширен: менеджер/инженер/специалист по X, директор по X, главный инженер/технолог/энергетик, зав. отделом, etc.
3. Greeting-adjacent (С уважением/Best regards/…): same-line role OR next 1-2 lines Title-case + role word.
4. Role-line sweep: строка начинается с role word **ИЛИ** содержит role NOUN; narrative sentences («Please quote for our project») отклоняются через first-token lowercase / punctuation check.

Scoring bonuses:
- +0.05 hasRoleWord
- +0.03 hasDepartmentStem && hasRoleNoun
- +0.02 length 4-60
- −0.1 length > 80
- −0.3 isCompanyInRole
- −0.3 isPersonInRole && !hasRoleWord

Reject reasons (surfaced in `rejected[]`): `contact_garbage`, `company_only`, `person_only`, `department_only`, `signature_blob`, `no_role_word`, `matches_person_hint`, `matches_company_hint`, `empty_after_clean`, `bad_position`.

## Интеграция в `email-analyzer.js`

Замена `const position = fullNameRole || extractPosition(body) || null;` на каскад:
```js
const positionResult = extractPositionV2({
  signature: signature || "",
  body: stripQuotedReply(body || ""),
  senderDisplay: fromName || "",
  personHint: fioResult.primary || fullNameCompany || null,
  companyHint: rawCompanyName || null,
});
let position = positionResult.primary || null;
if (!position && fullNameRole) { position = fullNameRole; positionSource = "fio_composite"; }
if (!position) {
  const legacy = extractPosition(body);
  if (legacy) { position = legacy; positionSource = "legacy"; }
}
```

Легаси `extractPosition(body)` оставлен как fallback — работают старые KB patterns и greeting-same-line. Новый каскад даёт первый проход с полными debug-полями, legacy подхватывает missed edge cases.

**Новые sender поля:** `positionAlt`, `departmentName`, `positionSource`, `positionConfidence`, `positionNeedsReview`, `positionRejected[]`, `sources.position`, `sources.department`.

## Тесты

`tests/position-extractor.test.js` — 35 тестов:
- 9 filter tests: isCompanyInRole / isPersonInRole / isDepartmentOnly / isContactGarbage / isAddressLike / isPhoneLike / isFullSignatureBlob / hasRoleWord / isBadPosition
- 7 normalizer tests: stripCompanyTail / stripPersonTail / stripContactTail / splitBilingualRole (×2) / separateDepartmentFromRole (×2) / normalizePosition
- 19 facade tests: form>signature cascade / label / signature multi-line / company strip / personHint reject / companyHint reject / department-only→department / role+dept split / contact reject / empty / Latin / bilingual / overcapture / debug fields / recall Закупщик / recall Procurement Specialist / reject persons / reject companies

## Key gotchas (актуальны по опыту Phase 5-6)

1. **JS `\b` не работает с Cyrillic** → явные `(?:^|[^A-Za-zА-Яа-яЁё0-9_])` lookarounds в требованиях / markers.
2. **JS `\w` = ASCII-only** → не использовать в Cyrillic-контексте, только `[А-Яа-яЁё…]`.
3. **ROLE adjectives vs nouns** — «procurement», «sales», «главный» — modifiers, не disqualify «Procurement Department»; «manager», «специалист» — nouns, блокируют department-only.
4. **Role-line sweep наивен** — narrative sentences («Please quote for our project» из-за «project») ловятся. Фикс: first-token lowercase + punctuation → skip unless startsWithRole.
5. **isContactGarbage substring match → catastrophic** — вся «Менеджер по закупкам info@x.ru» отлетала в reject. Фикс: whole-string match (`^…$`), tail-strip отдаётся normalizer'у.
6. **Bilingual alt** — `|` / `/` разделители; alt заполняется когда primary=ru, en=en.
7. **cross-field hints** — personHint, companyHint exact-match (case-insensitive) → reject before scoring.

## Git

Commit: `<pending>` · diff: +3 modules (~430 lines) + email-analyzer integration (~35 lines) + tests (~300 lines) + SUMMARY.
