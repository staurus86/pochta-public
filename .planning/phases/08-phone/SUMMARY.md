# Phase 8 — Phone (Телефон) refactor

**Status:** ✅ Shipped 2026-04-20 · 32/32 new tests green · 140 email-analyzer PASS / 3 FAIL (pre-existing unrelated: R.Stahl KB alias, docx/xlsx tar на Windows)

## Goal
Закрыть defect-категории из аудита Телефон (1826 строк, 1204 заполнено, 65.9%):
- 1 строка — extension не отделена («+7(8352) 62-29-15, доб. 204»)
- 1 строка — т/ф без классификации fax vs phone
- 2 строки — 8XXX не нормализовано до +7
- 1 строка — короткий/локальный без risky-flag
- 7+ строк — телефоны утекают в поле Company («ООО Предприятие Теллур 8 903 605 2708»)
- Отсутствие sub-полей (ext, type, country, mobile/landline/fax)
- Отсутствие misplacement recovery из соседних полей

Цели:
1. Канонический формат RU: `+7 (XXX) XXX-XX-XX`, коды 0xx/1xx/6xx отклоняются.
2. Разделение entity: `cityPhone` (landline), `mobilePhone` (9xx), `phoneExt` (доб./ext/вн), `phoneType` (phone/fax/phone_or_fax/unknown), `phoneCountry` (RU/BY/KZ/…), `phoneSource`, `phoneConfidence`, `phoneNeedsReview`, `phoneRejected[]`, `phoneRecoveredFromCompany`.
3. Отсечь INN/OGRN/KPP/банк-счёт/почт.индекс/артикул/дату через отдельный фильтр, а не случайное совпадение.
4. Восстановить телефон из companyName, когда он туда утёк.

## 3 новых модуля (зеркало в `.railway-deploy/src/services/`)

### `src/services/phone-filters.js`
Negative predicates + `classifyRejectionReason` composite:
- `isInnLike` — 10/12 digit без phone-style formatting (нет `(`, `-`, `+`).
- `isOgrnLike` — 13/15 digit bare.
- `isKppLike` — 9 digit bare.
- `isBankAccountLike` — 20 digit bare.
- `isBikLike` — 9 digit, начинается с `04` (RF банк).
- `isPostalCodeLike` — pure 6 digit block.
- `isArticleLike` — смешанный буквенно-цифровой токен.
- `isDateLike` — `dd.mm.yyyy` / `yyyy-mm-dd` / `dd/mm/yyyy`.
- `isRiskyShort` — менее 7 digits.
- `isPhoneDigitCountValid` — 7..15 inclusive (E.164).
- `isLocalOnly` — 7 digit bare subscriber без area code.

Ключевая дискриминация: `hasPhoneStyleFormatting` — наличие `(`, `)`, `digit-digit` дефисов или leading `+` ⇒ это телефон, а не requisite. Убирает коллизию «(812) 606-23-22» (10 digit) с INN.

### `src/services/phone-normalizer.js`
- `stripExtension(raw)` — отделяет `доб`/`ext`/`вн`/`внутр`/`extension`/`x`/`#` → `{main, ext}`.
- `stripLabel(raw)` — детектит `тел`/`моб`/`mob`/`cell`/`phone`/`телефон`/`факс`/`fax`/`т/ф` → `{value, type: phone|fax|phone_or_fax|unknown}`. Приоритет: более специфичный label первым (`т/ф` перед `тел`).
- `canonicalToPlus7(raw)` — унифицирует `+7`/`8`/bare 10 digits → `+7 (XXX) XXX-XX-XX`. Non-RU intl возвращает null.
- `normalizeBareDigits(raw)` — 7/10/11 digit → canonical или null.
- `classifyMobileLandline(canonical)` — RU area code `9xx` → mobile, иначе landline.
- `classifyCountry(canonical)` — prefix lookup (+375 BY, +998 UZ, +86 CN, +49 DE, +77 KZ, +7 RU, …).
- `normalizeIntl(raw)` — trim/collapse для non-RU intl.
- `formatRu10(d10)` — валидирует area code (0xx/1xx/6xx → null), format `+7 (XXX) XXX-XX-XX`.

Paste-safe:
- `WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])"` / `WE = "(?=[^A-Za-zА-Яа-яЁё0-9_]|$)"` — JS `\b` не работает с Cyrillic.
- Label order: phone_or_fax → fax → phone — `т/ф` не даунгрейдится до `тел`.
- Phone regex ordered: RU_PHONE_RE → INTL_PHONE_RE → PAREN_LOCAL_RE → BARE_10_RE.

### `src/services/phone-extractor.js`
Facade cascade (источник → base confidence):
- `form` 0.95
- `signature` 0.9
- `current_message` 0.8
- `contact_lines` 0.75
- `company_blob` 0.6 (misplacement recovery)
- `quoted_thread` 0.55
- `template_footer` 0.4
- `sender_header` 0.35

Candidate generation (per zone):
1. `RU_PHONE_RE` — `+7` / `8` prefix + отступы/скобки/дефисы.
2. `INTL_PHONE_RE` — `+CC` (не `+7`).
3. `PAREN_LOCAL_RE` — `(XXX)` / `(XXXX)` / `(XXXXX)` + subscriber.
4. `BARE_10_RE` — 10 digit без prefix.

