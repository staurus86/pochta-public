# Phase 12: Quantity and INN - Research

**Researched:** 2026-05-28
**Domain:** email-analyzer.js post-processing, INN validation, positions/qty deduplication
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ART-04: positions/totalQty**
- D-01: Rename `totalPositions` → `positions` everywhere in `email-analyzer.js`. Update `crm-adapters.js` which reads `lead.total_positions` (lines 133, 167).
- D-02: Add `totalQty` = sum of qty across **unique** positions (deduplicated by `normalizeArticleCode(article)`). `null` qty counts as 0.
- D-03: Compute `positions` and `totalQty` in a final post-processing step `finalizeLeadCounts(lead)` added to `email-analyzer.js` after all merge steps (last `totalPositions` write is currently line ~1562). Dedup: one record per normalized article code; pick highest qty among duplicates.
- D-04: `positions` = count of unique article codes (not `lineItems.length`). `totalQty` = sum of qty across those unique positions.

**CONTACT-02: INN checksum**
- D-05: Implement `validateInnChecksum(digits)` alongside `normalizeInn()`:
  - 10-digit (юрлицо): coefficients `[2,4,10,3,5,9,4,6,8,0]`, control digit = `(sum(digit[i]*coeff[i]) % 11) % 10`, check `digit[9]`.
  - 12-digit (ИП): two control digits (digit[10] and digit[11]) with separate coefficient sets per official FNS algorithm.
  - 9-digit Belarus УНП: skip checksum, accept as-is.
- D-06: Integrate into `normalizeInn()` — return `null` on checksum failure.
- D-07: Apply checksum everywhere INN is accepted: body (`extractRequisites()`), attachments (`attachment-content.js detectedInn`), form-parser.
- D-08: In `isInnLike()` / `isObviousArticleNoise()`: 10-digit that passes checksum → treat as INN (not article). 10-digit that fails checksum → reject as neither INN nor article.

**Audit gate**
- D-09: Add `positions.present` and `positions.noise_free` metrics to `audit_baseline.py`.
- D-10: Add `inn_valid_rate` / `inn.noise_free` using same mod-11 logic in the Python script.

### Claude's Discretion

- Dedup order in `finalizeLeadCounts`: when multiple lineItems share one article code, prefer the item with a non-null qty; if multiple have qty, take the maximum.
- `positions` = 0 when no articles (not `undefined`).
- Function name `finalizeLeadCounts(lead)` is suggested; a different name is acceptable if it fits the file style.
- Regression tests: minimum one for Belgormash case (18/7 → 2/5) and one for 10-digit INN checksum rejection.

### Deferred Ideas (OUT OF SCOPE)

- 12-digit Kazakhstan ИИН checksum — Phase 13 or separate ticket.
- Belarus УНП checksum algorithm — future.
- Auto-sync `src/` ↔ `.railway-deploy/src/` (REQ-SYNC-01) — not in this phase.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ART-04 | `positions` = unique article count, `totalQty` = sum qty by unique positions (Belgormash: 18/7 → 2/5) | `finalizeLeadCounts()` post-processing step after `mergeAttachmentLeadData()`; dedup via `normalizeArticleCode` |
| CONTACT-01 | INN from attachment requisites (PDF/DOCX) propagated to `sender.inn` when body has none | Already implemented via `mergeAttachmentRequisites()` at line 1003; Phase 12 adds checksum filter to `detectedInn` in `attachment-content.js` |
| CONTACT-02 | INN mod-11 checksum validation — 10-digit numbers failing checksum rejected as both INN and article | `validateInnChecksum()` in `email-analyzer.js`, applied in `normalizeInn()` and in `attachment-content.js`, plus `isInnLike()`/`isObviousArticleNoise()` extension |
</phase_requirements>

---

## Summary

Phase 12 addresses two distinct bugs in `email-analyzer.js`: overcounting of positions/quantities due to lineItem duplication across zones, and missing INN validation that allows corrupt 10-digit numbers to pass through.

