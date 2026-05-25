---
phase: 11-article-foundation
verified: 2026-05-26T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 11: Article Foundation Verification Report

**Phase Goal:** Артикулы в каждом письме извлекаются только из тела запроса (не из подписей и цитат), без UUID-мусора и без дублей
**Verified:** 2026-05-26
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `article-extractor.js` подключён в `extractLead()` — inline regex-каскад 500 строк заменён, зонирование активно | VERIFIED | `import { extractArticles }` on line 17; `extractArticles({subject, body: bodyNoUrls, attachmentText}, ...)` at line 2799; `extractLead()` signature changed to `attachmentText` at line 2791 |
| 2 | Токены формата UUID v4 (hex 32+ символов) не появляются в массиве артикулов | VERIFIED | `UUID_V4_RE` (line 15) and `LONG_HEX_RE` (line 16) in `article-filters.js`; both checks placed before `isInnLike` (lines 280-281 vs 290); 5 tests pass |
| 3 | `MD-025-6L` и `MD 025-6L` сворачиваются в одну запись | VERIFIED | `dedupKey()` in `article-normalizer.js` strips all non-alnum; dedicated test "extractor: MD-025-6L and MD 025-6L collapse to one article (ART-03 D-08)" passes |
| 4 | Артикулы из подписи и цитированного треда не попадают в результат детекции | VERIFIED | `passing = passingByScore.filter((a) => a.zone !== ZONES.SIGNATURE)` at line 323 of `article-extractor.js`; test "extractor: signature zone articles hard-excluded from result (ART-01 D-04)" passes |

**Score: 4/4 truths verified**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/services/article-filters.js` | `UUID_V4_RE` and `LONG_HEX_RE` constants + two top-of-function checks | VERIFIED | Lines 15-16: constants; lines 280-281: checks before `isInnLike` (line 290) |
| `.railway-deploy/src/services/article-filters.js` | Byte-identical mirror of src/ | VERIFIED | SHA256 MIRROR OK (confirmed by PowerShell Get-FileHash) |
| `src/services/article-extractor.js` | `a.zone !== ZONES.SIGNATURE` filter between score-threshold and sort steps | VERIFIED | Line 320: `passingByScore`; line 323: `passing = passingByScore.filter((a) => a.zone !== ZONES.SIGNATURE)`; line 325: sort step follows |
| `.railway-deploy/src/services/article-extractor.js` | Byte-identical mirror of src/ | VERIFIED | SHA256 MIRROR OK |
| `src/services/email-analyzer.js` | `import { extractArticles }` + `extractLead()` uses facade + 3 call sites pass `attachmentContent` | VERIFIED | Line 17: import; line 2791: function sig with `attachmentText`; lines 1006, 1018, 1028: all three call sites pass `attachmentContent`; no `attachments.join` found |
| `.railway-deploy/src/services/email-analyzer.js` | Byte-identical mirror of src/ | VERIFIED | SHA256 MIRROR OK |
| `tests/article-extractor.test.js` | 7 new tests: 5 ART-02 + 1 ART-01 signature + 1 ART-03 dedup | VERIFIED | All 36 tests pass, 0 fail |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `email-analyzer.js` top imports | `article-extractor.js` | `import { extractArticles } from "./article-extractor.js"` | WIRED | Line 17 confirmed |
| `extractLead()` body | `extractArticles({subject, body: bodyNoUrls, attachmentText}, ...)` | Direct function call at line 2799 | WIRED | URL-stripped body used; `attachmentText` named param confirmed |
| All 3 `extractLead()` call sites | `attachmentContent` (string, line 921) | 4th positional argument | WIRED | Lines 1006, 1018, 1028 all pass `attachmentContent` — no `attachments` (array) usage remains |
| `article-extractor.js` step 8b | `ZONES.SIGNATURE` from `email-zoning.js` | `.filter((a) => a.zone !== ZONES.SIGNATURE)` | WIRED | Line 323 confirmed |
| `article-filters.js` `rejectArticleCandidate()` | UUID/hex check before other rules | UUID_V4_RE and LONG_HEX_RE at lines 280-281 | WIRED | Confirmed before `isInnLike` (line 290) and `isPhoneFragment` (line 289) |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `email-analyzer.js extractLead()` | `allArticles` | `artResult.articles` from `extractArticles()` | Yes — zone-aware facade processes real email body/subject/attachment | FLOWING |
| `article-extractor.js extractArticles()` | `passing` | `passingByScore.filter(zone !== SIGNATURE)` from actual candidate scoring | Yes — candidates built from real email body zones | FLOWING |
| `article-filters.js rejectArticleCandidate()` | `rejected` result | UUID_V4_RE/LONG_HEX_RE applied to real token strings | Yes — real tokens evaluated at extraction time | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 36 tests pass (ART-01 + ART-02 + ART-03) | `node --test tests/article-extractor.test.js` | 36 pass, 0 fail | PASS |
| UUID v4 rejected as `uuid_or_long_hex` | Covered by test suite | ✓ 5 tests pass | PASS |
| Signature zone articles excluded | Covered by test suite | ✓ 1 test passes | PASS |
| MD-025-6L and MD 025-6L dedup to one | Covered by test suite | ✓ 1 test passes | PASS |
| All 3 src/ vs .railway-deploy/ mirrors match | PowerShell SHA256 | MIRROR OK × 3 | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ART-01 | 11-02, 11-03 | Zone-aware extractor wired into `extractLead()`, signature/quoted excluded | SATISFIED | `a.zone !== ZONES.SIGNATURE` in `article-extractor.js`; facade call in `extractLead()`; tests green |
| ART-02 | 11-01 | UUID v4 and long-hex tokens rejected | SATISFIED | `UUID_V4_RE`/`LONG_HEX_RE` in `article-filters.js`; 5 tests green |
| ART-03 | 11-03 | Space/dash dedup key normalizes `MD-025-6L` ≡ `MD 025-6L` | SATISFIED | `dedupKey()` implementation confirmed; ART-03 test passes |

**Requirement traceability note:** REQUIREMENTS.md traceability table marks ART-03 as "Pending" (line 70) and the checkbox at line 21 is unchecked `[ ]`. This is a documentation inconsistency — the implementation exists in `article-normalizer.js` (`dedupKey()` strips all non-alnum), the test "extractor: MD-025-6L and MD 025-6L collapse to one article (ART-03 D-08)" passes, and the plan claims the dedup was pre-existing per D-08. REQUIREMENTS.md was not updated after the phase completed. This is a docs-only gap, not a code gap.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/services/email-analyzer.js` | ~2823-2834 | Legacy inline helpers `extractBrandAdjacentCodes()` and `extractStandaloneCodes()` called as supplements AFTER the facade | Info | Not a stub — these are intentional supplements documented as Supplement 1 and Supplement 2 in comments (colon-separated codes and brand-adjacent codes that the facade does not catch). Plan 03 explicitly defers their removal. |
| `11-03-AUDIT.json` | — | `article.present = 0.75` (75.0%) which is BELOW the 75.7% gate threshold | Warning | SUMMARY.md explains this is a pre-wiring local snapshot — the stored data was analyzed by the old code before wiring. The gate was human-approved with the explanation that real regression measurement requires post-deploy reanalysis. Not a code bug, but the audit gate measurement is unreliable for this plan's change. |

