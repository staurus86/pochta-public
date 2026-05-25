---
phase: 11-article-foundation
plan: "02"
subsystem: article-extractor
tags: [article-extraction, signature-filtering, ART-01, D-04, tdd]
dependency_graph:
  requires: []
  provides: [ART-01-signature-hard-exclude]
  affects: [article-extractor.js]
tech_stack:
  added: []
  patterns: [hard-exclude-filter, tdd-red-green]
key_files:
  created: []
  modified:
    - src/services/article-extractor.js
    - .railway-deploy/src/services/article-extractor.js
    - tests/article-extractor.test.js
decisions:
  - "Renamed step-8 variable to passingByScore; new step-8b const passing filters out ZONES.SIGNATURE — preserves existing variable name downstream so no other lines change"
  - "Used strengthened TDD assertion: rawCandidates must contain QIT3-5033 with zone=signature, proving the hard-exclude (not just score-based demotion) removes it"
metrics:
  duration: "~5 min"
  completed: "2026-05-26"
  tasks_completed: 2
  files_modified: 3
---

# Phase 11 Plan 02: Signature Hard-Exclude Filter Summary

**One-liner:** Signature-zone hard-exclude filter inserted after score threshold in `extractArticles()` per ART-01 D-04 — articles from email signature blocks never appear in `result.articles`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add ART-01 signature hard-exclude test (RED) | `6219cfc` | tests/article-extractor.test.js |
| 2 | Implement signature hard-exclude (GREEN) + mirror | `4046b49` | src/services/article-extractor.js, .railway-deploy/src/services/article-extractor.js |

## Implementation Details

### Exact Insertion Point

File: `src/services/article-extractor.js`, lines 314-318

Before:
```javascript
// 8. Score threshold
const passing = accepted.filter((a) => a.score >= effectiveMinScore);

// 9. Sort by zone priority then score
```

After:
```javascript
// 8. Score threshold
const passingByScore = accepted.filter((a) => a.score >= effectiveMinScore);

// Step 8b. Hard-exclude signature zone (ART-01 D-04): signatures never yield article results
const passing = passingByScore.filter((a) => a.zone !== ZONES.SIGNATURE);

// 9. Sort by zone priority then score
```

### Variable Rename Evidence

- `passingByScore` appears exactly **2 times** in the file (declaration on line 315, reference on line 318)
- All downstream code (step 9 sort, step 10 dedup) continue to use `passing` — unchanged

### SHA256 Verification

```
src/services/article-extractor.js SHA256:
6c058839af40d35b15f0813f549af8719bc94c87d12163a0ba96cff353d7c02e

.railway-deploy/src/services/article-extractor.js SHA256:
6c058839af40d35b15f0813f549af8719bc94c87d12163a0ba96cff353d7c02e

MIRROR OK — byte-identical
```

## Test Results

**New tests added:** 1  
**Test name:** `extractor: signature zone articles hard-excluded from result (ART-01 D-04)`

**Test assertions:**
1. `DNC-100-PPV-A` (body zone) present in `result.articles`
2. `QIT3-5033` (signature zone) NOT present in `result.articles`
3. `QIT3-5033` present in `result.rawCandidates` (audit/debug visibility preserved)
4. `QIT3-5033` rawCandidate has `zone === "signature"`

**Wave 0 probe result:** Without the filter, `QIT3-5033` was already excluded by score-based demotion (signature zone scores 1+3-2=2, below minScore=3). The hard-exclude filter makes this a contractual guarantee independent of score. The strengthened assertion validates rawCandidates for this case.

**npm test results:** 31 PASS / 4 FAIL  
The 4 failing tests are pre-existing ART-02 UUID filter tests (written by parallel agent 11-03 but not yet implemented in article-filters.js at the time of this plan execution) — not caused by Plan 02 changes.

## Deviations from Plan

None — plan executed exactly as written. The wave 0 probe confirmed the expected path (QIT3-5033 score-demoted but not hard-excluded pre-fix), and the strengthened rawCandidates assertions were added per plan instructions.

## Self-Check

Files exist:
- `src/services/article-extractor.js` — FOUND
- `.railway-deploy/src/services/article-extractor.js` — FOUND
- `tests/article-extractor.test.js` — FOUND

Commits exist:
- `6219cfc` — FOUND (test: add failing test for ART-01 D-04 signature hard-exclude)
- `4046b49` — FOUND (feat: implement ART-01 D-04 signature hard-exclude in article-extractor)

## Self-Check: PASSED