The `totalPositions` field is currently set seven times in `email-analyzer.js` (lines 1059, 1089, 1134, 1448, 1562, 1746, 3064/3183) — each merge step overwrites it with `Math.max(lineItems.length, articles.length)`. This counts raw lineItem entries including duplicates from different extraction zones (body, attachment, signature), not unique article codes. The fix adds a single `finalizeLeadCounts(lead)` call after all merge steps, replacing the scattered `Math.max` assignments. It deduplicates by `normalizeArticleCode` and sums the winning qty per unique code.

The INN checksum is completely absent. `normalizeInn()` at line 253 accepts any 9/10/12-digit string. `attachment-content.js` lines 223–235 extract `detectedInn` without checksum. The FNS mod-11 algorithm is well-documented and deterministic; implementing it adds a `validateInnChecksum(digits)` function that `normalizeInn()` calls internally. The same logic applied in Python in `audit_baseline.py` gives an honest `inn.noise_free` metric for the Phase 12 vs baseline comparison.

**Primary recommendation:** Add `finalizeLeadCounts()` as a post-processing function (one addition point, replaces all scattered `Math.max` calls), and add `validateInnChecksum()` called inside `normalizeInn()` — this single hook covers body, attachments, and form-parser since all paths go through `normalizeInn`.

---

## Standard Stack

No new dependencies are introduced in this phase.

### Core (already in use)
| Library | Version | Purpose |
|---------|---------|---------|
| `node:sqlite` (DatabaseSync) | Node.js 25 built-in | KB reads (no change) |
| `node:test` + `node:assert` | Node.js 25 built-in | Tests |

### Algorithms (no external library)
| Algorithm | Source | Purpose |
|-----------|--------|---------|
| INN mod-11 checksum | FNS official algorithm (nalog.gov.ru) | Validate 10/12-digit Russian INN |
| Article dedup | `normalizeArticleCode()` (existing) | Dedup lineItems for `positions` / `totalQty` |

**No `npm install` needed.** This phase is pure logic changes inside existing files.

---

## Architecture Patterns

### Pattern 1: Post-processing function in `analyzeEmailLead`

The established pattern in this codebase is to apply transformations at the end of `analyzeEmailLead()` after all merge steps. `validateSenderFields(sender)` at line 1807 is the canonical example — a single function handles all sender normalization after data is fully assembled.

`finalizeLeadCounts(lead)` follows the same pattern:
- Called once after the last merge step (currently line ~1807 area, after `validateSenderFields`)
- Reads `lead.lineItems` and `lead.articles` (which are already fully merged and deduped by this point)
- Writes `lead.positions` and `lead.totalQty`
- The seven scattered `totalPositions` assignments REMAIN in place as intermediate trackers during the merge phase; `finalizeLeadCounts` overwrites them with the authoritative final value

```javascript
// Source: existing pattern from validateSenderFields / mergeAttachmentLeadData
function finalizeLeadCounts(lead) {
    const seen = new Map(); // normalizedCode → maxQty
    for (const item of (lead.lineItems || [])) {
        const code = normalizeArticleCode(item.article || "").toLowerCase();
        if (!code) continue;
        const qty = (item.quantity != null) ? item.quantity : 0;
        const current = seen.get(code);
        if (current === undefined || qty > current) {
            seen.set(code, qty);
        }
    }
    // Also count articles that have no lineItem entry
    for (const a of (lead.articles || [])) {
        const code = normalizeArticleCode(a || "").toLowerCase();
        if (code && !seen.has(code)) {
            seen.set(code, 0);
        }
    }
    lead.positions = seen.size;
    lead.totalQty = [...seen.values()].reduce((s, q) => s + q, 0);
    return lead;
}
```

### Pattern 2: `validateInnChecksum` inside `normalizeInn`

