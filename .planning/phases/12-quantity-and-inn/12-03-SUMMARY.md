---
phase: 12-quantity-and-inn
plan: 03
status: completed
completed_at: "2026-05-28"
commits:
  - d9ab179 feat(12-03): checksum-filter attachment detectedInn (CONTACT-01/CONTACT-02)
  - c1fbbd2 chore(12-03): mirror attachment checksum to .railway-deploy
  - eeea586 feat(12-03): add INN checksum + positions metrics to audit_baseline.py
  - 6c45b53 chore(12-03): generate baseline_v2.json post Phase 12 fixes
---

# Plan 03 Summary — CONTACT-01 + Audit Metrics

## What was done

- Added local `export function validateInnChecksum(digits)` in `attachment-content.js`
  (algorithm identical to email-analyzer.js — local copy, no cross-import)
- Filtered `detectedInn` in `analyzeStoredAttachments`: `.filter((v) => validateInnChecksum(v))`
- Added 2 CONTACT-01 tests in `batch-12-fixes.test.js`:
  - Filter test: `["7707083893","1234567890"].filter(...)` → `["7707083893"]`
  - Parity test: both copies return identical results for 5 test values
- Mirrored `attachment-content.js` to `.railway-deploy/src/services/` (SHA256 OK)
- Updated `scripts/audit_baseline.py`:
  - Added `validate_inn_checksum(digits)` Python function (FNS mod-11)
  - Replaced `check_inn` body: noise = not checksum-valid (was: not length-valid)
  - Added `check_positions(msg)`: present = positions > 0, noise = not (totalQty > 0)
  - Added `"positions"` to FIELDS tuple + `score_sample` results dict
  - `check_qty` retained (additive, not replaced)
- Generated `scripts/baselines/baseline_v2.json` (seed=42, limit=300, same snapshot as v1)

## Phase 12 delta (v1 → v2)

| Field | v1 noise_free | v2 noise_free | Delta |
|-------|---------------|---------------|-------|
| inn | 0.7367 (length-only) | 0.7633 (checksum-based) | +2.66pp |
| positions | — (not in v1) | 0.0 (old snapshot, field absent) | new metric |

**Note on positions = 0.0**: The snapshot (`prod-messages-local-postAudit2.json`) was captured before Phase 12 changes, so stored messages don't yet have the `positions` field. The metric will become meaningful after a live re-analysis or new snapshot.

**Note on inn improvement**: +2.66pp because the old check counted 9-digit Belarus УНП as noise (not in (10, 12)); the new checksum check correctly accepts them.

## Test results

- 17/17 batch-12 tests green (5 ART-04 + 10 CONTACT-02 + 2 CONTACT-01)
- Full suite: only pre-existing FAIL (docx/xlsx attachments)
