# Phase 14: Brand & Product-Name Quality Fixes — Research

**Researched:** 2026-05-28
**Domain:** Brand detection, product-name normalization, deduplication
**Confidence:** HIGH

---

## Summary

Four targeted fixes are needed. Two concern brand detection (BRAND-02: subject-priority guarantee; BRAND-03: short-alias rejection). Two concern product-name quality (PROD-01: numbered-list string cleanup; PROD-02: duplicate collapse for HTML-residue variants).

The subject-priority fix (BRAND-02) is complicated by a chain of body-grounding gates (P15 at line 1307, P18 at line 1370, SPAM at line 910) that actively drop brands found only in the subject. Any fix must either bypass the gate for subject-confirmed brands or preserve the subject confirmation through the gate.

The short-alias rejection (BRAND-03) affects two independent code paths: `detectionKb.detectBrands()` in `detection-kb.js` (line 1811 — threshold is currently `< 4` for applying word-boundary) and the local `detectBrands()` in `email-analyzer.js` (line 6466). Neither path has a hard minimum-length block for 1-3 char aliases; they rely on `BRAND_FALSE_POSITIVE_ALIASES` for known offenders.

PROD-01 (numbered-list productNames) already has infrastructure in place: `stripListNumberPrefix` in `product-name-normalizer.js` (line 169) strips leading `N.` / `N)` from individual names. However the audit script's `check_product_name` in `audit_baseline.py` has a bug — it applies `NUMBERED_LIST_RE` against `str(dict)` Python representations instead of extracting `.name` from each dict, so the baseline never measured PROD-01 noise. The fix is in the JS `productNames[].name` inline-cleanup at lines 1564–1579 in `email-analyzer.js`, which must also strip the full-line pattern `"N. description — qty шт."`.

PROD-02 (HTML-residue duplicates) is already handled for `productNamesClean` by `dedupByCanonical` in `product-name-extractor.js`, but `productNames[]` in-place dedup at lines 1561–1592 of `email-analyzer.js` uses `canonicalNameKey` which does NOT call `stripHtmlResidue`, so two entries differing only by a `<br>` fragment or `&amp;` produce different canonical keys.

**Primary recommendation:** Fix BRAND-02 by tracking subject-matched brands separately and exempting them from the body-grounding gates. Fix BRAND-03 by adding `alias.length <= 3` guard in both `detectBrands` paths. Fix PROD-01 by extending the inline `productNames[].name` cleanup regex to cover the full `"N. text — N шт."` pattern. Fix PROD-02 by applying `stripHtmlResidue` inside `canonicalNameKey` before building the dedup key.

---

## BRAND-02 — Subject Priority

### Current Detection Flow

`classifyMessage()` in `detection-kb.js` (line 1714) is the first brand scan entry. It calls `this.detectBrands([scopes.subject, scopes.body, scopes.attachment].join("\n"), projectBrands)` at line 1769. Subject IS included in this initial scan.

In `analyzeEmail()` in `email-analyzer.js`, the chain proceeds:

1. **Line 708**: `detectAutoReply(subject, ...)` — subject available.
2. **Line 760** (approximately): `detectionKb.classifyMessage({ subject, body, ... })` — returns `classification.detectedBrands` (subject+body+attachment scanned).
3. **Line 880**: `classification.detectedBrands = detectionKb.filterOwnBrands(...)`.
4. **Line 886**: `sanitizeBrands(classification.detectedBrands)`.
5. **Line 910 (SPAM gate)**: For SPAM emails, drops brands not found in `primaryBody || body` (subject not included in grounding text at this point).
6. **Line 992**: Attachment brands merged.
7. **Line 1069**: `extractLead(subjectForExtraction, bodyForExtraction, ...)` — inside, `detectBrands([subject, brandScanBody, attachmentsTextForBrands].join("\n"), brands)` at line 2984. Subject IS included.
8. **Line 1307 (P15 gate)**: `classification.detectedBrands` filtered to brands grounded in `[bodyForExtraction, attachmentContent]` — subject NOT included in grounding text. Brands found ONLY in subject are dropped.
9. **Line 1323**: `lead.detectedBrands` assembled from `classification.detectedBrands`.
10. **Line 1345 — Line 1387 (P18 gate)**: `lead.detectedBrands` filtered similarly — only when `!hasConcreteLeadContent`. Grounding text is again `[bodyForExtraction, attachmentContent]` — subject excluded.
11. **Line 1393 (primary zone filter)**: For ≥5 brands with quoted content, further filters to `subject + primaryBody` zone — subject IS included here.

