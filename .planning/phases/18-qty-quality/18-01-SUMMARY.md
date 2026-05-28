---
phase: 18-qty-quality
plan: "01"
subsystem: quantity-extractor
tags: [tdd, qty, extraction, audit-metric]
dependency_graph:
  requires: []
  provides: [multiline_table-source, bold-strip, check_qty-v2]
  affects: [email-analyzer.js, audit_baseline.py]
tech_stack:
  added: []
  patterns: [raw-line distance scanning, pre-processing strip]
key_files:
  created:
    - tests/batch-18-qty-fixes.test.js
  modified:
    - src/services/quantity-extractor.js
    - .railway-deploy/src/services/quantity-extractor.js
    - scripts/audit_baseline.py
decisions:
  - "Raw lines (not filtered) used for multiline distance calc so blank lines count as separators — prevents false positives at distance=4"
  - "check_qty v2: article-only emails (no qty) are NOT noise — B2B КП pattern is valid"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-29"
  tasks_completed: 3
  files_modified: 4
---

# Phase 18 Plan 01: QTY-1 multiline_table scanner + QTY-2 bold strip + check_qty v2 Summary

**One-liner:** Multiline HTML table qty scanner (raw-line distance) + Outlook bold strip (*) + audit metric v2 (no-qty-in-email is not noise)

## What Was Built

### QTY-2: Bold Strip (`src/services/quantity-extractor.js`, line 174-178)
Added pre-processing at top of `extractQuantities()` after `const articles = options.articles || []`:
```javascript
if (typeof input === "string") {
    input = input.replace(/\*+/g, "");
}
```
Strips Outlook bold/italic markdown markers before any parsing. Handles `*1**0****шт.*` → `10шт.` → value=10.

### QTY-1: Multiline Table Scanner (`src/services/quantity-extractor.js`, lines 224-261)
Added cross-line pairing block after `const lines = text.split(...)...filter(Boolean)` and BEFORE `const accepted = []`.

Key design choice: scanner operates on `_rawLines = text.split(/\r?\n/)` (before blank-line filtering) so blank lines count toward distance. This prevents false positives: `"100\n\n\n\nшт"` (distance=4 in raw lines) correctly produces no match, while `"10\n\nшт"` (distance=2) correctly matches.

Backward and forward search within 2 raw lines. Unit regex: `шт|штука|pcs|pc|компл|к-т|уп|рул|бух|ед`. Number regex: pure numeric line only (`^\d+(?:[.,]\d+)?$`).

Line where items are merged into accepted (line 310):
```javascript
accepted.push(..._multilineItems);
```

### `pickPrimary` priority update (`src/services/quantity-extractor.js`, line 156)
Added `multiline_table: 2` to priority map (same level as `inline`).

### check_qty v2 (`scripts/audit_baseline.py`, lines 368-391)
Replaced function body. Old behavior: `noise = not has_any_qty` (no qty = noise). New behavior:
- No articles → `{present: False, noise: False}` (unchanged)
- Articles present, no qty extracted → `{present: False, noise: False}` (B2B article-only is valid)
- Qty extracted → `noise = any qty > 10000 without labeled/pack source` (outlier check only)

## RED Phase Results

Initial test run of `tests/batch-18-qty-fixes.test.js` before implementation:
- **7 tests FAILED (RED):** QTY-1 distance=1, QTY-1 distance=2, QTY-1 unit-first distance=1, QTY-1 unit-first distance=2, QTY-1 realistic block, QTY-1 pcs variant, QTY-2 bold strip
- **3 tests PASSED (guards):** false-positive guard (distance=4), regression "90 мм" → null, regression "Клапан шаровой 90 мм" → null

## GREEN Phase Results

After implementation:
- `tests/batch-18-qty-fixes.test.js`: **10/10 pass**
- `tests/quantity-extractor.test.js`: **39/39 pass** (no regressions; was 32 before this plan added to original test file count, per existing suite)
- `npm test`: **151 PASS, 2 FAIL** (2 pre-existing: docx/xlsx tar failures on Windows — not related)

## Mirror Verification

```
node -e "const fs=require('fs'); const a=fs.readFileSync('src/services/quantity-extractor.js','utf8'); const b=fs.readFileSync('.railway-deploy/src/services/quantity-extractor.js','utf8'); console.log(a===b ? 'MIRROR_OK' : 'MIRROR_MISMATCH');"
```
Result: **MIRROR_OK**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] False-positive guard failure due to blank-line filtering**
- **Found during:** Task 2 GREEN verification
- **Issue:** Plan's `_UNIT_ONLY_RE` scanner operated on `lines` (blank lines already filtered). So `"100\n\n\n\nшт"` after `filter(Boolean)` became `["100", "шт"]` (distance=1), causing distance=4 guard test to fail.
- **Fix:** Changed scanner to use `_rawLines = text.split(/\r?\n/)` (raw, before filter). Blank lines now count toward distance, matching the plan's intent.
- **Files modified:** `src/services/quantity-extractor.js`, `.railway-deploy/src/services/quantity-extractor.js`
- **Commit:** ae7a691 (amended in same task commit)

## Commits

| Hash | Description |
|------|-------------|
| 00ac3ec | test(18-01): add failing tests for QTY-1 multiline_table + QTY-2 bold strip |
| ae7a691 | feat(18-01): QTY-1 multiline_table scanner + QTY-2 bold strip |
| 9f1099e | feat(18-01): check_qty v2 metric + mirror quantity-extractor.js to Railway |

## Known Stubs

None.

## Self-Check: PASSED