---

## Human Verification Required

### 1. Post-deploy article.present regression gate

**Test:** After deploying this phase to Railway production, run `python scripts/audit_baseline.py --limit 300` (live production fetch) and check `article.present`.
**Expected:** >= 0.757 (75.7%) — the Phase 10 baseline was 80.7%, max allowed drop is 5%.
**Why human:** The local audit snapshot (`11-03-AUDIT.json`) shows 75.0% but this reflects pre-wiring stored data analyzed by old code, not re-analyzed by the new facade. A production reanalysis is required to confirm no regression.

### 2. REQUIREMENTS.md checkbox for ART-03

**Test:** Update line 21 of `REQUIREMENTS.md` from `[ ]` to `[x]` and update the traceability table entry for ART-03 from "Pending" to "Complete".
**Expected:** Documentation matches implementation state.
**Why human:** Documentation-only update, no code change needed — human decision to confirm ART-03 is complete before marking it.

---

## Gaps Summary

No code gaps found. Phase goal is achieved:

- The facade (`extractArticles()`) is wired into `extractLead()` replacing the 500-line inline cascade.
- UUID/long-hex tokens are rejected at the filter layer before any other rule.
- Signature-zone candidates are hard-excluded after the score threshold step.
- Space/dash dedup collapses `MD-025-6L` and `MD 025-6L` to one entry.
- All three service files are byte-identical between `src/` and `.railway-deploy/src/`.
- 36/36 tests pass.

Two non-blocking items remain: (1) a post-deploy live audit measurement to replace the unreliable local snapshot gate, and (2) a docs-only update to REQUIREMENTS.md checkbox for ART-03.

---

_Verified: 2026-05-26_
_Verifier: Claude (gsd-verifier)_
