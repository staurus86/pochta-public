---
phase: 12-quantity-and-inn
plan: 01
status: completed
completed_at: "2026-05-28"
commits:
  - e550df9 test(12-01): add failing positions/totalQty tests for ART-04
  - 7a50aa7 feat(12-01): add finalizeLeadCounts for ART-04 positions/totalQty
  - da4ba4f refactor(12-01): rename total_positions to positions, add total_qty, mirror to railway-deploy
---

# Plan 01 Summary — ART-04 positions/totalQty

## What was done

- Added `export function finalizeLeadCounts(lead)` in `email-analyzer.js` (after `validateSenderFields`)
- Deduplication via `normalizeArticleCode().toLowerCase()` as key, max qty per unique code
- Sets `lead.positions`, `lead.totalQty`, and `lead.totalPositions` (backward compat)
- Wired into `analyzeEmail()` as single authoritative write after `validateSenderFields`
- Updated `integration-api.js`: `total_positions` → `positions` + new `total_qty`
- Updated `crm-adapters.js`: Bitrix COMMENTS + build1CPayload read `positions`/`total_qty`
- Updated `integration-openapi.js`: schema uses `positions` + `total_qty`
- Updated `llm-extractor.js`: added `result.lead.positions = result.lead.totalPositions`
- Mirrored all 5 files to `.railway-deploy/src/services/` (SHA256 verified)

## Test results

- 5/5 ART-04 tests green (Belgormash: 18 dup → positions=2, totalQty=10)
- Full suite: only pre-existing FAIL (docx/xlsx attachments)
