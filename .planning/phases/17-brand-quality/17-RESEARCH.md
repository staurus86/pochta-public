# Phase 17: Brand Quality — Research

**Researched:** 2026-05-28
**Domain:** Brand detection — ghost brand elimination
**Confidence:** HIGH

---

## Summary

Brand detection currently produces `present=60%` but `noise_free=45.3%` — a 14.7pp gap meaning 24.5% of brand-present emails carry at least one ghost brand. The audit script marks a brand as noise when `is_brand_grounded()` returns False: i.e., the brand string (or any alias ≥3 chars) is not found in `body+attachment_text`, is not in the subject, and no article in the email maps to that brand in the KB.

Production analysis of 500 emails (1071 with brands detected) identifies five concrete root-cause patterns accounting for the bulk of ghost brands. The biggest single driver is **quoted-reply bleed** (148 of 294 ghost-brand emails = 50%): brands appear in Siderus's own previously-sent message that is quoted inside the inbound reply, but not in the client's actual new text. The second is **slash-canonical splitting** (238 KB canonicals contain `/`): `splitAliasBundle` correctly splits them at render time, emitting e.g. both `GEMÜ` and `Gemu` from canonical `GEMÜ / Gemu`, which the audit counts as one ghost. Third, there are **multi-canonical duplicates** for the same manufacturer (3 separate canonicals for Endress+Hauser), causing double/triple detection. Fourth, **very short generic aliases** (`smart`, `instruments`, `west`) in the KB match common English/Russian words. Fifth, **bodyPreview truncation** (59% of messages have bodyPreview capped at 600 chars): the audit can only see the first 600 chars, so brands appearing later in the body look like ghosts even though they are legitimate.

**Primary recommendation:** Address patterns in order of impact: (1) reply-zone filter extension to cover 1-5 brand cases, (2) KB alias cleanup for slash-canonicals that produce split output, (3) merge duplicate canonicals for same manufacturer, (4) add dangerous single-word aliases to `BRAND_FALSE_POSITIVE_ALIASES`. These are all fixable with code and KB changes.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRAND-04 | Исследовать оставшиеся ghost brands — какие бренды ложно срабатывают и почему (анализ на 300-письмовой выборке) | Completed in this research: 5 patterns identified with counts |
| BRAND-05 | Устранить топ-5 паттернов ghost brands по результатам исследования | Patterns are fixable; fix strategies documented below |
| BRAND-06 | Audit-скрипт показывает рост `brand.noise_free` относительно baseline_v6 (цель: ≥55%) | Quantified impact per fix; total estimated gain: ~10pp |
</phase_requirements>

---

## What `check_brand` Counts as Noise

Location: `scripts/audit_baseline.py`, function `check_brand()` (lines 349-363).

```python
def check_brand(msg, kb_a, kb_s, aliases):
    brands = brand_names(a.get("detectedBrands") or l.get("detectedBrands") or [])
    if not brands:
        return {"present": False, "noise": False}
    body = msg.get("bodyPreview") or ""      # ← ONLY bodyPreview (max 600 chars)
    subj = msg.get("subject") or ""
    att = attachmentAnalysis.combinedText    # attachment text
    arts = article_codes(l.get("articles"))
    any_ghost = any(
        not is_brand_grounded(b, body, subj, att, arts, ...)
        for b in brands
    )
    return {"present": True, "noise": any_ghost}
```

`is_brand_grounded()` checks (in order):
1. `brand_low in full_low` — brand name substring in body+att combined
2. aliases ≥3 chars — any alias in body+att
3. canonical tokens ≥5 chars — partial token match in body+att
4. subject match ≥5 chars
5. article-based KB tie — article code maps to that brand in nomenclature_dictionary

**A brand is noise if NONE of the above match.** The function uses `bodyPreview` (max 600 chars), not full body — brands mentioned after position 600 look like ghosts even when legitimate.

---

## Standard Stack

No new libraries needed. All fixes are within existing code:

