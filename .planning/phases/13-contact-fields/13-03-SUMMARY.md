---
phase: 13-contact-fields
plan: 03
status: completed
completed_at: "2026-05-28"
commits:
  - 76c6c73 feat(13-03): add FIO_NOISE_NAMES to audit_baseline.py check_fio (CONTACT-03)
  - d9261e8 chore(13-03): generate baseline_v3.json post Phase 13 fixes
---

# Plan 03 Summary — Audit Baseline v3

## What was done

- Added `FIO_NOISE_NAMES = {"екатерина попова"}` to `audit_baseline.py` (Python mirror of JS FIO_TEMPLATE_BLOCKLIST)
- Updated `check_fio`: `is_noise` now also true if `fio.lower() in FIO_NOISE_NAMES`
- Generated `scripts/baselines/baseline_v3.json` (seed=42, limit=300, same snapshot as v1/v2)

## Phase 13 delta (v2 → v3)

| Field | v2 noise_free | v3 noise_free | Delta |
|-------|---------------|---------------|-------|
| fio | 0.9533 | 0.9400 | -1.33pp (audit found ~4 template-name cases in old snapshot) |
| phone | 0.7433 | 0.7433 | 0 (no change — paths already worked) |

**Note on fio decrease**: The v3 audit found «Екатерина Попова» in ~4/300 historical messages and now correctly marks them as noise. After Phase 13 is deployed to production, fresh analyses will produce `fullName = null` for those cases → `fio.present` will slightly decrease but `fio.noise_free/present` ratio will be 1.0 for those emails.