### The Gap

A brand mentioned ONLY in the email subject (e.g., `"Запрос на оборудование Siemens"`, body has no "Siemens") will:
- Be found by `classifyMessage.detectBrands` (subject+body scan).
- Survive through `filterOwnBrands` and `sanitizeBrands`.
- Be DROPPED at the P15 gate (line 1307) because `buildBrandGroundingCheck()` only looks at `[bodyForExtraction, attachmentContent]`.
- If the P15 gate drops it, it never reaches `lead.detectedBrands`.

### Fix Pattern

**Option A (recommended): Track subject-grounded brands before P15, exempt them.**

Before the P15 gate (line 1307), scan the subject for brands that appear there:

```javascript
// At line ~1300, after the grounding check function is built
const subjectLower = String(subject || "").toLowerCase();
const subjectGroundedBrands = new Set(
  (classification.detectedBrands || []).filter((brand) => {
    const b = String(brand || "").toLowerCase();
    const aliases = (kbAliasesForBrand.get(b) || []).concat([b]);
    return aliases.some((al) => al.length >= 4 && new RegExp(`\\b${escapeRegExp(al)}\\b`, "i").test(subjectLower));
  })
);
```

Then in the P15 filter, keep brands in `subjectGroundedBrands`:

```javascript
const groundedBrands = (classification.detectedBrands || []).filter(
  (b) => isBrandGrounded(b) || subjectGroundedBrands.has(String(b).toLowerCase())
);
```

Apply same exemption at P18 gate (line 1375).

**Option B (simpler): Include subject in grounding text for `buildBrandGroundingCheck()`.**

Change line 1252:
```javascript
// Before:
const groundingText = [bodyForExtraction, attachmentContent].filter(Boolean).join("\n\n");
// After:
const groundingText = [subject, bodyForExtraction, attachmentContent].filter(Boolean).join("\n\n");
```

Risk: reintroduces the problem the P15 gate was designed to fix — WordPress auto-form spams with brand in subject but no real body content. The SPAM-early-exit path at line 895 handles pure-SPAM, but for non-spam forms this could re-open the ghost-brand problem.

**Recommendation: Option A** — explicit subject-brand tracking is safe because it only bypasses grounding for brands that the subject itself confirms. The alias length guard (`>= 4`) prevents single-char matches.

### Exact Insertion Points

- `buildBrandGroundingCheck` definition: line 1251
- P15 gate: lines 1307–1320
- P18 gate: lines 1370–1387
- The `kbAliases` map is built inside `buildBrandGroundingCheck` at lines 1263–1272 — must be accessible outside (extract to shared variable).

---

## BRAND-03 — Short Alias Rejection

### Current Alias Matching Path

There are TWO `detectBrands` implementations:

**Path 1: `DetectionKB.detectBrands(text, projectBrands)` — `detection-kb.js` line 1773**

Current length logic at line 1811:
```javascript
if (!/\s/.test(alias) || alias.length < 4 || BRAND_WORD_BOUNDARY_ALIASES.has(alias)) {
```
This applies word-boundary matching for any alias that: is single-word OR has length < 4 OR is in `BRAND_WORD_BOUNDARY_ALIASES`. An alias of length 1-3 (`"B"`, `"AB"`, `"ABB"`) does go through word-boundary matching (because `alias.length < 4` is true), so it fires on `\bABB\b`. There is NO minimum-length rejection — a 1-char alias `"B"` would match `\bB\b` anywhere.

