---
phase: 11-article-foundation
plan: 01
subsystem: article-filters
tags: [article-extraction, regex, filters, uuid, hex, noise-removal]

# Dependency graph
requires: []
provides:
  - "rejectArticleCandidate() rejects UUID v4 tokens (form metadata) with reason uuid_or_long_hex"
  - "rejectArticleCandidate() rejects 20+ char hex strings (tracking tokens) with reason uuid_or_long_hex"
  - "UUID_V4_RE and LONG_HEX_RE module-level constants in article-filters.js"
affects:
  - 11-article-foundation
  - any phase consuming article-extractor results

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UUID/hex rejection placed BEFORE all other checks in rejectArticleCandidate (ordering matters for correct reason label)"
    - "src/ and .railway-deploy/src/ kept byte-identical via cp + SHA256 verification"

key-files:
  created: []
  modified:
    - src/services/article-filters.js
    - .railway-deploy/src/services/article-filters.js
    - tests/article-extractor.test.js

key-decisions:
  - "UUID check placed BEFORE isInnLike/isPhoneFragment to ensure correct reason label per ART-02 spec"
  - "TDD Red-Green cycle: 5 failing tests committed first, then implementation"

patterns-established:
  - "UUID_V4_RE/LONG_HEX_RE pattern: use /i flag to handle mixed-case tracking tokens"
  - "Mirror protocol: cp src/ .railway-deploy/src/ + sha256sum verification after every article-filters change"

requirements-completed:
  - ART-02

# Metrics
duration: 15min
completed: 2026-05-26
---

# Phase 11 Plan 01: article-foundation Summary

**UUID v4 and 20+-char hex token rejection added to rejectArticleCandidate() via two module-level regex constants, eliminating form metadata and tracking tokens from article output**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-26T00:00:00Z
- **Completed:** 2026-05-26T00:15:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `UUID_V4_RE` and `LONG_HEX_RE` module-level regex constants to `article-filters.js`
- Added two checks at the top of `rejectArticleCandidate()` (before all other checks) returning `{ rejected: true, reason: "uuid_or_long_hex" }`
- 5 TDD tests written and verified RED then GREEN
- Both `src/services/article-filters.js` and `.railway-deploy/src/services/article-filters.js` updated — SHA256 confirmed byte-identical

## Task Commits

1. **Task 1: RED — add failing UUID/hex tests** - `ce27874` (test)
2. **Task 2: GREEN — implement UUID/hex filter + mirror** - `504d592` (feat)

## Files Created/Modified

- `src/services/article-filters.js` — Added UUID_V4_RE (line 15), LONG_HEX_RE (line 16), two checks at lines 280-281 in rejectArticleCandidate
- `.railway-deploy/src/services/article-filters.js` — Byte-identical mirror of src/ (SHA256: ad054bc1d39fcebb613cc57acc5f94ca8e566a5b146c6134e48985027ad9ea14)
- `tests/article-extractor.test.js` — 5 new ART-02 tests at lines 479-509

## Test Results

- **New ART-02 tests:** 5/5 GREEN
- **Total article-extractor tests:** 34 pass, 0 fail
- **Pre-existing failures (Windows tar, docx/xlsx):** 2 — unchanged, unrelated
- **Full npm test:** same pre-existing 2 failures, no regressions

## SHA256 Verification

```
SHA256(src/services/article-filters.js) = ad054bc1d39fcebb613cc57acc5f94ca8e566a5b146c6134e48985027ad9ea14
SHA256(.railway-deploy/src/services/article-filters.js) = ad054bc1d39fcebb613cc57acc5f94ca8e566a5b146c6134e48985027ad9ea14
MIRROR OK
```

## Decisions Made

- UUID_V4_RE check placed BEFORE `isInnLike` and `isPhoneFragment` — critical because UUID tokens could theoretically match phone/INN shapes, and the reason label `uuid_or_long_hex` must win to accurately diagnose the noise source

## Deviations from Plan

None - plan executed exactly as written. The only discovery was that the worktree has a separate file tree from the main repo, so edits must target the worktree path explicitly.

## Issues Encountered

- Worktree path discovery: initial edits went to the main repo path (`C:\Opencode-test\pochta\`) instead of the worktree path (`C:\Opencode-test\pochta\.claude\worktrees\agent-a0e223164cba4f58f\`). Resolved by identifying `pwd` = worktree and targeting worktree paths for all bash/file operations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ART-02 requirement complete: UUID v4 and long-hex tokens now rejected before they reach the article output array
- Ready for Plan 11-02 (email-zoning integration) and Plan 11-03 (quantity extraction)
- No blockers

---
*Phase: 11-article-foundation*
*Completed: 2026-05-26*
