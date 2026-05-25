# Phase 11: Article Foundation - Research

**Researched:** 2026-05-26
**Domain:** Node.js ESM — article extraction pipeline wiring + filter augmentation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Full replacement of inline cascade immediately — delete 500-line inline code from `extractLead()`, replace with call to `extractArticles()` from `article-extractor.js`. No shadow mode.
- **D-02:** After replacement, run reanalysis and compare `article.present%` with baseline Phase 10 (80.7%). If drop > 5%, stop and investigate.
- **D-03:** `extractArticles()` takes `{ subject, body, attachmentText }` and `{ knownBrands, minScore }`. Returns `{ articles, rawCandidates, rejectedCandidates, strictMode, confidence }`. Use `articles` as replacement for inline `allArticles` array.
- **D-04:** Signature zone → hard-exclude: `passing.filter(a => a.zone !== ZONES.SIGNATURE)` after scoring step inside `extractArticles()`.
- **D-05:** Quoted zone → score-filter only (score -= 2, existing behavior). NOT hard-exclude.
- **D-06:** If `currentMessage` + `attachmentText` yield 0 articles, quoted thread can be fallback via score.
- **D-07:** UUID filter in `rejectArticleCandidate()` in `article-filters.js`:
  1. UUID v4: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
  2. Long hex (no dashes) >= 20 chars: `/^[0-9a-f]{20,}$/i`
  - Label: `"uuid_or_long_hex"`
- **D-08:** `dedupKey()` in `article-normalizer.js` already normalizes space/dash — ART-03 already done. No additional work required.
- `lineItemsRaw` stays on existing `extractLineItems()` — NOT replaced.
- Deploy: changes MUST be duplicated in `.railway-deploy/src/services/email-analyzer.js`.

### Claude's Discretion

- Dedup form when collapsing duplicates (MD-025-6L vs MD 025-6L): keep first encountered (current `dedupeCaseInsensitive` behavior).
- Zone traversal order: `SUBJECT → CURRENT → ATTACHMENT → SIGNATURE → QUOTED` (as in `article-extractor.js`).
- `minScore` stays at default (3 normal / 5 strict) — do not change without measured data.
- Tests: add test case for UUID rejection and test for signature hard-exclude in `tests/` with `node:test`.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ART-01 | Zone-aware `article-extractor.js` connected in `extractLead()` replacing 500-line inline regex cascade, eliminating noise from signatures and quoted threads | `extractArticles()` is fully implemented in `article-extractor.js` (333 lines), exports correct interface, has 0 importers — requires import + wiring in `email-analyzer.js`. Signature hard-exclude added in `extractArticles()` step 8 (`passing.filter`). |
| ART-02 | UUID tokens and form-metadata (hex 32+ chars, UUID v4) rejected as articles | `rejectArticleCandidate()` in `article-filters.js` (line 270) has a clear extension point. Two new regex patterns added before the existing `PURE_NUMERIC_RE` check. |
| ART-03 | Dedup key normalizes space and dash — `MD-025-6L` equivalent to `MD 025-6L` | Already implemented in `dedupKey()` at `article-normalizer.js` line 101. Strips ALL non-alnum punctuation/whitespace before uppercasing. No code change needed. |
</phase_requirements>

---

## Summary

Phase 11 is a wiring and filter-augmentation phase with no greenfield logic. The `article-extractor.js` facade (333 lines) is complete and tested — it implements zone-aware extraction, scoring, normalization, and dedup. It currently has zero importers. The sole structural task is replacing the 500-line inline cascade in `extractLead()` with a call to `extractArticles()`, then threading `attachmentText` (already available as `attachmentContent` at call site) into that call.

Two targeted additions are required: (1) a signature hard-exclude filter inside `extractArticles()` after the score threshold step, and (2) two UUID/long-hex rejection rules at the top of `rejectArticleCandidate()` in `article-filters.js`. ART-03 (dedup) requires no code — `dedupKey()` already strips all non-alnum separators before comparison, making space and dash equivalent.

The primary risk is a regression in `article.present%`. The baseline is 80.7% (Phase 10, 300 emails, seed=42). Per D-02, if the post-replacement measurement drops more than 5% (below ~75.7%), implementation must halt. The audit tool is `python scripts/audit_baseline.py --local --limit 300`.