**Path 2: local `detectBrands(text, brands)` — `email-analyzer.js` line 6466**

Uses `matchesBrand(normalizedText, entry.alias)` with no length check before the match. The `BRAND_FALSE_POSITIVE_ALIASES` check at line 6503 skips known bad single-word aliases, but this set contains full words, not short abbreviations.

### Where ≤3-char Aliases Fire

Both paths lack a minimum-alias-length guard. Any alias of 1-3 characters in the KB that is not in `BRAND_FALSE_POSITIVE_ALIASES` will match.

Known ≤3-char alias examples from `DEFAULT_BRAND_ALIASES` block (line 239 of detection-kb.js): `"abb"`, `"iek"`, `"r. stahl"`, `"rstahl"`. At runtime the KB SQLite table `brand_aliases` contains many more — abbreviations added by users. The problem is user-added 1-3 char aliases such as `"B"` (for some brand beginning with B), `"AB"` etc.

`BRAND_FALSE_POSITIVE_ALIASES` (line 8 in `detection-kb.js`) covers generic words but NOT ultra-short abbreviations — it contains `"bar"`, `"tel"`, `"sdi"`, `"nbr"`, `"din"`, `"iec"` (all 2-3 chars, some are in there). The current set relies on manual enumeration rather than a length threshold.

### Fix Pattern

Add a minimum-length guard in both paths. The recommended threshold is `> 3` (reject aliases of length ≤ 3) for single-token aliases. Multi-word aliases (containing space) are unaffected because they are tested differently.

**In `DetectionKB.detectBrands` (detection-kb.js line 1788–1830):**

```javascript
// Add after the BRAND_FALSE_POSITIVE_ALIASES check (line 1791):
if (!/\s/.test(alias) && alias.length <= 3) {
  return false;  // Reject single-token aliases of 1-3 chars — too short to be unambiguous
}
```

**In local `detectBrands` (email-analyzer.js line 6492–6523):**

```javascript
// Add after BRAND_FALSE_POSITIVE_ALIASES check at line 6503:
if (!/\s/.test(aliasLower) && aliasLower.length <= 3) {
  continue;  // Reject single-token aliases of 1-3 chars
}
```

**Risk:** Legitimate 3-char brand names like `"ABB"` — but `"ABB"` is a canonical brand name, not an alias. The canonical brand itself is tested by `matchesBrand(normalizedText, brand)` before alias iteration, so `ABB` as a canonical still matches. The guard only affects when `"abb"` appears as an ALIAS entry (canonical → alias mapping). In practice, `"ABB"` canonical matched via `matchesBrand` is the primary match mechanism. If there are legitimate 3-char aliases that are currently essential, they can be whitelisted (e.g., add to `BRAND_WORD_BOUNDARY_ALIASES` which bypasses the guard and enforces strict word boundary).

### Open Sub-question

What are the actual 1-3 char KB aliases in the SQLite database? The planner should include a `SELECT alias, canonical_brand FROM brand_aliases WHERE length(alias) <= 3 AND is_active=1` query to enumerate them before coding. This will show which canonicals would lose their alias match and whether they have longer aliases as fallback.

---

## PROD-01 — Numbered List Cleanup

### Current Normalizer State

`product-name-normalizer.js` has `stripListNumberPrefix` (line 169):

```javascript
const LIST_NUM_PREFIX_RE = /^\s*(?:\d{1,3}[.)\]]|[*•–\-])\s*(?=[A-Za-zА-ЯЁа-яё])/;
export function stripListNumberPrefix(value) {
    return String(value || "").replace(LIST_NUM_PREFIX_RE, "").trim();
}
```

