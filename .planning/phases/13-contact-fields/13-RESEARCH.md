# Phase 13: Contact Fields — Research

**Researched:** 2026-05-28
**Domain:** Email entity extraction — FIO blocklist, international phone normalization
**Confidence:** HIGH (all findings from direct source reading)

---

## CONTACT-03 — FIO Blocklist (Template Contamination)

### Contamination Source

`robot@siderus.ru` sends Bitrix web-form notifications. `parseRobotFormBody()` at line 6725 extracts the visitor's name using:

```js
// email-analyzer.js line 6741-6744
const nameMatch =
  formSection.match(/(?:Имя\s+посетителя|ФИО|Контактное\s+лицо):\s*(.+?)[\r\n]/i) ||
  body.match(/Ваше\s+имя\s*[\r\n]\*+[\r\n](.+?)[\r\n]/i) ||
  formSection.match(/^Имя:\s*(.+?)[\r\n]/im);
const name = nameMatch?.[1]?.trim() || null;
```

The result is assigned to `robotFormData.name`. At line 720:

```js
if (robotFormData.name) fromName = robotFormData.name;
```

`fromName` is then passed to `extractSender(fromName, ...)` at line 1001, where it flows into `fioResult` as the `senderDisplay` argument. If the Siderus web form template pre-fills the visitor name field with a placeholder like «Екатерина Попова», that value propagates directly through the form parser into `sender.fullName`.

The template name «Екатерина Попова» is the Siderus form's default/example name. From `tests/batch-c-fixes.test.js` line 109 and 127, it appears in both direct form emails and in quoted-reply bodies. The same name appears as the Siderus «Офис-менеджер» signature in replies — so it can also reach `fullName` via the signature extractor when Siderus replies are threaded in.

### Current FULLNAME_STOPLIST

Location: `src/services/email-analyzer.js` line 299.

```js
const FULLNAME_STOPLIST = /^(?:
  письмо\s+(?:сгенерировано|отправлено|создано)|
  настоящее\s+электронное|
  это\s+(?:письмо|сообщение|email)\s+(?:не|было|является|отправлено)|
  email\s+support\s*[\[(]|
  this\s+(?:email|message|letter|is\s+an?\s+auto)|
  disclaimer|confidential(?:ity)?|legal\s+notice|unsubscribe|
  если\s+вы\s+получили|
  данное\s+(?:письмо|сообщение)\s+является|
  к\s+вам\s+и\s+вашему|
  с\s+уважением\s+к\s+вам|
  всегда\s+рады\s+(?:помочь|вам)|
  ваш\s+(?:надежный\s+)?(?:партнер|поставщик)|
  наш\s+девиз
)/i;
```

This list is boilerplate-phrase oriented. It does NOT contain proper person names (template placeholders). «Екатерина Попова» passes all current filters and passes `PERSON_NAME_SHAPE_RE` cleanly (2 Cyrillic titlecase tokens).

### How validateSenderFields Uses FULLNAME_STOPLIST

`validateSenderFields(sender)` at line 373 checks `sender.fullName` against `FULLNAME_STOPLIST` at lines 377-381. If matched, `sender.fullName = null`. The same regex is checked again inside `sanitizePersonName()` at line 327 (called from step 0b at line 385). Neither check would catch a proper-name-shaped template value.

### Recommended Fix Pattern

**Option B is best:** A separate `FIO_TEMPLATE_BLOCKLIST` — a `Set` of normalized lowercase template names. Checked in `validateSenderFields` after step 0b, before step 1.

Rationale:
- Option A (extend `FULLNAME_STOPLIST` regex) risks false positives if a real client shares the same name. A Set + exact-match is safer and easy to extend.
- Option C (robot@ sender rule) would miss the case where the same template name appears in a quoted-thread form that reaches `quotedRobotFormData`.
- Option B allows per-name entries and costs O(1) lookup.

**Implementation sketch (in `validateSenderFields`, after line 397):**