| File | Purpose | Change Type |
|------|---------|-------------|
| `src/services/detection-kb.js` | `detectBrands()`, `filterSignatureBrandCluster()` | Filter logic |
| `src/services/email-analyzer.js` | Zone filter (lines 1430-1440), `buildBrandGroundingCheck()` | Filter expansion |
| `src/services/brand-extractor.js` | `sanitizeBrands()` pipeline | May need update |
| `data/detection-kb.sqlite` | `brand_aliases` table | KB data cleanup |

**No npm installs needed.** All changes are to existing Node.js (ESM) files + SQLite KB data.

---

## Architecture Patterns

### Current Brand Detection Flow

```
analyzeEmail()
  ├─ 1. detectionKb.classify() → classification.detectedBrands
  │       └─ detectBrands(subject+body+attachment)
  │               ├─ stripBrandCapabilityListText()
  │               ├─ stripImageAltTextChain()
  │               ├─ KB alias matching (getBrandAliases())
  │               ├─ BRAND_FALSE_POSITIVE_ALIASES filter
  │               ├─ BRAND_MULTI_FIRST_TOKEN_CONFLICT filter
  │               ├─ shared-generic-alias post-filter
  │               └─ filterSignatureBrandCluster() if ≥10 brands
  │
  ├─ 2. attachment brands → classification.detectedBrands (merge)
  │
  ├─ 3. enrichLeadFromKnowledgeBase() → may add semantic brands
  │
  ├─ 4. P15 gate: body-grounding check on classification.detectedBrands
  │       └─ drops brands not found in body+att (exempt: subject-grounded)
  │
  ├─ 5. lead.detectedBrands merge from classification.detectedBrands
  │
  ├─ 6. sanitizeBrands() → strip NBR/ISO/VAC/stopwords, split alias bundles,
  │       canonicalize, dedup
  │
  ├─ 7. P18 gate: narrow body-grounding for zero-content emails
  │
  └─ 8. Zone filter: if >5 brands AND reply chain → keep only primary-zone brands
         (primaryBody = text BEFORE first quote marker)
```

### Key Constraint: Zone Filter Threshold

The zone filter (step 8) only activates when `brands.length > 5`. Emails with 1-5 ghost brands from reply content are NOT filtered.

---

## Top-5 Ghost Brand Patterns (Quantified)

### Pattern 1: Quoted Reply Bleed (LARGEST — ~148/294 ghost emails = 50%)

**What happens:** Client sends a short reply ("Принято", "Направляю реквизиты", "Добрый день"). Siderus's prior message (containing brand names from the original inquiry) is quoted at the bottom. The FULL email body includes brands from that quoted history. `detectBrands` scans the entire body including quoted content.