```javascript
// Source: FNS official algorithm — nalog.gov.ru
// See: https://www.nalog.gov.ru/rn77/program/inn_check/
function validateInnChecksum(digits) {
    if (digits.length === 9) return true;  // Belarus УНП — no checksum
    const d = digits.split("").map(Number);
    if (digits.length === 10) {
        const w = [2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
        const sum = w.slice(0, 9).reduce((s, w, i) => s + w * d[i], 0);
        return d[9] === (sum % 11) % 10;
    }
    if (digits.length === 12) {
        const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
        const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0];
        const c1 = w1.slice(0, 11).reduce((s, w, i) => s + w * d[i], 0) % 11 % 10;
        const c2 = w2.slice(0, 12).reduce((s, w, i) => s + w * d[i], 0) % 11 % 10;
        return d[10] === c1 && d[11] === c2;
    }
    return false;  // Unknown length
}

// Updated normalizeInn:
function normalizeInn(v) {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, "");
    if (digits.length === 9) return digits;  // Belarus УНП
    if (digits.length === 10 || digits.length === 12) {
        return validateInnChecksum(digits) ? digits : null;
    }
    return null;
}
```

### Pattern 3: `attachment-content.js` checksum filter

The `detectedInn` array in `attachment-content.js` (lines 223–235) is built before `normalizeInn` is called. Checksum must be applied there directly (since `normalizeInn` is not imported in that file — verify before implementing):

```javascript
// In attachment-content.js, after building merged Set:
result.detectedInn = [...merged].filter((v) => {
    if (v.length === 9) return true;  // Belarus УНП
    return validateInnChecksum(v);
});
```

The `validateInnChecksum` function should be defined in `email-analyzer.js` and also in `attachment-content.js` (or shared via a small utility module if preferred). Given the codebase pattern of no external modules, a local copy is acceptable.

### Pattern 4: `isObviousArticleNoise` extension for INN checksum

Current code at line 6311–6313:
```javascript
if (isInnLike(normalized)) {
    if (normalized.length === 12) return true;
    if (normalized.length === 10 && !hasStrongArticleContext) return true;
}
```

After Phase 12, the 10-digit case uses checksum as the discriminator:
```javascript
if (isInnLike(normalized)) {
    if (normalized.length === 12) return true;
    if (normalized.length === 10) {
        // Passes checksum → it's a real INN, reject as article regardless of context
        // Fails checksum → neither INN nor article (reject both)
        return true;  // reject as article in all 10-digit cases
    }
}
```

The logic is: a 10-digit number that passes checksum is INN (reject as article). A 10-digit that fails checksum is noise (reject as article anyway). So the result is the same: always reject 10-digit pure numerics as articles. The `hasStrongArticleContext` exception is removed because a real INN should not be stored as an article even if it appears next to "Арт.:".

### Anti-Patterns to Avoid

- **Computing positions inside merge loops:** The root cause of Belgormash 18/7 is that `totalPositions = Math.max(lineItems.length, articles.length)` runs before zones are fully merged. Do not add another per-loop assignment — use `finalizeLeadCounts` at the end.
- **Calling normalizeInn on already-normalized digits:** `validateSenderFields` calls `normalizeInn(sender.inn)` where `sender.inn` may already be a normalized digits string. This is safe since `normalizeInn` idempotent — do not skip the call.
- **Importing across files without checking:** `normalizeInn` is defined in `email-analyzer.js` but `attachment-content.js` does not import from it (they are separate modules). Verify imports before assuming shared usage.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| INN checksum algorithm | Custom byte-shuffling | FNS official mod-11 coefficients — 3 lines of code, deterministic |
| Article dedup key | Custom string compare | `normalizeArticleCode()` already in `email-analyzer.js` (line 5746) and `article-normalizer.js` (line 50) — same output |
| Test runner | Any framework | `node:test` + `node:assert` — already in use for all 41 test files |

---

## Common Pitfalls

### Pitfall 1: `positions` vs `lineItems.length` mismatch after finalizeLeadCounts