**Primary recommendation:** Wire `extractArticles()`, add signature hard-exclude in-place, add UUID filter in `rejectArticleCandidate()`, run full test suite, run `audit_baseline.py`, confirm article.present >= 75.7%, then copy both changed files to `.railway-deploy/src/services/`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | built-in (Node 25) | Test runner | Already used in all 40+ test files in project |
| `node:assert/strict` | built-in | Assertions | Project convention — no external test frameworks |

No external packages needed. All logic is pure in-process JavaScript using existing modules.

**Installation:** None required.

---

## Architecture Patterns

### Established Pattern: Facade + Filters + Normalizer

All extraction phases (05-09) follow the same structure:

```
*-filters.js        — pure predicate functions, each returns true if token is rejected
*-normalizer.js     — pure transform functions (normalize, dedup, strip)
*-extractor.js      — facade: zoning → candidates → score → filter → normalize → dedup
email-analyzer.js   — imports facade, calls it, maps result to lead fields
```

`article-extractor.js` already follows this pattern. Phase 11 completes the wiring.

### Pattern 1: Replacing `allArticles` in `extractLead()`

**What:** Delete local cascade assignments (`prefixedArticles`, `standaloneArticles`, `numericArticles`, `strongContextArticles`, `trailingMixedArticles`, `productContextArticles`, `subjectArticles`, `attachmentArticles`, `brandAdjacentCodes`, `allArticles` build, sub-token drop, nnn-filter, post-filter) and replace with single `extractArticles()` call.

**Key call site** (`email-analyzer.js` line ~1002, inside `analyzeEmail()`):
```javascript
// Current:
extractLead(subjectForExtraction, bodyForExtraction, attachments, project.brands || [], classification.detectedBrands)

// After phase 11:
extractLead(subjectForExtraction, bodyForExtraction, attachmentContent, project.brands || [], classification.detectedBrands)
```

`attachmentContent` is already defined at line 917:
```javascript
const attachmentContent = sanitizeAttachmentText(attachmentAnalysis.articleText ?? "");
```

**Inside `extractLead()` signature change:**
```javascript
// Before:
function extractLead(subject, body, attachments, brands, kbBrands = [])

// After:
function extractLead(subject, body, attachmentText, brands, kbBrands = [])
```

**New body of article extraction section:**
```javascript
// Article extraction — zone-aware facade
const artResult = extractArticles(
    { subject, body, attachmentText },
    { knownBrands: [...(brands || []), ...(kbBrands || [])], minScore: 3 }
);
let allArticles = artResult.articles;
```

**Preserved:** `lineItemsRaw` (uses `extractLineItems(bodyNoUrls)`) — NOT replaced. `finalArticles` derivation from `allArticles` + `lineItems` merge remains.

**CRITICAL:** The inline cascade also includes a `bodyNoUrls` strip (`body.replace(/https?:\/\/[^\s)]+/gi, " ")`). `article-extractor.js` does NOT do this internally — the URL strip must either remain for `lineItemsRaw` usage or `bodyNoUrls` passed as `body` argument to `extractArticles()`. Decision: pass `bodyNoUrls` as the `body` field to `extractArticles()`, consistent with existing behavior.

**Three call sites** for `extractLead()` exist (lines 1002, 1014, 1024). All must receive `attachmentContent` instead of `attachments` array.

### Pattern 2: Signature Hard-Exclude in `extractArticles()`

Location: `article-extractor.js`, between step 8 (score threshold, line 315) and step 9 (sort, line 318).

```javascript
// Step 8. Score threshold
const passing = accepted.filter((a) => a.score >= effectiveMinScore);

// Step 8b. Signature hard-exclude (D-04): signature zone never yields articles
const passingNoSig = passing.filter((a) => a.zone !== ZONES.SIGNATURE);

// Step 9. Sort by zone priority then score
passingNoSig.sort((a, b) => { ... });

// Step 10. Dedup
const articles = dedupeCaseInsensitive(passingNoSig.map((a) => a.value));
```

**Why after score threshold:** Keeps the existing `score -= 2` demote for signature in `scoreCandidate()` as a debug signal (visible in `rawCandidates`), while hard-excluding them from `passing` in the output.

### Pattern 3: UUID Filter in `rejectArticleCandidate()`

Location: `article-filters.js`, top of the aggregate `rejectArticleCandidate()` function (line 270), before existing checks.