```js
// Step 0c: reject known template/placeholder names (client-specific blocklist)
const FIO_TEMPLATE_BLOCKLIST = new Set([
  "екатерина попова",
  // add others as discovered
]);
if (sender.fullName && sender.fullName !== "Не определено") {
  if (FIO_TEMPLATE_BLOCKLIST.has(sender.fullName.trim().toLowerCase())) {
    if (!sender.contactNameRaw) sender.contactNameRaw = sender.fullName;
    sender.fullName = null;
    if (sender.sources) sender.sources.name = null;
    corrections++;
  }
}
```

**Known template names to block:**
- `Екатерина Попова` — confirmed from MEMORY.md (session 21.05.2026) and `tests/batch-c-fixes.test.js` lines 109, 127, 143

No other template names have been confirmed in code or test data. Additional entries should be added as they are found in production.

### Where validateSenderFields Is Called

`validateSenderFields(sender)` is called during `analyzeEmail()` post-processing (search for `validateSenderFields` — it is called once on the `sender` object after `extractSender` and all form-data injections). The fix will correctly intercept form-injected names because `fromName` is set from `robotFormData.name` before `extractSender` is called.

---

## CONTACT-04 — International Phone Normalization

### Why +375 / +86 / +994 Fail

There are two separate phone extraction paths. The failure depends on which path is active.

#### Path 1: `extractPhoneV2` facade (primary, `phone-extractor.js`)

`INTL_PHONE_RE` at line 47:
```js
const INTL_PHONE_RE = /\+(?!7[\s(.\-]*\d)\d{1,3}[\s().\-]*\d{1,4}(?:[\s().\-]*\d{2,4}){1,4}/g;
```

This regex **does match** `+375`, `+86`, `+994` correctly. The candidate then enters `processCandidate()` at line 116.

At line 140, the `isIntl` branch fires:
```js
if (/^\s*\+(?!7\D*\d)\d/.test(main)) {
  canonical = normalizeIntl(main);
  country = classifyCountry(canonical);
  isIntl = true;
}
```

`normalizeIntl()` in `phone-normalizer.js` line 179 simply space-collapses the string. It succeeds for well-formatted values.

At line 156, since `isIntl = true`:
```js
const isMobile = !isIntl && ...;  // → false
const isLandline = !isIntl && ...; // → false
```

So `isMobile = false`, `isLandline = false`. Back in `email-analyzer.js` line 2734-2736:
```js
if (phoneResult.primary) {
  if (phoneResult.isMobile) mobilePhone = phoneResult.primary;
  else cityPhone = phoneResult.primary;
```

An intl phone gets stored in `cityPhone`. This is correct behavior.

**The actual failure:** `isPhoneDigitCountValid()` at line 152. For `+375 29 123 45 67`:
- `canonical` after `normalizeIntl` → `"+375 29 123 45 67"` (or similar)
- `stripNonDigits(canonical)` → `"375291234567"` — 12 digits
- `isPhoneDigitCountValid` checks `>= 7 && <= 15` → 12 is valid. Passes.

For `+86 138 1234 5678`:
- digits → `"861381234567"` — 12 digits → valid.

For `+994 50 123 45 67`:
- digits → `"994501234567"` — 12 digits → valid.

So Path 1 **should work** for well-formatted intl numbers. The issue is likely in the **form-phone injection path** (Path 2).

#### Path 2: Form-phone injection (`email-analyzer.js` lines 1010-1024)

For `robot@siderus.ru` and Tilda form emails, phone is injected separately at line 1010-1024:

```js
const formPhone = robotFormData?.phone || tildaFormData?.phone || ...;
if (formPhone && !sender.mobilePhone && !sender.cityPhone) {
  const { mobilePhone, cityPhone } = splitPhones([formPhone], formPhone);
  sender.mobilePhone = mobilePhone || sender.mobilePhone;
  sender.cityPhone = cityPhone || sender.cityPhone;
  if (mobilePhone || cityPhone) {
    sender.sources.phone = ...;
  } else if (formPhone.trim()) {
    // International phone (non-RU) that normalizer rejects — store raw in mobilePhone
    const rawTrimmed = formPhone.trim().replace(/\s{2,}/g, " ");
    if (/^\+\d/.test(rawTrimmed) && rawTrimmed.replace(/\D/g, "").length >= 7) {
      sender.mobilePhone = rawTrimmed;
      sender.sources.phone = ...;
    }
  }
}
```