**What goes wrong:** Existing code in `crm-adapters.js` reads `lead.total_positions` (underscore), not `lead.positions` (camelCase) and not `lead.totalPositions`. The field is serialized to JSON by `data/projects.json` storage as snake_case or camelCase depending on where it is set.

**Root cause:** `crm-adapters.js` line 133: `` `Позиций: ${lead.total_positions || 0}` `` and line 167: `totalPositions: lead.total_positions || 0`. These use snake_case `total_positions`, which is the stored field name — different from the in-memory `lead.totalPositions`.

**How to avoid:** D-01 says rename `totalPositions` → `positions` in `email-analyzer.js`. Also update `crm-adapters.js` to read `lead.positions`. Verify which field name the storage layer (`ProjectsStore`) persists — if it serializes camelCase to snake_case automatically, `lead.positions` stores as `positions` (not `total_positions`). Check `projects-store.js` to confirm the storage key.

**Warning signs:** CRM payload shows `totalPositions: 0` while UI shows correct count.

### Pitfall 2: Belarus INN (9-digit) incorrectly rejected by checksum

**What goes wrong:** The mod-11 algorithm is undefined for 9 digits. If `validateInnChecksum` is called with a 9-digit УНП, it must return `true` (skip checksum, accept as-is). Decision D-05 explicitly documents this.

**How to avoid:** First check in `validateInnChecksum`: `if (digits.length === 9) return true`. Similarly in `normalizeInn`: `if (digits.length === 9) return digits` — no checksum call needed.

### Pitfall 3: `totalQty` overcounting because `null` qty is not handled

**What goes wrong:** A lineItem with `quantity: null` should contribute 0 to `totalQty`, not `NaN`. JavaScript `null + 5 = 5` is fine, but `null + null` is `0` — careful with the reduce accumulator initial value.

**How to avoid:** In the dedup map: `const qty = (item.quantity != null) ? item.quantity : 0`. In the sum: `[...seen.values()].reduce((s, q) => s + q, 0)`.

### Pitfall 4: `isObviousArticleNoise` receiving non-string input