```javascript
// D-07: UUID v4 and long hex strings (form metadata, tracking tokens)
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;

export function rejectArticleCandidate(token, context = {}) {
    if (typeof token !== "string" || !token.trim()) {
        return { rejected: true, reason: "empty" };
    }

    // NEW: UUID / long hex strings — form metadata, tracking tokens
    if (UUID_V4_RE.test(token.trim())) return { rejected: true, reason: "uuid_or_long_hex" };
    if (LONG_HEX_RE.test(token.trim())) return { rejected: true, reason: "uuid_or_long_hex" };

    // ... existing checks unchanged ...
}
```

The two regex constants should be module-level (outside the function) for performance.

### Recommended Change Scope

```
src/services/
├── article-filters.js        — ADD: UUID_V4_RE, LONG_HEX_RE constants + 2 checks in rejectArticleCandidate()
├── article-extractor.js      — ADD: signature hard-exclude filter after step 8
└── email-analyzer.js         — MODIFY: extractLead() signature + wiring; ADD: import extractArticles

.railway-deploy/src/services/
├── article-filters.js        — MIRROR: same changes as src/
├── article-extractor.js      — MIRROR: same changes as src/
└── email-analyzer.js         — MIRROR: same changes as src/

tests/
└── article-extractor.test.js — ADD: UUID rejection test + signature hard-exclude test
```

### Anti-Patterns to Avoid

- **Passing `attachments` array (string[]) to `extractArticles()`:** The facade expects `attachmentText` as a single string. The `attachmentContent` variable (line 917) is the correct value — already sanitized and filtered.
- **Replacing `lineItemsRaw` with facade output:** `extractLineItems()` parses tabular structures (qty, unit, description). The article facade does not. Keep both.
- **Changing `minScore` default:** No measurement supports changing from 3. Keep default.
- **Shadow mode:** Explicitly rejected (D-01). Do not add a feature flag.
- **Forgetting the third `extractLead()` call site:** Lines 1002, 1014, and 1024 all call `extractLead()`. All three must receive `attachmentContent` (string) not `attachments` (array).
- **Modifying `.railway-deploy/` separately in a second step:** Do both files in the same wave to prevent divergence. CLAUDE.md requires both be updated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Article zone detection | Custom body splitter | `splitZones()` from `email-zoning.js` | Already handles quoted/signature markers for RU/EN email formats |
| Article normalization | New `normalizeArticleCode()` | Import from `article-normalizer.js` | WR-/MWR- prefix preservation, cyrillic translit, space collapse — all done |
| Deduplication by space/dash | New dedup function | `dedupeCaseInsensitive()` from `article-normalizer.js` | ART-03 is already implemented via `dedupKey()` stripping all non-alnum |
| UUID detection | Inline regex in extractor | Two constants in `article-filters.js` per D-07 | Centralized in the filter module where all rejections live |

**Key insight:** `article-extractor.js` is a complete, tested system. Every pattern it implements (LABEL_NUMERIC_RE, SKU_LIKE_RE, SKU_MULTIBLOCK_RE, etc.) covers cases the inline cascade handled piecemeal. The 500 inline lines exist because the facade was written after the inline cascade — they were never wired together.

---

## Runtime State Inventory

Step 2.5: SKIPPED — This is a code wiring and filter augmentation phase. No rename, refactor, or migration of stored data.

---

## Common Pitfalls

### Pitfall 1: `attachments` Array vs `attachmentText` String

**What goes wrong:** `extractLead()` currently receives `attachments` (an array of strings from `parseAttachmentHints()`). `extractArticles()` expects `attachmentText` (a single concatenated string). Passing the wrong type silently produces no attachment-sourced articles.

**Why it happens:** The function signatures look similar at the call site.

**How to avoid:** At call site (line 1002), pass `attachmentContent` (already a string at line 917). Change `extractLead()` parameter name from `attachments` to `attachmentText`. Inside `extractLead()`, `attachmentsText` join (line 2817) must use the new string parameter for brand scanning and `hasNameplatePhotos` / `hasArticlePhotos` checks.

**Warning signs:** `artResult.articles` is empty for emails known to have articles in PDF attachments.

### Pitfall 2: Three `extractLead()` Call Sites

**What goes wrong:** Only the primary call (line 1002) is updated. Fallback calls at lines 1014 (quoted body fallback) and 1024 (raw body fallback) still pass the old `attachments` array, causing inconsistent behavior on forwarded/quoted emails.

**How to avoid:** Search for all `extractLead(` occurrences. There are exactly three. Update all three.