`splitPhones([formPhone], formPhone)` calls the **legacy** `normalizePhoneNumber()` at line 4413.

`normalizePhoneNumber()` for `+375 29 123-45-67`:
- `intlMatch` at line 4419: `/^\+(\d{1,4})[\s().-]*([\d\s().-]{5,})$/` — matches `+375` with cc=`"375"`, rest=`"29 123-45-67"`.
- `cc !== "7"` → true.
- `restDigits = "29123456789"` (digits only) — length 11? No wait: `"29 123-45-67"` → digits = `"291234567"` = 9 digits.
- **Check at line 4423**: `restDigits.length >= 6 && restDigits.length <= 12` → 9 is in range.
- Returns `"+375 291234567"`.

`splitPhones` → `normalizePhoneNumber` returns a non-null value → `validated = ["+375 291234567"]`. Then `isMobilePhone("+375 291234567")` checks `/\+7 \(9/.test(...)` → false. So `mobilePhone = null`, `cityPhone = "+375 291234567"`. This IS stored.

**The real failure scenario** is that `extractPhoneV2` runs FIRST on `senderBody` (which for form emails is `activeFormData.formSection`). If `extractPhoneV2` finds NO phone in the form section text (e.g., phone label not matching `INTL_PHONE_RE` due to formatting, or the form section text not being passed correctly), `phoneResult.primary = null`. Then the fallback at line 2742 runs `splitPhones(phones, body)` using `phones` collected from `PHONE_PATTERN` + `INTL_PHONE_PATTERN` matched against `body` — but for form emails `body` is the raw full body, so intl phones there should be collected.

**Root cause identified:** The `extractPhoneV2` call at line 2715 uses `senderBody` (the form section), but does NOT use `formFields`. The `extractPhoneV2` interface accepts a `formFields` parameter (object with labeled keys), but the call in `extractSender` passes:

```js
const phoneResult = extractPhoneV2({
  signature: signature || "",
  body: strippedBody,
  senderDisplay: fromName || "",
  personHint: ...,
  companyHint: ...,
});
```

No `formFields` is passed. The form-phone injection fallback at lines 1010-1024 uses the legacy path (`splitPhones`) as the safety net for form phones. The legacy `normalizePhoneNumber` DOES handle intl via its `intlMatch` branch (line 4419).

**Secondary failure vector:** `check_phone` in `audit_baseline.py` at line 324-331:
```python
def check_phone(msg):
    ph = (s.get("mobilePhone") or s.get("cityPhone") or "").strip()
    digits = re.sub(r'\D', '', ph)
    is_noise = bool(OWN_DOMAIN_RE.search(ph)) or not (10 <= len(digits) <= 15)
    return {"present": True, "noise": is_noise}
```

For `+375 291234567`: digits = `"375291234567"` = 12 digits → passes `10 <= 12 <= 15`. Not noise.
For `+86 138...`: digits = 12-13 → passes.
For `+994 50...`: digits = 12 → passes.

**So the audit script already handles intl phones correctly.**

**Actual failure point:** When the intl phone is stored as a raw string (the fallback at line 1021 storing raw `rawTrimmed` directly into `mobilePhone`), it stores e.g. `"+375 29 123-45-67"` with separators. The digit count check in the audit script strips non-digits → 12 digits → correct. But if the raw form value is something like `"+375(29)123-45-67"`, `normalizeIntl` in `phone-extractor.js` does collapse parens to spaces → produces `"+375 29 123-45-67"`.

**Summary of failure:** The main path already works for intl phones in body/signature text. The failure is specifically when:
1. `extractPhoneV2` on the form section fails to match (INTL_PHONE_RE miss on unusual formatting)
2. The legacy `splitPhones` fallback also fails (rare — `INTL_PHONE_PATTERN` is broad)
3. The form-phone injection at line 1011 is the final safety net — it works only if `extractSender` set no phone AND `formPhone` is truthy.

**The real gap:** `extractPhoneV2` is called inside `extractSender()` (line 2715) on `senderBody` without `formFields`. Form phones are injected AFTER `extractSender` returns. If `extractPhoneV2` succeeds with a bogus RU match in the form body template noise (unlikely but possible), it would block the form-phone injection (the guard at line 1011 is `if (formPhone && !sender.mobilePhone && !sender.cityPhone)`).

