---
phase: 17-brand-quality
plan: 01
status: completed
completed_at: "2026-05-28"
commits:
  - "7324901 test(17-01): add failing GHOST-1..4 regression tests for brand quality fixes"
  - "0d0205e feat(17-01): GHOST-1 zone filter (>0 with attachment guard) + GHOST-4 blocklist"
  - "c348608 feat(17-01): GHOST-2 conditional splitAliasBundle + GHOST-3 concat-normalized dedup"
---

# Phase 17 Plan 01 — SUMMARY

## What Was Fixed

### GHOST-1: Quoted-reply bleed
**File:** `src/services/email-analyzer.js` (+ mirror)
**Change:** Zone filter threshold lowered from `> 5` to `> 0`. Added `attachmentContent` grounding — brands absent from `primaryBody + subject` but present in attachments are preserved. Guard maintained: if zero brands are grounded, all brands are kept.
**Impact:** Short client replies ("Берем.") no longer surface brands from the quoted Siderus message history.

### GHOST-2: Slash-canonical generic second parts
**File:** `src/services/brand-normalizer.js` (+ mirror)
**Change:** Added `GENERIC_SPLIT_PARTS` set (`instruments`, `west`, `systems`, `controls`, `control`, `technology`, `solutions`, `smart`). When any split part matches, only the first (primary) part is returned.
**Impact:** `"WEST Control Solutions / Instruments"` → `["WEST Control Solutions"]`. Legitimate pairs (`ASCO Joucomatic / Numatics`, `Buerkert / Burkert`) still split fully.

### GHOST-3: Multi-canonical duplicates (Endress variants)
**File:** `src/services/brand-normalizer.js` (+ mirror)
**Change:** Added `normalizeForDedup` helper (strips `+ & - . ` whitespace, lowercases) + second dedup pass at the end of `dedupCanonical`.
**Impact:** `["Endress+Hauser", "Endress & Hauser", "ENDRESS+HAUSER"]` → 1 brand. `["Bosch", "Bosch Rexroth"]` stays 2.

### GHOST-4: Generic single-token aliases
**File:** `src/services/detection-kb.js` (+ mirror)
**Change:** Added `"instruments", "smart", "west", "drive", "neo", "mission"` to `BRAND_FALSE_POSITIVE_ALIASES`.
**Impact:** Common words from 15K-brand KB import no longer register as detected brands.

## Test Results

```
tests/batch-17-brand-fixes.test.js — 8/8 PASS (all GHOST-1..4 tests green)
tests/brand-extractor.test.js      — 25/25 PASS (facade — no regression)
tests/brand-scattered-match.test.js — PASS (no regression)
```

Full suite: 148+ PASS / 3 FAIL pre-existing (docx/xlsx/company-directory, unrelated).

## Mirror Parity

All edits applied to BOTH:
- `src/services/email-analyzer.js` ↔ `.railway-deploy/src/services/email-analyzer.js`
- `src/services/brand-normalizer.js` ↔ `.railway-deploy/src/services/brand-normalizer.js`
- `src/services/detection-kb.js` ↔ `.railway-deploy/src/services/detection-kb.js`

## Ready for Plan 02

Plan 02 tasks:
1. GHOST-5 audit fix (full body vs bodyPreview)
2. Deploy Plan 01 fixes to Railway + reanalysis
3. Checkpoint (human verification)
4. Capture baseline_v8 (target: brand.noise_free ≥ 55%)