### Pitfall 3: `bodyNoUrls` Must Still Be Passed to `extractArticles()`

**What goes wrong:** The inline cascade strips URLs (`bodyNoUrls = body.replace(...)`) before extracting articles, because URL path segments like `trk.mail.ru/t/DGUMAH8.aeb2.Ew50` get extracted as fake article codes. If `extractArticles()` receives raw `body` instead of `bodyNoUrls`, URL-fragment noise re-appears.

**How to avoid:** Define `bodyNoUrls` first (line 2765 in current code), then pass it as the `body` field: `extractArticles({ subject, body: bodyNoUrls, attachmentText }, ...)`.

**Warning signs:** Articles like `aeb2.Ew50`, `DGUMAH8`, `trk.mail.ru` in output.

### Pitfall 4: `attachmentsText` Join for Brand/Hint Detection

**What goes wrong:** Inside `extractLead()`, after the article section, `attachmentsText` is used for brand scanning (line 2896: `stripImageAltTextChain(stripBrandCapabilityList(body))`) and for `hasNameplatePhotos`/`hasArticlePhotos` flags (line 2818-2819). The old code was `const attachmentsText = attachments.join(" ")`. After the parameter rename, this join breaks.

**How to avoid:** The `attachmentText` parameter (string) replaces the array. Change `attachments.join(" ")` to just `attachmentText`. The brand scan already uses `body` (not `attachmentsText`) for the main body — `attachmentsText` is only an additive text for brand detection in `rawBrands` line 2899.

**Warning signs:** Brand detection drops significantly in emails with attachment brand hints.

### Pitfall 5: Forgetting to Mirror `.railway-deploy/`

**What goes wrong:** `src/services/email-analyzer.js` is updated but `.railway-deploy/src/services/email-analyzer.js` is not. Production Railway deployment uses `.railway-deploy/` — the fix never reaches production.

**How to avoid:** Per CLAUDE.md and D-01 context: always copy all three changed files to `.railway-deploy/src/services/`. Verify with `diff` after each file copy. Current state: all three service files are IDENTICAL between `src/` and `.railway-deploy/src/` (verified 2026-05-26).

**Warning signs:** Local tests pass, production audit shows no improvement.

### Pitfall 6: UUID Regex Placement Order

**What goes wrong:** If UUID regex is placed after the `isInnLike()` check, UUID v4 strings (32 hex chars + dashes) that happen to be 10 or 12 digits won't reach the UUID check because `isInnLike` rejects them first — with the wrong reason label.

**How to avoid:** Place UUID checks at the very top of `rejectArticleCandidate()`, before all other checks. The reason label `"uuid_or_long_hex"` is needed for audit visibility.

---

## Code Examples

Verified patterns from the existing codebase:

### Import `extractArticles` in `email-analyzer.js`

```javascript
// Add to existing imports at top of email-analyzer.js
import { extractArticles } from "./article-extractor.js";
```

`article-extractor.js` already imports from `email-zoning.js`, `article-filters.js`, `article-normalizer.js` — no circular dependency risk.

### New `extractLead()` article section (replaces lines 2761-2816)

```javascript
function extractLead(subject, body, attachmentText, brands, kbBrands = []) {
    const freeText = body.trim().slice(0, 2000);
    const searchText = [subject, body].join("\n");
    // Strip URLs before article extraction (URL path segments mistakenly extracted as codes)
    const bodyNoUrls = body.replace(/https?:\/\/[^\s)]+/gi, " ");

    // Zone-aware article extraction (replaces 500-line inline cascade)
    const artResult = extractArticles(
        { subject, body: bodyNoUrls, attachmentText },
        { knownBrands: [...(brands || []), ...(kbBrands || [])], minScore: 3 }
    );
    let allArticles = artResult.articles;

    // attachment metadata for brand/hint detection (attachmentText replaces attachments.join(" "))
    const attachmentsText = attachmentText || "";
    const hasNameplatePhotos = /шильд|nameplate/i.test(attachmentsText);
    const hasArticlePhotos = /артик|sku|label/i.test(attachmentsText);

    // lineItemsRaw — stays on extractLineItems() (tabular data, qty, unit)
    const lineItemsRaw = extractLineItems(bodyNoUrls).filter(...);
    // ... rest of extractLead() unchanged ...
}
```

### UUID filter in `article-filters.js`