This strips the LEADING number (`"1. "`, `"2) "`, `"3] "`) from a product name. It is called inside `normalizeProductName()` at line 219 of the same file, which is applied to `productNamesClean` via `sanitizeProductNames`.

**However**, for `productNames[].name` the inline cleanup at `email-analyzer.js` lines 1562–1579 does:
```javascript
cleaned = cleaned
  .replace(/^\s*\d{1,3}\s*[.)\]]\s*/, "")   // strips leading "N."
  .replace(/\s*[-–—]?\s*\d+...\s*$/i, "")    // strips trailing qty
  ...
```

This strips the leading number but the FULL LINE `"1. Название товара — 5 шт."` after stripping becomes `"Название товара"` only if the qty strip also fires. The qty strip pattern is `\s*[-–—]?\s*\d+...\s*$` which requires an em/en dash or leading space before the digit.

### Where PROD-01 Noise Actually Appears

The `NUMBERED_LIST_RE` in `audit_baseline.py` is:
```python
NUMBERED_LIST_RE = re.compile(r'^\s*\d+\s*[\.\)]\s+.+(?:\s+—\s+\d+\s*шт)', re.U)
```
This pattern requires `" — N шт"` at the end. It matches full-line patterns like `"1. Название товара — 5 шт"`.

**Critical finding:** `check_product_name` in the audit script applies this regex against `str(n)` where `n` is a Python dict `{'article': ..., 'name': '1. Название — 5 шт', ...}`. Since `str(dict)` starts with `{`, not a digit, `NUMBERED_LIST_RE.match(n)` **always returns None**. The baseline metric `product_name.noise_free = 0.6833` has never actually measured numbered-list noise. The audit script is buggy for this check.

### What Remains After Current Cleanup

The inline cleanup at line 1573-1579 strips `"1. "` prefix AND `"— N шт"` tail separately. So `"1. Клапан — 5 шт"` should become `"Клапан"` after both strips. But this depends on the order of application and whether the qty-strip pattern matches. The issue is:
- Pattern `\s*[-–—]?\s*\d+...\s*$` with the `[-–—]?` making the dash OPTIONAL. So `"Клапан — 5 шт"` has the em-dash, which matches. But `"Клапан - 5 шт"` has a plain hyphen — the `\s*` makes the space optional but the hyphen must follow a space to be `\s-`.

The existing `PRODUCT_QTY_PATTERN` in `email-analyzer.js` (line 90) has:
```javascript
const PRODUCT_QTY_PATTERN = /(?:[—–=]|\s-)\s*(\d+...)/i;
```
This means `" - 5"` (space-hyphen) is allowed but `"- 5"` (no leading space) is not. The inline cleanup uses em-dash variants directly.

### Fix for PROD-01

In `email-analyzer.js` at lines 1573–1579 (inside the `productNames[]` inline cleanup loop), the existing cleanup already handles most cases. The remaining case is the full-line `"N. text — N шт."` where both strips must fire.

The only gap is: what happens if only the qty-tail strip fails (dash format not matching)? Add a safety net specifically for the full numbered-list-with-qty pattern after the existing replacements:

```javascript
// After the existing .replace() chain at line 1574–1579:
// Safety net: if the name still starts with "N. " after stripping, and ends with qty, strip the remaining trailing qty with plain hyphen
cleaned = cleaned.replace(/\s*-\s*\d+(?:[.,]\d+)?\s*(?:шт|штук[аи]?|единиц[аы]?|компл|к-т|pcs|pc|ea)\.?\s*$/i, "");
```

Also, `audit_baseline.py` check at line 383–391 needs to be fixed — it should access `n.get("name", "")` for each dict item rather than `str(n)`. After the PROD-01 JS fix, the audit script also needs updating to correctly measure the improvement.

### Where productNamesClean Differs

`productNamesClean` is populated from `sanitizeProductNames()` which calls `normalizeProductName()` → `stripListNumberPrefix()` → strips `"N. "` prefix. So `productNamesClean` already strips the prefix. The issue is `productNames[].name` which has a separate cleanup at lines 1564–1579 and this cleanup uses a slightly different regex.