**Concrete examples:**
- Subject: "RE: : Насосы импорт/аналоги" — client body: "Берем." (1 word). Brands: ALLWEILER, HOMA, EMEC PUMPS — all from Siderus's forwarded list
- Subject: "RE: Запрос 20-2026_Spirotherm_HS_в_https://siderus.ru/" — client body: "Здравствуйте! Прикладываю чертеж. Кол-во - 29 штук." Ghost brand: Spirotech (from Siderus previous reply)
- Subject: "Re: Новый заказ продукта с сайта" — client body: "День добрый. С уважением, Смирнов." Ghost brand: BEDIA (only in Siderus's quoted text)

**Why existing zone filter misses it:** Zone filter only activates when `brands.length > 5`. Short replies typically get 1-3 ghost brands.

**Detection signal:** `primaryBody` (text before first quote marker) does NOT contain the brand, but full body does. Already computed as `primaryBody` variable in `analyzeEmail()`.

**Fix:** Lower zone filter threshold to 1 brand (or apply primaryBody-grounding for ALL emails with reply chains, not just >5 brand ones). Apply whenever `quotedContent` is non-empty and brand count ≥ 1.

**Estimated impact:** ~148 emails × (1 ghost brand each average) → ~148/300 sample baseline affected. Fixing this alone could raise `noise_free` by ~3-5pp.

---

### Pattern 2: Slash-Canonical Splitting (Medium — ~50+ ghost brands)

**What happens:** KB stores `GEMÜ / Gemu` as the canonical_brand. `sanitizeBrands()` calls `splitAliasBundle()` which splits on ` / ` → outputs both `GEMÜ` and `Gemu` as two separate brands. Same for `WEST Control Solutions / Instruments` → both `WEST Control Solutions` AND `Instruments` emitted. `Instruments` then fails grounding because the email only says "MTL Instruments" (the alias `instruments` matched as a standalone word).

**Confirmed examples from KB:**
- `GEMÜ / Gemu` → emits `["GEMÜ", "Gemu"]` — audit sees one as grounded, one as ghost
- `WEST Control Solutions / Instruments` → emits `["WEST Control Solutions", "Instruments"]` — `Instruments` is a generic word that ghosts
- 238 KB canonical brands contain `/` — producing 257 extra split tokens

**Fix options:**
- Option A: In `splitAliasBundle`, only split canonical brands when both parts are ≥8 chars and neither part is in `BRAND_FALSE_POSITIVE_ALIASES`. Otherwise keep as single canonical.
- Option B: Add downstream dedup: after splitting, if one part is a substring of another part in the same list, discard the shorter one. `dedupCanonical` already does case dedup but not substring.
- Option C: Add the problematic generic splits (`instruments`, `west`, `smart`) to `BRAND_FALSE_POSITIVE_ALIASES`.

**Estimated impact:** Fixing `GEMÜ / Gemu` type pattern eliminates ~6-8 ghost brands in this 500-sample. KB-wide fix could affect ~50+ cases in 300-sample baseline.

---

### Pattern 3: Multi-Canonical Same Manufacturer (Medium — ~40 ghost brands)

**What happens:** Same manufacturer has 3+ separate canonical entries with overlapping aliases:
- `Endress & Hauser` (alias: `endress`, `hauser`)
- `Endress+Hauser` (alias: `endress+hauser`, `endresshauser`)
- `ENDRESS+HAUSER` (alias: `endress+hauser`)

When an email mentions "ENDRESS+HAUSER" once, all three canonicals can match. `deduplicateByAbsorption('keep-shortest')` collapses "Endress & Hauser" vs "Endress+Hauser" only if one is a substring of the other — but they are not substrings of each other. The audit sees 2-3 brands for one mention, the is_brand_grounded check may fail for the variant forms.

**Other affected brands (from multi-canonical audit):** `parker` (5 canonicals: Parker, Parker Hannifin, Parker Autoclave, Parker Pneumatik, PARKER), `bosch` (multiple Rexroth variants), `baumer`, `moog`.

**Fix:** Add a normalization step after `sanitizeBrands()` that collapses known brand-name variants. Simplest approach: in `dedupCanonical` in `brand-normalizer.js`, add a concat-normalized dedup (strip `+/&-.,` and compare lowercased) to collapse `endress+hauser` / `endress & hauser` / `ENDRESS+HAUSER` → keep first seen.

**Estimated impact:** ~40 ghost-brand instances in 500 emails → ~3-4pp on the 300 baseline.

---

### Pattern 4: Generic Single-Token Aliases (Medium — ~60 ghost brands)

**What happens:** The KB has canonical brands with very short/generic single-token aliases that also exist as common words:
- `SMART HYDRODYNAMIC SYSTEMS` → alias `smart` → matches any "smart" in text
- `WEST Control Solutions / Instruments` → alias `instruments` → matches "MTL Instruments" text (the word "instruments" in a product description)
- `WEST Control Solutions / Instruments` → alias `west` → matches company name "Вест-Экс" transliterated

Most of these should be in `BRAND_FALSE_POSITIVE_ALIASES` (which already has a long list), but the import of 15K+ brands from `brand-catalog.json` added new ones.

**Confirmed examples:**
- `instruments` alias for `WEST Control Solutions / Instruments` triggers on "MTL INSTRUMENTS MTL5514"
- `smart` alias for `SMART HYDRODYNAMIC SYSTEMS` triggers on any "smart" mention
- `west` (alias for same brand) triggers on "Вест-" company names

**Fix:** Add these specific problematic single-token aliases to `BRAND_FALSE_POSITIVE_ALIASES` in `detection-kb.js`. The list already contains similar patterns (`sensor`, `time`, `motor`, etc.). Add: `instruments`, `smart` (for context: `smart` already not in list), `west`, and any other identified.

**Estimated impact:** ~30-60 ghost instances → ~2-3pp on baseline.

---

### Pattern 5: bodyPreview Truncation Artifact (Structural — affects audit scoring only)

**What happens:** 59% of emails have bodyPreview truncated at 600 chars. The audit script uses `msg.get("bodyPreview")` which is only 600 chars. Brands that appear after character 600 in the real email body fail `is_brand_grounded()` in the audit script even though they are legitimate in the actual email body. This is an audit measurement artifact, not a detection bug.

**Scale:** 248 of 294 ghost-brand emails had truncated bodyPreview + ghosts.

**Note:** This is NOT the same as the detection system being wrong. The production system analyzes the full body. The audit script just can't verify these brands against the full body text.

**Fix options:**
- Option A: Audit script fix — use a longer `bodyPreview` field or the full body from API.
- Option B: Detection system adds a `brandGrounded: true/false` flag per brand when it detects, so the audit can use that flag instead of re-checking against bodyPreview.
- Option C: Accept that some "ghost" count is an audit artifact and focus other fixes.

**Estimated impact on metric:** Fixing the audit script measurement could move `noise_free` by up to 5-8pp without changing any production code — but it would make the metric more accurate, not improve actual detection.

**Priority decision:** Option A (audit script fix: use full body snapshot) is the cleanest. The planner should schedule this as a sub-task of the deploy/baseline plan.

---

## Impact Estimation Summary

| Pattern | Estimated ghost emails (500-sample) | Estimated pp gain (300-baseline) | Fixable |
|---------|-------------------------------------|----------------------------------|---------|
| P1: Quoted reply bleed | ~148 | ~3-5pp | Yes — lower zone filter threshold |
| P2: Slash-canonical split | ~50 | ~1-2pp | Yes — alias cleanup or splitAliasBundle fix |
| P3: Multi-canonical dup | ~40 | ~2-3pp | Yes — concat-normalize dedup |
| P4: Generic single-token aliases | ~60 | ~2-3pp | Yes — add to BRAND_FALSE_POSITIVE_ALIASES |
| P5: bodyPreview truncation (audit artifact) | ~248 | ~3-8pp (metric accuracy) | Yes — audit script change |

**Total estimated gain (P1+P2+P3+P4 + audit fix P5): ~11-21pp**, enough to reach ≥55% target.

---

## Interface Contracts (Exact Signatures to Modify)

### `filterSignatureBrandCluster` in `detection-kb.js`
```javascript
// Current threshold: ≥10 brands
function filterSignatureBrandCluster(detectedBrands, loweredText, brandAliasMap, 
  clusterThreshold = 10, maxInterGap = 18)
```

### Zone filter in `email-analyzer.js` (lines 1430-1440)
```javascript
// Current: only activates when brands.length > 5
if ((lead.detectedBrands || []).length > 5 && quotedContent && /(?:От|From)\s*:\s*\S+@/i.test(quotedContent)) {
  const primaryZone = ` ${subject.toLowerCase()} ${primaryBody.toLowerCase()} `;
  const primaryZoneBrands = ...filter...
  if (primaryZoneBrands.length > 0) lead.detectedBrands = primaryZoneBrands;
}
```

**Fix P1:** Change threshold to `>= 1` (or `> 0`), ensure `primaryZoneBrands.length > 0` guard remains:
```javascript
if ((lead.detectedBrands || []).length > 0 && quotedContent && /(?:От|From)\s*:\s*\S+@/i.test(quotedContent)) {
```

### `dedupCanonical` in `brand-normalizer.js`
```javascript
// Current: case-insensitive dedup only
export function dedupCanonical(brands) { ... }
```

**Fix P3:** Add concat-normalized dedup pass after current dedup.

### `splitAliasBundle` in `brand-normalizer.js`
```javascript
// Current: splits on ' / ' separator
export function splitAliasBundle(input) { ... }
```

**Fix P2:** Make split conditional — don't split when either part would be in `BRAND_FALSE_POSITIVE_ALIASES` or length < threshold.

### `BRAND_FALSE_POSITIVE_ALIASES` in `detection-kb.js` (lines 8-47)
**Fix P4:** Add to the Set: `"instruments"`, `"smart"`, `"west"`, `"drive"`, `"mission"`, `"neo"`.

### Audit script `is_brand_grounded` in `audit_baseline.py`
```python
# Fix P5: use longer body source - need to capture full body in snapshot
full = body + '\n' + attachment_text  # ← body is truncated bodyPreview
```

---

## Common Pitfalls

### Pitfall 1: Zone Filter Regression on Legitimate Multi-Brand Emails
**What goes wrong:** Lowering zone filter threshold to ≥1 brand could filter legitimate brands from a reply. E.g., client says "Да, нас устраивает Siemens." — this is a client reply confirming a brand, and it IS in the primaryBody.
**How to avoid:** Only drop brands NOT in primaryBody when `primaryZoneBrands.length > 0`. The existing guard `if (primaryZoneBrands.length > 0)` already handles this — if no brands are in primaryBody, keep all (don't drop everything).
**Warning signs:** Test cases where brand IS in client's own text should still pass.

### Pitfall 2: Slash-Canonical Fix Breaking Legitimate Pairs
**What goes wrong:** `ASCO Joucomatic / Numatics` — both are real and distinct product lines that Siderus sells separately. Splitting them was intentional.
**How to avoid:** Don't blindly suppress all splits. Suppress only when the second part matches `BRAND_FALSE_POSITIVE_ALIASES` (e.g. `Instruments`). Or apply dedup-by-normalization instead of suppressing splits.

### Pitfall 3: Multi-Canonical Merge Breaking Distinct Sub-Brands
**What goes wrong:** "Bosch Rexroth" and "Bosch" are not the same — "Bosch" could be home appliances while "Bosch Rexroth" is industrial. Normalizing by stripping "rexroth" would wrongly merge.
**How to avoid:** Only merge exact after `[-+&. ]` stripping when normalized forms are identical. `bosch rexroth` strips to `boschrexroth` ≠ `bosch`, so this is safe. `endress+hauser` → `endresshauser`, `endress & hauser` → `endresshauser` — these safely merge.

### Pitfall 4: bodyPreview Audit Fix May Not Match Production Behavior
**What goes wrong:** Even if we fix the audit script to use more body text, the grounding function's logic needs to match what the production system uses for detection.
**How to avoid:** The audit fix is ONLY for measurement. Production detection logic (`buildBrandGroundingCheck`) runs against full body. The audit fix simply makes measurement more faithful.

### Pitfall 5: Regression on Attachment-Sourced Brands
**What goes wrong:** Many legitimate brands come from PDF/DOCX attachments. The zone filter must not exclude attachment-grounded brands even when primaryBody doesn't mention them.
**How to avoid:** Zone filter should only restrict when brand is NOT in primaryZone AND NOT in attachment text. The current `primaryZone` is subject + primaryBody — extend check to include `att` text in the grounding.

---

## Code Examples

### Fix P1 — Zone Filter Extension
```javascript
// email-analyzer.js ~line 1432
// Change: brands.length > 5 → brands.length > 0
// Also: allow attachment-grounded brands through

if ((lead.detectedBrands || []).length > 0 && quotedContent && /(?:От|From)\s*:\s*\S+@/i.test(quotedContent)) {
    const primaryZoneText = ` ${String(subject || "").toLowerCase()} ${String(primaryBody || "").toLowerCase()} `;
    const attLower = String(attachmentContent || "").toLowerCase();
    const primaryZoneBrands = (lead.detectedBrands || []).filter((brand) => {
        const b = ` ${brand.toLowerCase()} `;
        const inPrimary = primaryZoneText.includes(b) || 
            new RegExp(`\\b${escapeRegExp(brand.toLowerCase())}\\b`).test(primaryZoneText);
        const inAtt = attLower.includes(brand.toLowerCase());
        return inPrimary || inAtt;
    });
    if (primaryZoneBrands.length > 0) {
        lead.detectedBrands = primaryZoneBrands;
    }
    // If 0 brands in primary zone: keep all (don't wipe brands for emails
    // where client message is truly brand-less but attachment has brands)
}
```

### Fix P4 — Add Generic Aliases to Blocklist
```javascript
// detection-kb.js BRAND_FALSE_POSITIVE_ALIASES Set, add to existing list:
"instruments",  // "MTL Instruments" partial word
"smart",        // "SMART HYDRODYNAMIC SYSTEMS" generic alias  
"west",         // "WEST Control Solutions" → matches "West-*" company names
"drive",        // generic word matching many drive brands
"neo",          // "Neo-Dyn" abbreviation — too generic
"mission",      // "Mission" pump brand but generic word
```

### Fix P3 — Concat-Normalized Dedup in brand-normalizer.js
```javascript
// brand-normalizer.js, extend dedupCanonical:
function normalizeForDedup(brand) {
    return brand.toLowerCase().replace(/[-+&.,\s]/g, "");
}

export function dedupCanonical(brands) {
    // Step 1: existing case dedup
    const caseDeduped = [...existing logic...];
    // Step 2: concat-normalize dedup (collapses E+H / E&H / ENDRESS+HAUSER)
    const seen = new Map(); // normKey → first seen brand
    return caseDeduped.filter((b) => {
        const k = normalizeForDedup(b);
        if (seen.has(k)) return false;
        seen.set(k, b);
        return true;
    });
}
```

### Fix P2 — Conditional splitAliasBundle
```javascript
// brand-normalizer.js, splitAliasBundle modification:
export function splitAliasBundle(input) {
    if (!input || !input.includes(" / ")) return [input];
    const parts = input.split(" / ").map(s => s.trim()).filter(Boolean);
    // Only return multi-part if ALL parts are substantial brand names (≥4 chars, not generic)
    const GENERIC_SPLIT_PARTS = new Set(["instruments", "west", "systems", "controls", "technology"]);
    if (parts.some(p => GENERIC_SPLIT_PARTS.has(p.toLowerCase()))) {
        // Return the first (primary) name only
        return [parts[0]];
    }
    return parts.length >= 2 ? parts : [input];
}
```

### Audit Script Fix P5 — Longer Body Source
```python
# audit_baseline.py, check_brand function:
# Use bodyPreview but also fall back to msg.get("body") if bodyPreview is truncated
def check_brand(msg, kb_a, kb_s, aliases):
    a = msg.get("analysis") or {}
    l = a.get("lead") or {}
    brands = brand_names(a.get("detectedBrands") or l.get("detectedBrands") or [])
    if not brands:
        return {"present": False, "noise": False}
    body_preview = msg.get("bodyPreview") or ""
    # If bodyPreview looks truncated, prefer full body if available
    body = msg.get("body") or body_preview  # "body" field may be present in snapshots
    subj = msg.get("subject") or ""
    att = ((a.get("attachmentAnalysis") or {}).get("combinedText") or "")
    arts = article_codes(l.get("articles"))
    any_ghost = any(
        not is_brand_grounded(b, body, subj, att, arts, kb_a, kb_s, aliases)
        for b in brands
    )
    return {"present": True, "noise": any_ghost}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Brand deduplication | Custom brand comparison logic | Extend `dedupCanonical` in `brand-normalizer.js` |
| Quote stripping | New quote parser | Use existing `primaryBody` variable already computed |
| Alias management | New alias system | Extend existing `BRAND_FALSE_POSITIVE_ALIASES` Set |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` + `node:assert/strict` |
| Config file | none — direct invocation |
| Quick run command | `node tests/brand-extractor.test.js` |
| Full suite command | `node --test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BRAND-04 | Research finds top-5 patterns | manual audit | documented in this file | N/A — research req |
| BRAND-05 | P1: zone filter drops reply-only brands | unit | `node tests/brand-zone-filter.test.js` | ❌ Wave 0 |
| BRAND-05 | P2: slash-canonical split stays as primary only | unit | `node tests/brand-extractor.test.js` | ✅ (extend) |
| BRAND-05 | P3: Endress+Hauser / Endress & Hauser → 1 brand | unit | `node tests/brand-extractor.test.js` | ✅ (extend) |
| BRAND-05 | P4: generic aliases blocked (instruments, smart) | unit | `node tests/brand-extractor.test.js` | ✅ (extend) |
| BRAND-06 | `brand.noise_free` in baseline_v7 ≥ 55% | integration | `python scripts/audit_baseline.py --out scripts/baselines/baseline_v8.json` | ✅ |

### Sampling Rate
- **Per task commit:** `node tests/brand-extractor.test.js && node tests/brand-scattered-match.test.js`
- **Per wave merge:** `node --test`
- **Phase gate:** Full suite green + baseline run

### Wave 0 Gaps
- [ ] `tests/brand-zone-filter.test.js` — regression tests for quoted-reply zone filter (P1 fix)
- [ ] Extend `tests/brand-extractor.test.js` — add tests for P2 (slash split suppression), P3 (concat-normalize dedup), P4 (generic alias blocking)

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond existing codebase and live prod API already verified working).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-----------------|--------------|--------|
| No quote stripping for brands | Zone filter for >5 brands only | Phase 14 (P14) | Helped multi-brand emails, misses 1-5 brand cases |
| No alias blocklist | `BRAND_FALSE_POSITIVE_ALIASES` (~80 entries) | Sessions Apr-May 2026 | Eliminated many generic aliases |
| No signature cluster filter | `filterSignatureBrandCluster` (threshold=10) | Session 17.04.2026 | Eliminated 74 emails with 2339 false brands |
| No capability list strip | `stripBrandCapabilityListText` | Session 17.04.2026 | Eliminated 130+ emails with 200+ false brands |

---

## Open Questions

1. **Zone filter regression risk**
   - What we know: Lowering threshold from >5 to >0 could filter legitimate brands when client mentions brand in reply
   - What's unclear: How often does a client reply with ≥1 legitimate brand that ONLY appears in their new text (not also in subject/attachment)?
   - Recommendation: Test on 20 known-good reply emails before merging. The `primaryZoneBrands.length > 0` guard prevents total wipe.

2. **Audit script body field availability**
   - What we know: API returns `bodyPreview` (600 chars max), but may return `body` in local snapshots
   - What's unclear: Does the live API return a `body` field at all, or only `bodyPreview`?
   - Recommendation: Check API response schema for a project-4 message to confirm field names. If `body` is not available via API, the audit fix must use a different approach (e.g., re-fetch full body for truncated-preview messages).

3. **KB slash-canonical count impact**
   - What we know: 238 slash-canonicals, 257 extra split tokens
   - What's unclear: How many of those 257 extra tokens actually fire as ghost brands in the 300-sample
   - Recommendation: After P1 fix, run audit to see residual — tackle P2 if ghost count still >50.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/services/detection-kb.js` — `detectBrands()`, `filterSignatureBrandCluster()`
- Direct code inspection: `src/services/email-analyzer.js` — zone filter (lines 1430-1440), grounding gates (P15, P18)
- Direct code inspection: `scripts/audit_baseline.py` — `check_brand()`, `is_brand_grounded()`
- Direct code inspection: `src/services/brand-extractor.js`, `brand-negative-filters.js`, `brand-normalizer.js`
- Direct DB inspection: `data/detection-kb.sqlite` — `brand_aliases` table (21574 aliases, 14629 unique brands, 238 slash-canonicals)
- Live production API analysis: 500 emails from `project-4-klvrt-mail`, 1071 with brands, 294 ghost-brand emails

### Secondary (MEDIUM confidence)
- `baseline_v6.json` / `baseline_v7.json` — confirmed `brand.present=60%`, `brand.noise_free=45.3%`
- `tests/brand-extractor.test.js`, `tests/brand-scattered-match.test.js` — existing test coverage

### Tertiary (LOW confidence)
- Impact estimates: calculated from 500-email sample, extrapolated to 300-email baseline; actual gains may differ

---

## Metadata

**Confidence breakdown:**
- Ghost brand patterns: HIGH — based on direct production API analysis
- Impact estimates: MEDIUM — based on 500-email sample, not exact 300-seed-42 baseline
- Fix strategies: HIGH — code paths inspected directly
- KB cleanup scope: MEDIUM — counted slash-canonicals, but full firing rate in baseline unknown

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (stable codebase, no external API changes)
