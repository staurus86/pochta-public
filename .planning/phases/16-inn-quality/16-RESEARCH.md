# Phase 16: INN Quality — Research

**Researched:** 2026-05-28
**Domain:** INN extraction — email body parsing, attachment parsing, auto-learning sender profile
**Confidence:** HIGH (all findings verified against production data and source code)

---

## Summary

`inn.present` is **34.7%** (baseline_v6, 300-email sample, post-v1.1 reanalysis). The target is ≥50%.

The gap is **15.3 percentage points** = ~46 more INNs needed per 300 emails. Production analysis of 1769 "Клиент" emails (project-4) shows only 657 (37.1%) have INN. The primary bottleneck is **not a parsing failure** — 65% of emails simply do not contain INN anywhere in the body or as a text-extractable attachment.

The extraction system already works well: 505/657 INNs (76.9%) come from `.doc`/`.docx`/`.xlsx` attachments, 152 (23.1%) from email body. The remaining 1112 no-INN emails break down as:

| Category | Count | Fixable? |
|----------|-------|---------|
| Own Siderus manager reply (no client INN expected) | 341 | No |
| Web form with empty INN field (user didn't fill in) | 182 | No |
| Genuinely no INN data in body or attachments | 616 | No (data absent) |
| Has INN label but empty OR false match (длинна/подлинность) | 93+28=121 | No |
| Body: INN in HTML/markdown markup | 5 | Yes — regex fix |
| Body: INN in ЭДО identifier (2BM-{INN}-{KPP}-...) | 10 | Yes — new pattern |
| Skipped requisites PDFs (scanned/low quality) | 44 | Partial (threshold tune) |
| Same domain/email has INN in another email | 338/271 | Yes — auto-learning |

**Primary recommendation:** The only path to +15pp improvement is implementing **auto-learning sender profile enrichment** — when INN is successfully extracted from any email, store {email → INN, domain → INN} in `company_directory` for future lookups. This can address up to 338 additional INN attributions. Regex fixes alone yield ~13 additional emails (+0.7pp) — not enough to reach target.

---

## Current INN Extraction Flow

All paths that set `sender.inn` (in execution order within `analyzeEmail`):

### Path 1: Form emails (robot@siderus.ru / Tilda)
**File:** `src/services/email-analyzer.js`, line ~1048
```js
const formInn = robotFormData?.inn || tildaFormData?.inn || quotedRobotFormData?.inn;
if (formInn && !sender.inn) {
    sender.inn = normalizeInn(formInn);
    sender.sources.inn = activeFormData === tildaFormData ? "tilda_form" : "robot_form";
}
```
- `parseRobotFormBody` (line 6782): uses `/(?:ИНН\s+организации|ИНН\s+клиента|ИНН)(?:\/КПП)?\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3}|\d{9,12})/i`
- `parseTildaFormBody` (line 6721): uses `fields["инн"]` key lookup + regex fallback

### Path 2: Body text via `extractSender` → `extractRequisites`
**File:** `src/services/email-analyzer.js`, line 2651 and 6916
```js
const requisites = extractRequisites(body);
// → sender.inn = normalizeInn(requisites.inn)  (line ~2855)
```
`extractRequisites` (line 6916):
1. First tries ИНН/КПП combined: `/(?:ИНН|inn)\/КПП\s*[:#-]?\s*(\d{9,12})\/(\d{9})/i`
2. Then `INN_PATTERN` at line 60: `/(?:ИНН|inn|УНП)(?:\/КПП)?\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3}|\d{9,12})/i`
3. Result filtered by `filterInn()` — drops own INN (9701077015) and EDO-context lines

### Path 3: Attachment requisites via `mergeAttachmentRequisites`
**File:** `src/services/email-analyzer.js`, line 2259
```js
function mergeAttachmentRequisites(sender, attachmentAnalysis) {
    const files = attachmentAnalysis?.files || [];
    const allInn = [...new Set(files.flatMap(f => f.detectedInn || []))]
        .filter(inn => !isOwnInn(inn));
    if (!sender.inn && allInn.length >= 1) {
        const innWithKpp = files.find(f => f.detectedInn?.length > 0 && f.detectedKpp?.length > 0);
        sender.inn = normalizeInn(innWithKpp ? innWithKpp.detectedInn[0] : allInn[0]);
        sender.sources.inn = "attachment";
    }
}
```
Attachment INN detection is in `attachment-content.js` lines 245-257:
- Bare digit match: `INN_PATTERN = /\b\d{10,12}\b/g` (unanchored)
- Labeled spaced: `INN_LABELED_SPACED = /(?:ИНН|инн|inn)\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3})(?!\d)/gi`
- Only returns INNs that pass `validateInnChecksum`

### Path 4: Company directory lookup via `applyCompanyDirectoryHints`
**File:** `src/services/email-analyzer.js`, line 2229
```js
if (!sender.inn && directoryEntry.inn) {
    sender.inn = normalizeInn(directoryEntry.inn);
    sender.sources.inn = "company_directory";
}
```
Lookup order: email exact match → INN match → domain match → company name fuzzy match.
**Currently: 0 emails get INN via this path in production** (company_directory has no INN-bearing entries for these senders).

### Path 5: INN normalization and validation
**File:** `src/services/email-analyzer.js`, line 379 (`validateSenderFields`), line 415
All set `sender.inn` values pass through `normalizeInn(v)`:
- Strips non-digits
- Accepts: 9-digit (Belarus УНП, no checksum), 10-digit (RU org), 12-digit (RU ИП)
- Validates 10/12-digit via FNS mod-11 checksum (`validateInnChecksum`)
- Returns `null` on failure

---

## Regex Patterns

### Current body INN_PATTERN (line 60, email-analyzer.js)
```js
/(?:ИНН|inn|УНП)(?:\/КПП)?\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3}|\d{9,12})/i
```

### Current attachment INN_PATTERN (line 29, attachment-content.js)
```js
/\b\d{10,12}\b/g  // unanchored, picks up any 10-12 digit number
```

### Format coverage matrix

| Format | Example | Current handles? | Gap |
|--------|---------|-----------------|-----|
| Labeled with colon | `ИНН: 7707083893` | YES | — |
| Labeled with space | `ИНН 7707083893` | YES | — |
| Labeled combined | `ИНН/КПП: X/Y` | YES | — |
| No separator | `ИНН7707083893` | YES | — |
| Double space | `ИНН  7707083893` | YES | — |
| Newline | `ИНН\n7707083893` | YES | — |
| Lowercase | `инн 7707083893` | YES | — |
| English | `INN: 7707083893` | YES | — |
| Belarus | `УНП 123456789` | YES | — |
| **Em-dash** | `ИНН — 7707083893` | **NO** | `[:#-]` does not include em-dash |
| **En-dash** | `ИНН – 7707083893` | **NO** | Same |
| **Spaced 5-group** | `ИНН: 77 07 08 38 93` | **NO** | `{1,3}` allows max 4 groups = 8 digits max |
| **Markdown bold** | `*ИНН/КПП: *9704125161/...` | **NO** | `*` breaks label match |
| **HTML tag** | `ИНН 2724120169</span>` | Regex matches, but HTML in body prevents it | Need body HTML-strip before parsing |
| **Parenthetical** | `ИНН (организации): X` | **NO** | No `(?:\s*\([^)]+\))?` in pattern |
| **ЭДО identifier** | `2BM-4028058061-402801001-...` | **NO** | No EDO pattern exists |
| **Belarus UNN** | `УНН 123456789` | **NO** | УНН not in pattern (УНП is) |
| Bare (body) | `7707083893` (no label) | **NO** | Body pattern requires label |
| Bare (attachment) | `7707083893` (no label) | YES (attachment only) | Attachment uses bare-digit pattern |

### Key miss: spaced 5-group INN
`ИНН: 77 07 08 38 93` = 5 space-separated groups totaling 10 digits.
Current pattern `(\d{1,6}(?:\s\d{1,6}){1,3})` captures at most 4 groups = `77 07 08 38` (8 digits, rejected by normalizeInn).
Fix: change `{1,3}` to `{1,9}` (allows 2–10 groups, normalizeInn rejects wrong lengths anyway).

---

## Root Cause Hypothesis

**Hypothesis 1 (CONFIRMED): Most emails simply don't contain INN**
- 341 emails are Siderus manager replies (own signature, no client INN)
- 182 are web forms where user left INN field blank
- 616 have no INN in any parseable source
- These 1139 emails (64.4%) are structurally INN-absent — no parsing change helps them

**Hypothesis 2 (CONFIRMED): Scanned PDFs fail text extraction**
- 44 requisites PDFs skipped for `low_quality_pdf_text` reason
- Previews show binary content (encrypted/compressed PDFs) or PDF cross-reference tables
- These PDFs are scanned documents — OCR required to extract text
- `isUsablePdfText` correctly identifies these as non-parseable

**Hypothesis 3 (CONFIRMED): ~13 emails have parseable INN that current regex misses**
- HTML/markdown formatting around INN: 5 emails
- ЭДО identifier with embedded INN: 10 emails
- Em-dash separator: 0 found in production (minor)
- Spaced 5-group: 0 found in production (minor)

**Hypothesis 4 (CONFIRMED): Auto-learning is the main gap**
- 338 no-INN emails come from domains that previously provided INN in other emails
- 271 no-INN emails from exact email addresses that previously provided INN
- No auto-write mechanism exists: `company_directory` is only populated by manual import
- `upsertSenderProfile` (line 1113) writes to `sender_profiles`, NOT `company_directory` — no INN field in sender_profiles

---

## Fix Patterns

### Fix A: Body INN_PATTERN improvements (email-analyzer.js line 60)
**Impact: ~13 additional emails**

```js
// BEFORE (line 60):
const INN_PATTERN = /(?:ИНН|inn|УНП)(?:\/КПП)?\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3}|\d{9,12})/i;

// AFTER:
const INN_PATTERN = /(?:ИНН|inn|УНП|УНН)(?:\/КПП)?(?:\s*\([^)]{0,30}\))?\s*[:#\-–—]?\s*(\d{1,6}(?:\s\d{1,6}){1,9}|\d{9,12})/i;
```
Changes:
- Added `УНН` (Belarus alternate abbreviation)
- Added `(?:\s*\([^)]{0,30}\))?` for parenthetical qualifiers ("организации", "клиента")
- Added `–—` (en-dash, em-dash) to separator character class
- Changed spaced-group limit from `{1,3}` to `{1,9}` (allows up to 10 groups, handles 5-group `77 07 08 38 93`)

**Also apply to** `parseTildaFormBody` regex (line 6775) and `parseRobotFormBody` (line 6841).

### Fix B: HTML/markdown stripping before extractRequisites (email-analyzer.js)
**Impact: ~5 additional emails**

Before calling `extractRequisites(body)` in `extractSender`, strip light markup:
```js
function stripLightMarkup(text) {
    return String(text || "")
        .replace(/<[^>]{0,200}>/g, " ")   // HTML tags
        .replace(/\*{1,3}/g, " ")           // Markdown bold/italic (*text*, **text**, ***text***)
        .replace(/_{1,2}/g, " ")            // Markdown underline
        .replace(/\|/g, " ")               // Table pipes
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ");
}
// In extractRequisites: apply to text before pattern matching
// OR: pass stripLightMarkup(body) to extractRequisites in extractSender
```

### Fix C: ЭДО identifier pattern (email-analyzer.js `extractRequisites`)
**Impact: ~10 additional emails**

ЭДО operator identifiers (Taxcom, СБИС) embed INN+KPP: format `2BM-{10-digit INN}-{9-digit KPP}-{timestamp}`
```js
// Add to extractRequisites after existing patterns:
const EDO_INN_PATTERN = /\b2[A-Z]{2}-(\d{10})-(\d{9})-\d{14,}/i;
const edoMatch = text.match(EDO_INN_PATTERN);
if (edoMatch && !rawInn) {
    rawInn = filterInn(edoMatch[1], text);
    // Also extract KPP from position 2
}
```
Note: EDO identifiers also appear on lines containing "ЭДО" context — the existing `EDO_CONTEXT_PATTERN` filter would suppress this. Must ensure `hasClientMarker` check doesn't over-filter when INN comes from EDO ID in client signature.

### Fix D: Auto-learning company_directory enrichment (THE MAIN FIX)
**Impact: up to +338 emails = ~+19pp**

After a successful email analysis where `sender.inn` is set and `classification.label === "Клиент"` and `sender.sources.inn !== "company_directory"`, write back to `company_directory`:

```js
// In analyzeEmail, after validateSenderFields + hydrateRecognitionSummary:
if (sender.inn && classification.label === "Клиент" && sender.sources?.inn !== "company_directory") {
    const emailDomain = fromEmail?.split("@")[1]?.toLowerCase() || "";
    if (emailDomain && !FREE_EMAIL_DOMAINS.has(emailDomain)) {
        detectionKb.upsertCompanyDirectoryEntry({
            email: fromEmail,
            emailDomain,
            inn: sender.inn,
            companyName: sender.companyName || "",
            kpp: sender.kpp || "",
        });
    }
}
```

This requires adding `upsertCompanyDirectoryEntry` to `detection-kb.js`:
```js
upsertCompanyDirectoryEntry({ email, emailDomain, inn, companyName, kpp }) {
    // ON CONFLICT(email) DO UPDATE SET inn = excluded.inn WHERE inn = '' OR inn IS NULL
    // This way manual entries with INN are not overwritten by auto-learned ones
    this.db.prepare(`
        INSERT INTO company_directory (email, email_domain, inn, company_name, source_file, is_active)
        VALUES (?, ?, ?, ?, 'auto_learned', 1)
        ON CONFLICT(email) DO UPDATE SET
            inn = CASE WHEN inn = '' OR inn IS NULL THEN excluded.inn ELSE inn END,
            company_name = CASE WHEN company_name = '' THEN excluded.company_name ELSE company_name END
    `).run(email, emailDomain, inn, companyName);
    // Do NOT invalidate cache per-message — cache is rebuilt at startup or by explicit call
}
```

**CRITICAL constraint:** `company_directory` has `UNIQUE(email)` constraint (line 1591: `ON CONFLICT(email) DO UPDATE`). Only write when non-free email domain. Free email domains: gmail.com, mail.ru, yandex.ru, etc. — check against `FREE_EMAIL_DOMAINS` set (already exists in detection-kb.js).

---

## Key Interfaces

### `extractRequisites` (email-analyzer.js:6916)
```js
function extractRequisites(text) {
    const innKppMatch = text.match(/(?:ИНН|inn)\/КПП\s*[:#-]?\s*(\d{9,12})\/(\d{9})/i);
    // ...
    const rawInn = innKppMatch?.[1] || text.match(INN_PATTERN)?.[1] || null;
    return {
        inn: filterInn(rawInn, text),
        kpp: innKppMatch?.[2] || text.match(KPP_PATTERN)?.[1] || null,
        ogrn: text.match(OGRN_PATTERN)?.[1] || null
    };
}
```
**Lines 6916–6946.** Single call site: `extractSender` line 2651.

### `INN_PATTERN` (email-analyzer.js:60)
**Line 60.** Used exclusively inside `extractRequisites` (line 6940). Also implicitly used in form parsers which have inline patterns.

### Form parser INN patterns:
- `parseRobotFormBody` inline pattern: line 6841 — same separator issue
- `parseTildaFormBody` inline pattern: line 6775 — same separator issue

### `mergeAttachmentRequisites` (email-analyzer.js:2259)
**Lines 2259–2277.** Called at line 1066. No code changes needed here — attachment INN detection is in `attachment-content.js`.

### `attachment-content.js` INN patterns:
- Line 29: `INN_PATTERN = /\b\d{10,12}\b/g` — bare digit, no label needed
- Line 250: `INN_LABELED_SPACED` for spaced groups
- Line 256: filters by `validateInnChecksum`

### `applyCompanyDirectoryHints` (email-analyzer.js:2229)
**Lines 2229–2257.** Called twice: lines 1065 and 1067 (after `mergeAttachmentRequisites`).

### `lookupCompanyDirectory` (detection-kb.js:1642)
Lookup priority: email → INN → domain → company name fuzzy.
**Line 1642.** No write path exists today.

### `importCompanyDirectory` (detection-kb.js:1575)
Batch import, ON CONFLICT(email) DO UPDATE. Does NOT store auto-learned entries.

### `validateSenderFields` (email-analyzer.js:379)
Called at line 1907. Runs `normalizeInn(sender.inn)` and sets to null if invalid.
**This means: if `sender.inn` has been set to a checksum-invalid value at any earlier stage, it's nulled here.** This is correct behavior.

---

## Test Values

Valid INNs from production data (confirmed by mod-11 checksum):

| INN | Type | Source |
|-----|------|--------|
| `7707083893` | RU_ORG (Сбербанк) | Standard test from existing tests |
| `7701234507` | RU_ORG | Existing test fixture |
| `7702802784` | RU_ORG | Existing test fixture |
| `7812345675` | RU_ORG | Existing test fixture |
| `500100732259` | RU_IP | Existing test fixture (12-digit) |
| `9704125161` | RU_ORG | Production (in markdown: `*ИНН/КПП: *9704125161/...`) |
| `2724120169` | RU_ORG | Production (in HTML: `ИНН 2724120169</span>`) |
| `5503209174` | RU_ORG | Production (in subject: `ИНН :5503209174`) |
| `4028058061` | RU_ORG | Production (in EDO ID: `2BM-4028058061-402801001-...`) |
| `7810694423` | RU_ORG | Production (full requisites block) |
| `2224169328` | RU_ORG | Production (from .doc attachment) |
| `123456789`  | BY (УНП) | 9-digit Belarus, no checksum |

INN that should be **rejected** (own company):
- `9701077015` — OWN_COMPANY_IDENTITY.inn (Siderus/Kolovrat)

---

## Quantified Impact Estimate

| Fix | Additional INNs (1769 emails) | +pp in 300-sample |
|-----|-------------------------------|-------------------|
| A: INN_PATTERN improvements | ~3 (em-dash, spaced-5) | +0.2pp |
| B: HTML/markdown strip | ~5 | +0.3pp |
| C: ЭДО identifier pattern | ~10 | +0.6pp |
| D: Auto-learning directory | ~250–338 | +14–19pp |
| **Total** | **~268–356** | **+15–20pp** |

Fix D is the only path to the 50% target. Fixes A–C are correctness improvements worth doing but insufficient alone.

---

## Architecture Patterns

### Existing test pattern for INN in analyzeEmail tests
```js
runTest("extracts INN from body requisites block", () => {
    const analysis = analyzeEmail(project, {
        fromEmail: "sales@factory.ru",
        body: `ИНН: 7701234507\nКПП: 770101001`,
        ...
    });
    assert.equal(analysis.sender.inn, "7701234507");
});
```

### Test pattern for attachment INN
```js
withStoredAttachment(messageKey, "rekvizity.txt", "ИНН 7702802784\nКПП 770201001", ({safeName, size}) => {
    const result = analyzeEmail(project, { attachmentFiles: [{filename: "rekvizity.txt", safeName, size}] });
    assert.equal(result.sender.inn, "7702802784");
});
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| INN checksum | Custom mod-11 | `validateInnChecksum` (email-analyzer.js:254) — already exported |
| INN normalization | Custom strip+validate | `normalizeInn` (email-analyzer.js:275) — already exported |
| Free email domain list | Custom set | `FREE_EMAIL_DOMAINS` (detection-kb.js) — already exists |
| Company directory upsert | Raw SQL | Extend existing `importCompanyDirectory` or add `upsertCompanyDirectoryEntry` |

---

## Common Pitfalls

### Pitfall 1: Spaced INN groups — 4-group limit
**What goes wrong:** `ИНН: 77 07 08 38 93` captures only `77 07 08 38` (8 digits, invalid length, rejected)
**Why:** `{1,3}` allows only 3 additional groups after the first = 4 total
**How to avoid:** Change to `{1,9}` — `normalizeInn` will reject wrong lengths anyway

### Pitfall 2: EDO filter over-suppression
**What goes wrong:** INN in signature block "Наш ЭДО: 2BM-{INN}" gets dropped by `EDO_CONTEXT_PATTERN`
**Why:** `filterInn` checks if the INN's line contains EDO context words
**How to avoid:** When extracting INN from an EDO identifier pattern specifically, skip the EDO context filter (or treat it as a client marker)

### Pitfall 3: Auto-learning writing own INN
**What goes wrong:** Some emails from Siderus staff still classified as "Клиент" (reply threading) — auto-write stores `9701077015`
**Why:** `isOwnInn` check is applied to extracted INN but `sender.inn` passed to auto-write may have slipped through
**How to avoid:** Always check `isOwnInn(sender.inn)` before writing to company_directory

### Pitfall 4: Free email domain pollution
**What goes wrong:** `gmail.com` domain entry gets INN from one sender, applied to all gmail senders
**Why:** domain lookup in `lookupCompanyDirectory` matches any sender from that domain
**How to avoid:** Only write domain entry if `!FREE_EMAIL_DOMAINS.has(emailDomain)` — already checked in `lookupCompanyDirectory` line 1671

### Pitfall 5: attachmentAnalysis.files empty for non-text attachments
**What goes wrong:** Email has requisites PDF but `detectedInn = []` because PDF was skipped for `low_quality_pdf_text`
**Why:** `isUsablePdfText` rejects PDFs with binary content (correct behavior — these are scanned images)
**How to avoid:** OCR would be needed; for Phase 16 scope, accept this limitation

### Pitfall 6: Baseline measurement requires reanalysis
**What goes wrong:** Testing fix against stored DB gives misleading baseline
**Why:** `audit_baseline.py` reads stored `sender.inn` from DB, not live re-extraction
**How to avoid:** After deploying code changes, trigger a full reanalysis of both projects before running `audit_baseline.py`

---

## Open Questions

1. **Auto-write timing: in analyzeEmail or as a post-analysis hook?**
   - `analyzeEmail` is a pure function — adding a DB write introduces a side effect
   - Alternative: write to company_directory in the HTTP handler that processes analysis results (`server.js`)
   - Recommendation: write in the handler, not in `analyzeEmail`, to keep analyzer pure

2. **Should auto-learned entries overwrite manual entries?**
   - Manual entries may have more accurate INN (hand-curated)
   - Recommendation: `ON CONFLICT(email) DO UPDATE SET inn = CASE WHEN inn = '' OR inn IS NULL THEN excluded.inn ELSE inn END` — never overwrite non-empty manual INN

3. **Does `company_directory` UNIQUE constraint include email_domain?**
   - Current schema: `UNIQUE(email)` only (line 1591)
   - Domain-based auto-learned entries would have empty `email` — would conflict if two entries for same domain
   - Decision needed: add domain-keyed entries separately, or only write email-keyed entries

4. **Scope of Phase 16: only regex fixes, or include auto-learning?**
   - Regex fixes (A+B+C): ~0.7–1.1pp improvement — does NOT reach 50% target
   - Auto-learning (D): required to reach target but is larger scope
   - Recommendation: implement both; auto-learning is the primary deliverable

5. **attachment-content.js INN_LABELED_SPACED also has the 4-group limit:**
   - Line 250: `(\d{1,6}(?:\s\d{1,6}){1,3})` — same issue as body pattern
   - Fix: change to `{1,9}` in both files

---

## Environment Availability

Step 2.6: SKIPPED — Phase 16 is code/config changes only. No external dependencies beyond Node.js ≥ 25 and existing SQLite (`node:sqlite`).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | none — direct `node` invocation |
| Quick run command | `node tests/batch-16-fixes.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Command |
|-----|----------|-----------|---------|
| INN-A | `ИНН – 7707083893` (em-dash) extracted | unit | `node tests/batch-16-fixes.test.js` |
| INN-B | `ИНН: 77 07 08 38 93` (5-group) extracted | unit | same |
| INN-C | `*ИНН/КПП: *9704125161/...` (markdown) extracted | unit | same |
| INN-D | `2BM-4028058061-402801001-...` (EDO ID) extracted | unit | same |
| INN-E | HTML-wrapped INN extracted | unit | same |
| INN-F | Auto-learned entry used on next email from same domain | unit | same |
| REG-1 | `длинна` / `подлинность` do not trigger INN extraction | unit | same |
| REG-2 | Own INN (9701077015) still rejected | unit | same |
| REG-3 | Empty INN field in robot form = null INN | unit | same |

### Wave 0 Gaps
- [ ] `tests/batch-16-fixes.test.js` — all INN-A through INN-F + regression tests (new file)

---

## Sources

### Primary (HIGH confidence)
- `src/services/email-analyzer.js` — all INN extraction paths, patterns, normalizeInn, validateInnChecksum
- `src/services/attachment-content.js` — INN_PATTERN, INN_LABELED_SPACED, isUsablePdfText
- `src/services/detection-kb.js` — company_directory schema, lookupCompanyDirectory, importCompanyDirectory
- `.planning/phases/01-detection-fixes/prod_cycle6_project-4-klvrt-mail.json` — 2245 production emails analyzed
- `scripts/baselines/baseline_v6.json` — current metrics (inn.present = 34.7%)
- `scripts/DELTA.md` — why INN dropped from 73% to 35% (checksum validation added)

### Secondary (MEDIUM confidence)
- `scripts/audit_baseline.py` — `check_inn` function: `present=False` means `sender.inn` is null or fails `inn_digits()` extraction

---

## Metadata

**Confidence breakdown:**
- Current flow analysis: HIGH — read directly from source code
- Root cause analysis: HIGH — verified against 2245 production emails
- Quantified impact: MEDIUM — based on 1769 project-4 emails; project-3 adds ~130 more with similar distribution
- Fix design: HIGH for A–C (direct regex changes); MEDIUM for D (architecture decision on write timing not yet made)

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (stable domain, 30-day validity)