---

## PROD-02 — Duplicate Collapse

### Current Dedup State

There are two deduplication layers:

**Layer 1: `lead.productNames[]` in-place dedup at email-analyzer.js lines 1561–1592**

Uses `canonicalNameKey(name, article)` (lines 1522–1538) which:
1. Replaces `_` with space
2. Strips leading `\d.` prefix
3. Strips trailing qty
4. Strips trailing article code
5. Normalizes punctuation and lowercases

It does NOT call `stripHtmlResidue()` or `stripCssTokens()`. Two entries `"Клапан<br>Norgren"` and `"Клапан Norgren"` would produce different canonical keys: `"клапан<br>norgren"` vs `"клапан norgren"`.

**Layer 2: `lead.productNamesClean` via `sanitizeProductNames()` → `dedupByCanonical()` in product-name-extractor.js**

`dedupByCanonical()` uses `buildBaseCanon()` which calls `collapseWhitespace(String(value))` and strips nums/qty but does NOT run `stripHtmlResidue`. Same issue.

However, `sanitizeProductNames()` first calls `normalizeProductName()` on each item (line 229), which DOES call `stripHtmlResidue()`. So by the time items reach `dedupByCanonical()`, HTML has been stripped. **Thus `productNamesClean` is already correctly deduped.**