### Fix Pattern

The cleanest fix is to pass `formFields` to `extractPhoneV2` or to ensure intl form phones are normalized and stored using `normalizeIntl` before the guard check. The existing intl fallback at lines 1017-1024 already does this for form emails. The issue is that `extractPhoneV2` in `phone-extractor.js` — when called from within `extractSender` — does not receive form-field data.

**Recommended fix:** Extend the `extractPhoneV2` call at line 2715 (inside `extractSender`) to accept a `formFields` argument so the phone-extractor's high-confidence `form` source is used directly.

However, `extractSender` doesn't have access to `formFields` — they are available only in the outer `analyzeEmail` scope. The simplest, lowest-risk fix is to ensure the form-phone injection fallback normalizes intl phones before comparison:

```js
// Current (line 1019-1021): stores raw
const rawTrimmed = formPhone.trim().replace(/\s{2,}/g, " ");
if (/^\+\d/.test(rawTrimmed) && rawTrimmed.replace(/\D/g, "").length >= 7) {
  sender.mobilePhone = rawTrimmed;
```

The intl phone gets stored as-is. This is intentional per the J3 batch comment. The storage succeeds. The problem then is classifyCountry on a raw unsplit value — but that isn't called here.

**For non-form emails** with intl phones in the body: `extractPhoneV2` via `INTL_PHONE_RE` handles them correctly via `normalizeIntl` → `classifyCountry`. Those phones land in `cityPhone` (since `isMobile = false` for intl). The `audit_baseline.py` `check_phone` accepts 10-15 digits and so will count them as present/not-noise.

**Test values to verify fix:**
| Input | Expected canonical | Expected country |
|-------|-------------------|-----------------|
| `+375 29 123-45-67` | `+375 29 123-45-67` | BY |
| `+86 138 1234 5678` | `+86 138 1234 5678` | CN |
| `+994 50 123 45 67` | `+994 50 123 45 67` | AZ |
| `+7 916 123-45-67` | `+7 (916) 123-45-67` | RU (not affected) |

---

## Baseline Metrics

From `scripts/baselines/baseline_v1.json` (version 1, created 2026-05-25, n=300):

| Field | present | noise_free |
|-------|---------|-----------|
| **fio** | **0.9533** | **0.9533** |
| **phone** | **0.7433** | **0.7433** |
| inn | 0.7633 | 0.7367 |
| article | 0.7500 | 0.7467 |
| brand | 0.6500 | 0.5833 |
| qty | 0.2600 | -0.23 |
| product_name | 0.6833 | 0.6833 |

The baseline already has `fio.present = fio.noise_free = 0.9533`. This means no known-noise FIO values were detected at baseline creation — the «Екатерина Попова» contamination cases either weren't in the 300-sample or weren't caught as noise (the audit uses `ORG_RE` and `TITLE_RE` checks, not a blocklist). After the fix, `fio.noise_free` should stay ≥ 0.9533 and `fio.present` may slightly decrease (some previously-counted names become null).

`phone.present = phone.noise_free = 0.7433`. After the fix, intl phones that are currently being dropped would increase `phone.present`. The noise check (`10 <= len(digits) <= 15`) already accepts intl digits, so if presence improves, noise_free should track it.

---

## Key Interfaces

### `validateSenderFields(sender)` — `email-analyzer.js`

- **Line 373**: function declaration
- **Lines 377-381**: FULLNAME_STOPLIST check (step 0)
- **Lines 384-397**: `sanitizePersonName` application (step 0b)
- **Lines 399-404**: INN normalization (step 1)
- **Lines 406-411**: company label rejection (step 2)
- The new FIO_TEMPLATE_BLOCKLIST check should be inserted **after line 397** (after step 0b) as step 0c

### `FULLNAME_STOPLIST` — `email-analyzer.js` line 299

Current regex, no proper-name entries. Extension for CONTACT-03 should use a separate `Set`, not extend this regex.

### `JOB_TITLE_STOPLIST` — `email-analyzer.js` line 306

Separate stop-list for position labels. Pattern for FIO_TEMPLATE_BLOCKLIST should mirror this structure.