Line-label attachment: `applyLineLabels` сканирует каждую строку через `stripLabel`; тип лейбла присваивается кандидату, лежащему в span'е этой строки.

Processing pipeline per candidate:
1. `stripExtension` → сохранить `ext`.
2. `stripLabel` → определить `type` (если лейбл был на той же строке, используется).
3. `classifyRejectionReason` → если `inn_like`/`ogrn_like`/`kpp_like`/`bank_account`/`postal_code`/`article_like`/`date_like`/`digit_count_invalid`/`too_short` → reject.
4. Non-+7 intl → `normalizeIntl` + `classifyCountry`.
5. RU → `canonicalToPlus7` / `normalizeBareDigits` → `classifyCountry` + `classifyMobileLandline`.
6. Post-validate digit count, risky detection.
7. `scoreCandidate` = base by source; dedup by canonical; primary = highest confidence (tie-break: phone > phone_or_fax > unknown > fax).

Reject reasons (surfaced в `rejected[]`): `empty`, `inn_like`, `ogrn_like`, `kpp_like`, `bank_account`, `postal_code`, `article_like`, `date_like`, `digit_count_invalid`, `too_short`, `intl_malformed`, `normalize_failed`.

Output: `{ primary, alt, ext, type, country, isMobile, isLandline, isFax, source, confidence, needsReview, recoveredFromCompany, rawCandidates[], rejected[] }`.

`needsReview` = `confidence < 0.6 || risky || type === "phone_or_fax" || type === "unknown"`.

## Интеграция в `email-analyzer.js` (`extractSender`)

Добавлен импорт `extractPhoneV2`. Заменена цепочка `splitPhones(phones, body)` на facade-каскад:
```js
const phoneResult = extractPhoneV2({
  signature: signature || "",
  body: strippedBody,
  senderDisplay: fromName || "",
  personHint: fioResult.primary || fullNameCompany || null,
  companyHint: rawCompanyName || null,
});
// Распределение по cityPhone/mobilePhone + заполнение новых полей.
if (!phoneResult.primary) {
  const legacySplit = splitPhones(phones, body);
  cityPhone = legacySplit.cityPhone || null;
  mobilePhone = legacySplit.mobilePhone || null;
  if (cityPhone || mobilePhone) { phoneSource = "legacy"; phoneConfidence = 0.5; phoneNeedsReview = true; }
}
```

Legacy `splitPhones` оставлен как fallback для case'ов, где facade ничего не находит (старые KB patterns).

**Новые sender-поля:** `phoneExt`, `phoneType`, `phoneCountry`, `phoneSource`, `phoneConfidence`, `phoneNeedsReview`, `phoneRecoveredFromCompany`, `phoneRejected[]`.

**buildFieldDiagnostic для `phone`** расширен: mapping `SOURCE_CONF` для новых имён источников (`form`, `signature`, `current_message`, `contact_lines`, `company_blob`, `quoted_thread`, `template_footer`, `sender_header`, плюс legacy `body`/`sender_profile`/`legacy`).

## Тесты

`tests/phone-extractor.test.js` — 32 теста:
- 9 filter: isInnLike / isOgrnLike / isKppLike / isBankAccountLike / isPostalCodeLike / isArticleLike / isDateLike / isRiskyShort / isPhoneDigitCountValid
- 6 normalizer: stripExtension (×5 variants) / stripLabel (phone/fax/phone_or_fax/mob/т/ф/tel/fax) / canonicalToPlus7 / classifyMobileLandline / classifyCountry / normalizeBareDigits
- 17 facade: signature phone / 8→+7 / ext split / т/ф classification / факс classification / risky detection / companyHint recovery (misplacement) / INN reject / bank reject / postal reject / form priority / intl non-RU preserved / +7 KZ stays RU / empty input / debug fields / multi-phone dedup / date reject

## Key gotchas (рецидивируют из Phase 5-7)

1. **JS `\b` не работает с Cyrillic** → явные `(?:^|[^A-Za-zА-Яа-яЁё0-9_])` / `(?=[^A-Za-zА-Яа-яЁё0-9_]|$)` lookarounds для label regex.
2. **10-digit bare = INN или phone** — discriminator: phone-style formatting (parens / dash-between-digits / leading `+`).
3. **RU area code validation** — `0xx`/`1xx`/`6xx` отклонять (legacy behaviour preserved).
4. **Label patterns — специфичный первым** — `т/ф` сканить ДО `тел`, иначе `телефон`/факс` downgrade-ится до `phone`.
5. **"Телефон:" не матчится через `тел\b`** — JS `\b` fail, также "тел" + следующая буква "е" не дают WE. Фикс: явный `телефон` alt в regex.
6. **"Current_message" source ≠ "body"** — `buildFieldDiagnostic("phone")` надо расширять, иначе confidence падает до 0.72 и ловится `low_confidence_phone` → risk=medium.
7. **т/ф (3812) 606-232 vs 606-23-22** — `(3812)` это 4-digit area code; национальная часть = 10 digits, 606-232 = 6 digits (valid), 606-23-22 = 7 (invalid без country prefix).

## Git

Commit: `<pending>` · diff: +3 modules (~380 lines) + email-analyzer integration (~55 lines) + tests (~260 lines) + SUMMARY.