The issue is `lead.productNames[]` — the in-place dedup at line 1581 builds `canonicalNameKey` from the already-partially-cleaned `entry.name`. If the earlier cleanup at lines 1573–1579 left HTML residue (e.g., `<span>` didn't get fully stripped), the canonical key will differ.

### HTML Residue Forms Seen in productNames

From `product-name-normalizer.js` (the types handled by `stripHtmlResidue`):
- `<br>`, `<span>`, `</span>`, `<b>`, `</b>` — HTML tags (cleaned by `HTML_TAG_RE`)
- `&amp;`, `&nbsp;`, `&lt;`, `&gt;` — HTML entities (cleaned by `HTML_ENTITY_MAP`)
- `&#160;`, `&#8203;` — numeric entities (cleaned by `HTML_NUMERIC_ENTITY_RE`)

These can appear when the email body was HTML-converted and some tags leaked into product description lines.

### Fix for PROD-02

In `canonicalNameKey` function (email-analyzer.js line 1522), add HTML residue stripping before building the key:

```javascript
const canonicalNameKey = (s, article = "") => {
  // Add at the start, before existing logic:
  let t = stripHtmlResidue(String(s || ""));   // NEW: strip HTML before canonical
  t = t.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  // ... rest of existing logic unchanged
```

`stripHtmlResidue` is already imported at line 20 of email-analyzer.js:
```javascript
import { normalizeProductName } from "./product-name-normalizer.js";
```
But `stripHtmlResidue` is not individually imported — it would need to be added to the import.

Alternatively, since `canonicalNameKey` is an inline function defined at line 1522 AFTER imports, a simpler approach is to apply `String(s).replace(/<\/?[a-z][^>]*>/gi, "").replace(/&[a-z]+;/gi, " ").replace(/&#\d+;/g, " ")` inline without adding an import.

**Recommendation:** add `stripHtmlResidue` to the destructured import from `product-name-normalizer.js` and use it inside `canonicalNameKey`. This keeps the fix minimal and DRY.

---

## Baseline Metrics

### baseline_v1.json (2026-05-25, 300 samples)
| Field | present | noise_free |
|-------|---------|-----------|
| brand | 0.65 | 0.5833 |
| product_name | 0.6833 | 0.6833 |

### baseline_v3.json (2026-05-28, 300 samples)
| Field | present | noise_free |
|-------|---------|-----------|
| brand | 0.65 | 0.5833 |
| product_name | 0.6833 | 0.6833 |

Brand `noise_free` is 0.5833 vs `present` 0.65 — a 0.0667 gap (10.3% of present brands are ghost-branded). BRAND-02 should increase `present` (brands in subject currently dropped). BRAND-03 should improve `noise_free` (fewer ghost brands from short aliases).

`product_name.noise_free = present = 0.6833` — no noise detected. **This is a measurement artifact**: `check_product_name` in `audit_baseline.py` has the bug described in PROD-01 above — the `NUMBERED_LIST_RE` is applied to `str(dict)` not `n.get("name","")`, so it never fires. The true noise rate for product_name is unknown. After fixing the audit script, baseline noise_free will drop. The PROD-01 fix should then bring it back up.

---

## Key Interfaces

### detection-kb.js

**`DetectionKB.classifyMessage()`** — line 1714
```javascript
classifyMessage({ subject = "", body = "", attachments = [], fromEmail = "", projectBrands = [] })
// Returns: { label, confidence, scores, matchedRules, detectedBrands }
// detectedBrands = this.detectBrands([scopes.subject, scopes.body, scopes.attachment].join("\n"), projectBrands)
```

**`DetectionKB.detectBrands(text, projectBrands = [])`** — line 1773
```javascript
detectBrands(text, projectBrands = [])
// text: concatenated string (subject+body+attachment)
// Returns: string[] of canonical brand names
// Key filter at line 1811:
//   if (!/\s/.test(alias) || alias.length < 4 || BRAND_WORD_BOUNDARY_ALIASES.has(alias))
//   → word-boundary matching for single-word or short aliases
// NO minimum-length reject — a 1-char alias would still word-boundary match
```

**`BRAND_FALSE_POSITIVE_ALIASES`** — `detection-kb.js` line 8 (Set of ~70 strings, many 2-5 chars)

**`BRAND_MULTI_FIRST_TOKEN_CONFLICT`** — `detection-kb.js` line 57 (Set, rejects single-token aliases for conflict-prone first tokens)

### email-analyzer.js

**`detectBrands(text, brands)`** (local function) — line 6466
```javascript
function detectBrands(text, brands)
// Used inside extractLead() at line 2984
// text = [subject, brandScanBody, attachmentsTextForBrands].join("\n")
// NO minimum-length check on aliases (relies on BRAND_FALSE_POSITIVE_ALIASES + BRAND_FIRST_TOKEN_CONFLICT)
```

**P15 grounding gate** — lines 1251–1320
```javascript
const buildBrandGroundingCheck = () => {
  const groundingText = [bodyForExtraction, attachmentContent].filter(Boolean).join("\n\n");
  // subject NOT in groundingText
  ...
}
if ((classification.detectedBrands || []).length > 0) {
  const isBrandGrounded = buildBrandGroundingCheck();  // line 1308
  const groundedBrands = (classification.detectedBrands || []).filter(isBrandGrounded);
  classification.detectedBrands = groundedBrands;  // line 1319
}
```

**P18 grounding gate** — lines 1345–1387
```javascript
// Only fires when !hasConcreteLeadContent (line 1370)
const groundedLeadBrands = (lead.detectedBrands || []).filter((brand) =>
  semanticGrounded.has(...) || isBrandGrounded(brand)
);
lead.detectedBrands = groundedLeadBrands;
```

**`subjectForExtraction`** — line 1006
```javascript
const subjectForExtraction = activeFormData?.product
  ? `${subject} ${activeFormData.product}`
  : subject;
```
Subject is always passed to `extractLead` as the first argument.

**`productNames[]` inline cleanup** — lines 1561–1592
```javascript
for (const entry of lead.productNames) {
  let cleaned = entry.name;
  cleaned = cleaned
    .replace(/^\s*\d{1,3}\s*[.)\]]\s*/, "")      // strip leading "N."
    .replace(/\s*[-–—]?\s*\d+...\s*$/i, "")        // strip trailing qty
    .replace(/\s+/g, " ")
    .replace(/[\s.,:;!?"'«»\-–—_]+$/u, "")
    .trim();
  if (cleaned && cleaned.length >= 3) entry.name = cleaned;  // line 1579
}
// Then dedup using canonicalNameKey (line 1586) — does NOT strip HTML
```

**`canonicalNameKey`** — lines 1522–1538
```javascript
const canonicalNameKey = (s, article = "") => {
  let t = String(s || "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  // NO stripHtmlResidue call here
  t = t.replace(/^\d{1,3}\s*[.)\]]\s*/, "");
  t = t.replace(/* qty tail */);
  // ...
}
```

**`sanitizeProductNames(rawInputs, options)`** in `product-name-extractor.js` — line 197
```javascript
sanitizeProductNames(rawInputs, options = {})
// options: { subject, maxLen, articles }
// Calls normalizeProductName() on each item — this DOES run stripHtmlResidue
// Returns: { names, primary, items, rejected }
// productNamesClean = sanitized.names (HTML already stripped before dedup)
```

**`normalizeProductName(value, options = {})`** in `product-name-normalizer.js` — line 205
```javascript
// Pipeline: stripQuoteMarker → stripHtmlResidue → stripCssTokens → stripPdfOps
//           → stripUrlTail → stripQuoteMarker → stripContactTail → stripQuantityTail
//           → stripListNumberPrefix → collapseWhitespace → capLength → trailing-punc trim
```

**`stripListNumberPrefix(value)`** — `product-name-normalizer.js` line 169
```javascript
const LIST_NUM_PREFIX_RE = /^\s*(?:\d{1,3}[.)\]]|[*•–\-])\s*(?=[A-Za-zА-ЯЁа-яё])/;
// Strips "1. ", "2) ", "3] ", "* ", "- " when followed by a letter
```

### audit_baseline.py

**`check_product_name(msg)`** — line 381
```python
def check_product_name(msg):
    names = l.get("productNames") or []
    names = [str(n) for n in names if n]   # BUG: str(dict) → "{...}", not .name string
    has_raw_numbered = any(NUMBERED_LIST_RE.match(n) for n in names)  # never fires
```

**`NUMBERED_LIST_RE`** — line 379
```python
NUMBERED_LIST_RE = re.compile(r'^\s*\d+\s*[\.\)]\s+.+(?:\s+—\s+\d+\s*шт)', re.U)
```

---

## Open Questions

1. **BRAND-02: What is the exact set of cases triggering this?**
   - Are there production emails where the subject contains a brand alias but the body truly has no grounding text (e.g., pure forward with empty body)?
   - Should the exemption apply only when `subject` length > some threshold (e.g., > 5 chars) to avoid triggering on one-word subjects?
   - The planner should decide: exempt subject-grounded brands from P15 only, or also from P18?

2. **BRAND-03: What ≤3-char aliases are in the live KB?**
   - Run `SELECT alias, canonical_brand FROM brand_aliases WHERE length(alias) <= 3 AND is_active=1` to enumerate.
   - If `"ABB"` canonical has no alias, it matches via `matchesBrand` on canonical name — no regression.
   - If `"IEK"` → `"iek"` alias is 3 chars and important — must it be whitelisted in `BRAND_WORD_BOUNDARY_ALIASES`?
   - The DEFAULT_BRAND_ALIASES list in `detection-kb.js` includes `{ canonicalBrand: "ABB", alias: "abb" }` — `"abb"` is 3 chars. Blocking it would stop ABB from matching via alias `"abb"`. Need to check if canonical-name match via `matchesBrand("abb text", "ABB")` would still work for the non-alias path.

3. **PROD-01: How wide is the gap between current normalizer behavior and the full-line pattern?**
   - Current cleanup DOES strip both `"N. "` prefix and `"— N шт"` tail separately. The remaining case is when only the qty tail doesn't match (plain hyphen `- N`). Is this a real production occurrence or covered?
   - The fix may only need to extend the trailing qty regex to also match `\s-\s*\d+` (already in `PRODUCT_QTY_PATTERN`) in the inline cleanup.

4. **PROD-02: Is the bug in `productNames` dedup causing visible UI issues?**
   - `productNamesClean` (used by UI/XLSX) is already correct.
   - `productNames[]` is the legacy field — confirm whether any UI component reads it directly.
   - If only `productNamesClean` is displayed, PROD-02 fix on `productNames[]` affects only audit accuracy not user-visible output.

5. **Audit script fix scope:**
   - `check_product_name` in `audit_baseline.py` must be fixed to access `n.get("name", "")` per item. This is a separate small task but required for PROD-01 impact to be measurable in baseline.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert` |
| Config file | none (scripts run directly) |
| Quick run command | `node tests/email-analyzer.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| BRAND-02 | Subject brand survives grounding gates | unit | `node tests/email-analyzer.test.js` | Wave 0 gap |
| BRAND-03 | 1-3 char alias does not produce brand match | unit | `node tests/detection-kb.test.js` or new batch file | Wave 0 gap |
| PROD-01 | `productNames[].name` strips `"N. text — N шт."` pattern | unit | `node tests/email-analyzer.test.js` | Wave 0 gap |
| PROD-02 | HTML-residue duplicates collapse in `productNames[]` | unit | `node tests/email-analyzer.test.js` | Wave 0 gap |

### Sampling Rate
- Per task commit: `node tests/email-analyzer.test.js`
- Per wave merge: `npm test`
- Phase gate: full suite green before verify

### Wave 0 Gaps
- [ ] New test: BRAND-02 — email with brand in subject only, no body grounding, asserts brand appears in `lead.detectedBrands`
- [ ] New test: BRAND-03 — alias of length ≤ 3 in KB, asserts it does NOT produce a brand hit
- [ ] New test: PROD-01 — `productNames[].name` containing `"1. Клапан Korte — 5 шт"` is cleaned to `"Клапан Korte"`
- [ ] New test: PROD-02 — two `productNames` entries differing by `<br>` collapse to one after dedup

---

## Sources

### Primary (HIGH confidence)
- Direct code reading: `src/services/email-analyzer.js` (6500+ lines) — brand detection flow, grounding gates, productNames cleanup
- Direct code reading: `src/services/detection-kb.js` — `classifyMessage`, `detectBrands`, alias matching logic
- Direct code reading: `src/services/product-name-normalizer.js` — full pipeline, `stripListNumberPrefix`, `LIST_NUM_PREFIX_RE`
- Direct code reading: `src/services/product-name-extractor.js` — `sanitizeProductNames`, `dedupByCanonical`, `buildBaseCanon`
- Direct code reading: `scripts/audit_baseline.py` — `check_brand`, `check_product_name`, `NUMBERED_LIST_RE`
- Direct reading: `scripts/baselines/baseline_v1.json`, `baseline_v3.json`

### Secondary (MEDIUM confidence)
- Test suite: `tests/email-analyzer.test.js` — existing `productNamesClean` tests at lines 3069–3200 confirm current dedup behavior

### Tertiary (LOW confidence)
- None required — all findings are from direct code reading.

---

## Metadata

**Confidence breakdown:**
- BRAND-02 flow analysis: HIGH — code paths fully traced, all gates identified
- BRAND-03 threshold analysis: HIGH — code verified, audit of KB aliases needed (marked as open question)
- PROD-01 normalizer state: HIGH — confirmed stripListNumberPrefix exists, audit script bug confirmed empirically
- PROD-02 dedup state: HIGH — two dedup layers traced, HTML-stripping gap confirmed in canonicalNameKey
- Baseline metrics: MEDIUM — v3 values are current, but product_name noise metric is known-buggy

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (stable codebase, 30-day window)