### `parseRobotFormBody(subject, body)` — `email-analyzer.js` line 6725

Returns `{ name, email, phone, ... }`. `name` at line 6745 is the raw form visitor name. This is where contamination enters. **Fix is NOT here** — the form parser should stay neutral; the blocklist check in `validateSenderFields` is the right gate.

### `extractPhoneV2(input)` — `phone-extractor.js` line 221

Input signature:
```js
{
  formFields: null,   // object with labeled keys — NOT currently passed from email-analyzer
  signature: "",
  body: "",
  senderDisplay: "",
  quotedBody: "",
  footer: "",
  contactLines: "",
  personHint: null,
  companyHint: null,
}
```

Returns `{ primary, alt, ext, type, country, isMobile, isLandline, isFax, source, confidence, needsReview, recoveredFromCompany, rawCandidates, rejected }`.

For intl phones: `isMobile = false`, `isLandline = false` (line 156-157 in phone-extractor.js). They land in `cityPhone` via email-analyzer.js line 2736.

### `normalizeIntl(raw)` — `phone-normalizer.js` line 179

Handles `+XX...` phones (non-+7). Returns space-collapsed string. Does NOT reformat to canonical digit groups — preserves original grouping with normalized separators.

### `normalizePhoneNumber(raw)` — `email-analyzer.js` line 4413

Legacy function. Also handles intl via `intlMatch` at line 4419: `/^\+(\d{1,4})[\s().-]*([\d\s().-]{5,})$/`. Returns `"+CC DIGITS_ONLY"` (no separators in subscriber part). Used by `splitPhones` (the fallback) and by `isOwnCompanyData("phone", ...)`.

### Form-phone injection block — `email-analyzer.js` lines 1009-1025

Called AFTER `extractSender` returns. If `extractPhoneV2` found no phone in the form section, this block injects `formPhone` (from `parseRobotFormBody` or `parseTildaFormBody`). The intl fallback at line 1020-1022 stores raw `rawTrimmed` in `mobilePhone` when `splitPhones` returns nothing.

### `check_phone(msg)` — `scripts/audit_baseline.py` lines 324-331

Reads `sender.mobilePhone` or `sender.cityPhone`. Noise condition: `OWN_DOMAIN_RE` match OR `not (10 <= len(digits) <= 15)`. A well-formed intl phone stored as e.g. `"+375 291234567"` has 12 stripped digits — passes noise check.

---

## Open Questions

1. **Other template FIO names**: Are there other Siderus form template names beyond «Екатерина Попова»? The planner should decide whether to search production data or start with only the known one.

2. **FIO_TEMPLATE_BLOCKLIST location**: Should the Set be defined inline in `email-analyzer.js` near `FULLNAME_STOPLIST` (line ~299), or in a separate module? Given the project's no-frameworks, single-file service pattern, inline is simpler.

3. **Phone: intl routing to mobilePhone vs cityPhone**: Intl phones always land in `cityPhone` (since `isMobile = false`). Is this the desired behavior for Belarus/China/Azerbaijan numbers? The planner should confirm — or add explicit routing logic for known mobile intl prefixes (+375 29/44/25 = mobile BY, etc.).

4. **Phone: INTL_PHONE_RE vs PHONE_PATTERN scope**: `extractPhoneV2` is called on `senderBody` (form section) without `formFields`. If the form section text doesn't contain a recognizable phone pattern (e.g., only the label "Телефон:" appears but the value is on a separate line not matched by the regex), the phone will be missed until the form-phone injection fallback. This is pre-existing behavior. CONTACT-04 fix may be limited to verifying that the existing paths work for the three target country codes — no structural change needed.

5. **Test coverage for CONTACT-03**: Existing `tests/batch-c-fixes.test.js` has `Екатерина Попова` in test fixtures but the tests were written for `stripQuotedReply`, not for FIO extraction. A new unit test for `validateSenderFields` rejecting blocklisted names is needed (Wave 0 gap).

6. **Baseline update**: After Phase 13 is complete, `scripts/baselines/baseline_v1.json` must be regenerated as `baseline_v2.json` to capture the new `fio.noise_free` and `phone.present` values.