```javascript
// Module-level (before rejectArticleCandidate)
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{20,}$/i;

export function rejectArticleCandidate(token, context = {}) {
    if (typeof token !== "string" || !token.trim()) {
        return { rejected: true, reason: "empty" };
    }
    // UUID v4 and long hex strings (form metadata, tracking tokens)
    if (UUID_V4_RE.test(token.trim())) return { rejected: true, reason: "uuid_or_long_hex" };
    if (LONG_HEX_RE.test(token.trim())) return { rejected: true, reason: "uuid_or_long_hex" };
    // ... existing checks unchanged ...
}
```

### Signature hard-exclude in `article-extractor.js`

```javascript
// After step 8 (score threshold), before step 9 (sort):
// Step 8. Score threshold
const passingByScore = accepted.filter((a) => a.score >= effectiveMinScore);

// Step 8b. Hard-exclude signature zone (D-04): signatures never yield article results
const passing = passingByScore.filter((a) => a.zone !== ZONES.SIGNATURE);

// Step 9. Sort by zone priority then score
passing.sort((a, b) => { ... });
```

### Tests to add in `tests/article-extractor.test.js`

```javascript
// ART-02: UUID filter
test("filters:uuid-or-long-hex rejects UUID v4 and long hex strings", () => {
    const { rejectArticleCandidate } = await import("../src/services/article-filters.js");
    const uuid = rejectArticleCandidate("550e8400-e29b-41d4-a716-446655440000");
    assert.ok(uuid.rejected);
    assert.equal(uuid.reason, "uuid_or_long_hex");

    const hex = rejectArticleCandidate("fd3d37534b3f64147b70e0e7bf6a6228");
    assert.ok(hex.rejected);
    assert.equal(hex.reason, "uuid_or_long_hex");

    // real article must pass
    const ok = rejectArticleCandidate("DNC-80-PPV-A");
    assert.equal(ok.rejected, false);
});

// ART-01: signature hard-exclude
test("extractor:signature zone articles hard-excluded from result", () => {
    const result = extractArticles({
        subject: "Запрос",
        body: [
            "Нужен DNC-100-PPV-A — 3 шт.",
            "",
            "С уважением,",
            "Иван Иванов",
            "Менеджер по закупкам",
            "Артикул: QIT3-5033",   // ← in signature zone
        ].join("\n"),
    });
    assert.ok(result.articles.includes("DNC-100-PPV-A"), "body article must be present");
    assert.ok(!result.articles.includes("QIT3-5033"), "signature article must be excluded");
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 500-line inline cascade in `extractLead()` | Zone-aware `extractArticles()` facade | Phase 05-08 built facade, never wired | Inline has no zone awareness, no signature exclusion, no UUID filter |
| `attachments.join(" ")` for article text | `attachmentContent` (sanitized `articleText`) | Phase 07 (requisites files rule) | Prevents INN/OKPO from requisite PDFs leaking into articles |

**Deprecated/outdated:**
- `extractArticlesFromSubject()`, `extractStandaloneCodes()`, `extractNumericArticles()`, `extractStrongContextArticles()`, `extractTrailingMixedArticles()`, `extractProductContextArticles()`, `extractBrandAdjacentCodes()` — all inline helper functions inside `email-analyzer.js`. After Phase 11, `allArticles` comes from facade. These functions can remain as dead code initially (safe to delete in a later phase once regression is confirmed absent).

---

## Open Questions

1. **`forbiddenDigits` set in inline cascade**
   - What we know: `collectForbiddenArticleDigits(body)` builds a set of digit strings found in phone/INN context. The inline cascade uses it as a deny-list in `isLikelyArticle()`. `extractArticles()` does NOT accept `forbiddenDigits`.
   - What's unclear: How much recall loss occurs without this guard. The facade has `isInnLike()` + `isPhoneFragment()` filters which cover most of the same cases.
   - Recommendation: Remove `forbiddenDigits` from `allArticles` path — rely on `rejectArticleCandidate()` filters. Keep it for `lineItemsRaw` (uses `extractLineItems(bodyNoUrls, forbiddenDigits)`) since that path is unchanged. Monitor for INN/phone leaking into articles after Phase 11.

2. **`deduplicateByAbsorption()` in inline cascade**
   - What we know: The inline cascade calls `deduplicateByAbsorption([...subjectArticles, ...], "keep-longest")` and a second pass for sub-token absorption. `dedupeCaseInsensitive()` in the facade does key-based dedup but not absorption.
   - What's unclear: How many emails benefit from the longest-keep merge vs. simple dedup.
   - Recommendation: The facade's `dedupeCaseInsensitive()` is the D-08 solution. Accept it. If audit shows regression from multi-word collapse, investigate then.

3. **Audit script requirement: local data file**
   - What we know: `python scripts/audit_baseline.py --local --limit 300` requires a `data/prod-messages-*.json` file. Phase 10 produced this file. It must be present for the regression check.
   - Recommendation: Planner should include a verification task that confirms the local data file exists before running audit.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 25 | `node:sqlite`, ESM modules, `node:test` | Yes | v25.2.1 | — |
| Python | `audit_baseline.py` regression check | Yes (as `python`) | Confirmed working | — |
| `data/prod-messages-*.json` | `audit_baseline.py --local` | Unknown at research time | — | Fetch from prod with `audit_baseline.py` (no `--local`) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- Local prod-messages JSON: if absent, run `python scripts/audit_baseline.py` (fetches live from Railway production). Requires Railway to be running and admin credentials (already in script constants).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | None — tests run directly |
| Quick run command | `node tests/article-extractor.test.js` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ART-01 | Signature-zone articles excluded from result | unit | `node tests/article-extractor.test.js` | Partial — file exists, new test case needed |
| ART-01 | `extractArticles()` wired in `extractLead()` — body articles extracted correctly | integration (via `npm test`) | `npm test` | Yes — `email-analyzer.test.js` exercises `analyzeEmail()` end-to-end |
| ART-02 | UUID v4 tokens rejected with reason `"uuid_or_long_hex"` | unit | `node tests/article-extractor.test.js` | No — new test needed |
| ART-02 | Long hex (>= 20 chars, no dashes) rejected | unit | `node tests/article-extractor.test.js` | No — new test needed |
| ART-03 | `MD-025-6L` and `MD 025-6L` collapse to one entry | unit | `node tests/article-extractor.test.js` | Partially covered by existing dedup test — explicit MD case not present |

### Sampling Rate

- **Per task commit:** `node tests/article-extractor.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + `audit_baseline.py --local --limit 300` shows article.present >= 75.7%