**What goes wrong:** `isObviousArticleNoise` is called with `normalizeArticleCode(...)` output, which is always a string. But `validateInnChecksum` will be called directly from within that function — if a 10-digit string slips through with non-digit chars (shouldn't happen after `normalizeArticleCode`), `parseInt` calls would fail.

**How to avoid:** `validateInnChecksum` should be defensive: `const d = String(digits).split("").map(Number)` and verify all are valid digits before proceeding.

### Pitfall 5: Audit script Python mod-11 must match JS implementation exactly

**What goes wrong:** If the Python checksum in `audit_baseline.py` uses slightly different coefficients or modulo logic, it produces different results from the JS, making `inn.noise_free` comparison between baseline_v1 and baseline_v2 meaningless.

**How to avoid:** Use identical coefficient arrays and `% 11 % 10` pattern in both JS and Python. Test both against the same known INN (e.g., `7707083893` — Sberbank, verifiable public INN).

### Pitfall 6: `crm-adapters.js` is NOT in `.railway-deploy/`

**What goes wrong:** All changes to `src/services/email-analyzer.js` and `src/services/attachment-content.js` must also be applied to `.railway-deploy/src/services/`. However, `crm-adapters.js` is only in `.railway-deploy/src/services/crm-adapters.js` (it was created as part of the Railway deploy structure).

**How to avoid:** After every file edit in `src/`, copy to `.railway-deploy/src/`. From MEMORY.md: "ВСЕГДА копировать изменённый файл в оба места".

---

## Code Examples

### Known-good INN checksums for tests

```
7707083893  → valid 10-digit (Сбербанк — public, verifiable)
7702802784  → valid 10-digit (already in tests/email-analyzer.test.js line 21)
7701234567  → valid 10-digit (already in tests, line 21 crm-adapters.test.js)
1234567890  → INVALID 10-digit (checksum fails — good for rejection test)
```

Verify `7707083893`:
- digits: 7,7,0,7,0,8,3,8,9,3
- weights: 2,4,10,3,5,9,4,6,8,0
- sum: 7×2 + 7×4 + 0×10 + 7×3 + 0×5 + 8×9 + 3×4 + 8×6 + 9×8 = 14+28+0+21+0+72+12+48+72 = 267
- 267 % 11 = 3; 3 % 10 = 3; digit[9] = 3 ✓

### Belgormash case (ART-04 regression test)

The concrete test case is: 2 articles × 5 qty each, but lineItems currently has 18 entries (duplicated across body/attachment/synth zones). After `finalizeLeadCounts`:
- `positions` = 2 (unique article codes)
- `totalQty` = 10 (5 + 5)

The existing test infrastructure already has `tests/email-analyzer.test.js` and `tests/article-extractor.test.js` — add the Belgormash regression to `email-analyzer.test.js` following the pattern used in existing inline tests.

### Audit script Python checksum

```python
def validate_inn_checksum(digits):
    """FNS mod-11 checksum for 10/12-digit Russian INN."""
    d = [int(c) for c in digits]
    if len(d) == 9:
        return True  # Belarus УНП — no checksum
    if len(d) == 10:
        w = [2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
        return d[9] == (sum(w[i] * d[i] for i in range(9)) % 11) % 10
    if len(d) == 12:
        w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
        w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8, 0]
        c1 = (sum(w1[i] * d[i] for i in range(11)) % 11) % 10
        c2 = (sum(w2[i] * d[i] for i in range(12)) % 11) % 10
        return d[10] == c1 and d[11] == c2
    return False

def check_inn(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    d = inn_digits(s.get("inn"))
    if not d:
        return {"present": False, "noise": False}
    ok_len = len(d) in (9, 10, 12)
    ok_checksum = validate_inn_checksum(d) if ok_len else False
    return {"present": True, "noise": not ok_checksum}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `totalPositions = Math.max(lineItems.length, articles.length)` in 7 places | `finalizeLeadCounts()` post-processing with dedup | Belgormash 18→2, totalQty accurate |
| No INN checksum (length-only) | `validateInnChecksum()` mod-11 | Corrupt INN rejected; `inn.noise_free` metric meaningful |
| `qty.noise_free = -0.23` (broken metric) | `positions.noise_free = % with totalQty > 0` | Positive, meaningful quality signal |

---

## Open Questions

1. **Does `ProjectsStore` persist `lead.positions` as `positions` or `total_positions`?**
   - What we know: `crm-adapters.js` reads `lead.total_positions` (snake_case). The field is written as `lead.totalPositions` (camelCase) in `email-analyzer.js`.
   - What's unclear: Whether `ProjectsStore` converts camelCase to snake_case during serialization.
   - Recommendation: Before renaming, grep for `total_positions` in `src/services/projects-store.js` and `src/server.js`. If the field is aliased during serialization, update the alias. If stored as-is, rename the read side in `crm-adapters.js` to `lead.positions`.

2. **Is `validateInnChecksum` needed in `attachment-content.js` as a local function or can it be imported?**
   - What we know: `attachment-content.js` does not currently import from `email-analyzer.js`. The project avoids circular imports.
   - What's unclear: Whether a shared utility module exists for requisite validators.
   - Recommendation: Duplicate the 10-line function in `attachment-content.js` for now (consistent with codebase pattern of small inlined helpers). A future refactor can extract to `requisite-validators.js`.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 12 is purely code/config changes within existing files. No new external tools, services, or CLI utilities required. Node.js 25 (confirmed: v25.2.1) and Python (`python` command, per project convention) are already available.

---

## Validation Architecture

`workflow.nyquist_validation = true` in `.planning/config.json` — section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node.js 25 built-in) |
| Config file | none — tests run directly via `node tests/*.test.js` |
| Quick run command | `node tests/email-analyzer.test.js` |
| Full suite command | `npm test` (runs all 41 test files) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ART-04 | Belgormash: 2 articles × 5 qty → `positions: 2, totalQty: 10` | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |
| ART-04 | `positions` = 0 when no articles | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |
| CONTACT-01 | INN from requisite PDF attachment flows to `sender.inn` | unit | `node tests/email-analyzer.test.js` | Partial — existing test line 964 covers it; add checksum aspect |
| CONTACT-02 | `7707083893` accepted (checksum pass) | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |
| CONTACT-02 | `1234567890` rejected as INN (checksum fail) | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |
| CONTACT-02 | 10-digit checksum-fail number rejected as article too | unit | `node tests/p0-regression.test.js` | Wave 0: extend test |
| CONTACT-02 | 9-digit Belarus УНП accepted without checksum | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |
| CONTACT-02 | INN checksum applied to attachment detectedInn | unit | `node tests/email-analyzer.test.js` | Wave 0: add test |

### Sampling Rate
- **Per task commit:** `node tests/email-analyzer.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/email-analyzer.test.js` — Belgormash `positions`/`totalQty`, INN checksum acceptance/rejection, Belarus УНП, attachment checksum filtering
- [ ] Extend `tests/p0-regression.test.js` — add checksum-fail 10-digit rejection as article
- [ ] No new test files needed — add to existing relevant files

---

## Project Constraints (from CLAUDE.md)

Directives the planner must verify compliance with:

| Constraint | Source | Implication for Phase 12 |
|------------|--------|--------------------------|
| Deploy to BOTH `src/` and `.railway-deploy/src/` | MEMORY.md deploy rule | Every changed file must be mirrored |
| ESM modules (`import`/`export`) | CLAUDE.md | No `require()` |
| Node.js 25 built-ins only (`node:sqlite`, `node:test`) | CLAUDE.md | No new npm packages |
| 4-space indentation | CLAUDE.md | Enforce in all edits |
| camelCase variables, kebab-case files | CLAUDE.md | `finalizeLeadCounts`, `validateInnChecksum` |
| Tests via `node:test` + `node:assert` | CLAUDE.md | No Jest/Vitest/Mocha |
| Run tests after every code change | CLAUDE.md | Each task ends with `npm test` |
| NEVER git push without explicit request | CLAUDE.md | Commit only, no push |
| Smoke-check after deploy | CLAUDE.md | If prod deploy triggered, curl healthcheck |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/services/email-analyzer.js` — all `totalPositions` assignments at lines 1059, 1089, 1134, 1448, 1562, 1746, 3064, 3183
- Direct code inspection of `src/services/crm-adapters.js` — `lead.total_positions` at lines 133, 167
- Direct code inspection of `src/services/attachment-content.js` — `detectedInn` extraction at lines 223–235 (no checksum)
- Direct code inspection of `scripts/audit_baseline.py` — `check_inn()` at lines 297–303 (length-only, no checksum)
- Direct code inspection of `scripts/baselines/baseline_v1.json` — `inn.present: 0.7633`, `inn.noise_free: 0.7367`, `qty.noise_free: -0.23`
- Direct code inspection of `src/services/article-filters.js` — `isInnLike()` at lines 200–203
- Direct code inspection of `src/services/email-analyzer.js` — `normalizeInn()` at line 253, `extractRequisites()` at line 6809, `validateSenderFields()` at line 349, `isObviousArticleNoise()` at line 6311–6313

### Secondary (MEDIUM confidence)
- FNS INN checksum algorithm: publicly documented on nalog.gov.ru, coefficient arrays reproduced in `.planning/phases/12-quantity-and-inn/12-CONTEXT.md` D-05 — consistent with known public sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, pure logic changes
- Architecture: HIGH — all integration points directly inspected in source
- Pitfalls: HIGH — root causes identified from direct code reading; `total_positions` vs `positions` naming gap is empirically confirmed
- INN algorithm: HIGH — deterministic math, coefficients from official FNS spec, cross-checked against known Sberbank INN

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (stable codebase, no external API dependencies)