### Wave 0 Gaps

- [ ] New test: UUID v4 rejection in `tests/article-extractor.test.js`
- [ ] New test: long hex rejection in `tests/article-extractor.test.js`
- [ ] New test: signature zone hard-exclude in `tests/article-extractor.test.js`
- [ ] Optional: MD-025-6L vs MD 025-6L explicit dedup assertion (ART-03 confirmation)

*(Existing test infrastructure covers all other phase behaviors — 151 PASS / 2 FAIL pre-existing [docx/xlsx attachment read on Windows])*

---

## Sources

### Primary (HIGH confidence)

- Direct read of `src/services/article-extractor.js` (333 lines) — full implementation verified
- Direct read of `src/services/article-filters.js` (311 lines) — `rejectArticleCandidate()` structure verified
- Direct read of `src/services/article-normalizer.js` (185 lines) — `dedupKey()` at line 101 verified (strips all non-alnum)
- Direct read of `src/services/email-analyzer.js` lines 2758-3079 — `extractLead()` full implementation verified
- Direct read of `src/services/email-analyzer.js` lines 910-1005 — call sites and `attachmentContent` variable verified
- Direct read of `src/services/email-zoning.js` (82 lines) — `ZONES`, `ZONE_PRIORITY`, `splitZones()` verified
- Direct read of `tests/article-extractor.test.js` — existing test coverage verified (42 tests)
- `diff` verification: all three service files identical between `src/` and `.railway-deploy/src/`
- `npm test` run: 151 PASS / 2 FAIL (pre-existing: docx/xlsx attachment read)
- Direct read of `.planning/config.json` — `nyquist_validation: true`

### Secondary (MEDIUM confidence)

- `scripts/audit_baseline.py` header (lines 1-40) — confirmed `--local --limit 300` invocation and 80.7% baseline from Phase 10 CONTEXT.md

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external libraries, all built-in Node.js
- Architecture: HIGH — all canonical files read, call sites counted, parameter flow traced
- Pitfalls: HIGH — identified from direct code reading (parameter type mismatch, three call sites, URL strip, attachmentsText join)
- Test gaps: HIGH — verified existing test file, identified specific missing cases

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (stable codebase — no framework churn)
