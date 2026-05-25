---
phase: 10-audit-baseline
plan: 03
subsystem: audit
tags: [audit, python, baseline, json, production, n8n-signal]

dependency_graph:
  requires:
    - phase: 10-audit-baseline/10-01
      provides: scripts/audit_baseline.py — per-field baseline script
    - phase: 10-audit-baseline/10-02
      provides: scripts/audit_sample_50.py — 50-email structured report script
  provides:
    - scripts/baselines/baseline_v1.json — committed live-prod baseline (version=1, n=300, seed=42)
    - data/audit_sample_50_report.json — 50-row manual audit input (gitignored, local only)
    - .gitignore entry excluding audit_sample_50_report.json
  affects:
    - phases 11-14 (delta computation against baseline_v1.json)

tech-stack:
  added: []
  patterns: [deterministic-baseline-with-seed, gitignored-raw-report, committed-baseline-json]

key-files:
  created:
    - scripts/baselines/baseline_v1.json
    - data/audit_sample_50_report.json (gitignored)
  modified:
    - .gitignore

key-decisions:
  - "Baseline sourced from live-prod (not local snapshot) — 300 Клиент-class emails from project-3 and project-4 with seed=42"
  - "raw_message_ids list persisted in baseline so phases 11-14 can re-target the exact same 300 emails for delta computation"
  - "audit_sample_50_report.json gitignored (raw email content) but committed baseline_v1.json is safe for repo"
  - "qty.noise=21/50 in 50-email report — highest noise field, consistent with business feedback that qty extraction is problematic"

patterns-established:
  - "Baseline pattern: committed baseline_v1.json with version/sample_size/sample_seed/fields/n8n_signal/raw_message_ids for phase-delta workflow"
  - "Gitignore pattern: raw email content stays local, only metrics JSON committed"

requirements-completed: [AUDIT-01, AUDIT-02, AUDIT-03]

duration: 15min
completed: "2026-05-25"
---

# Phase 10 Plan 03: Wave-2 Execution — Live Baseline Run Summary

**Live-prod per-field baseline written to `scripts/baselines/baseline_v1.json` (300 emails, seed=42) and 50-email manual audit report produced for AUDIT-01/02/03.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-25
- **Tasks:** 5 (Tasks 1-3 executed before checkpoint; Task 4 human checkpoint approved; Task 5 already committed)
- **Files modified:** 3 (`.gitignore`, `scripts/baselines/baseline_v1.json`, `data/audit_sample_50_report.json`)

## Accomplishments

- `.gitignore` updated to exclude `data/audit_sample_50_report.json` (raw email content stays local)
- `scripts/audit_baseline.py` executed live against production — baseline written with 300 Клиент-class emails
- `scripts/audit_sample_50.py` executed — 50-email structured report with per-field noise heuristics produced
- Human plausibility review checkpoint completed and approved
- All commits landed before checkpoint; Task 5 acceptance criteria verified post-approval

## Baseline Numbers (live-prod, n=300, seed=42)

| Field        | present% | Notes |
|--------------|----------|-------|
| fio          | 91.3%    | Higher than expected ~70-85% |
| inn          | 36.7%    | Slightly below expected ~40-55% |
| phone        | 75.7%    | Above expected ~45-65% |
| article      | 80.7%    | Well above expected ~40-55% |
| brand        | 63.3%    | Within expected ~50-65% |
| qty          | 42.3%    | Within expected ~30-50% |
| product_name | 71.0%    | Above expected ~25-45% |

**n8n signal:** `total_with_feedback=20` (10-20 emails historically sent, consistent with memory)

## 50-Email Audit Report Summary (seed=42)

| Field        | present | noise |
|--------------|---------|-------|
| fio          | 46/50   | 0/50  |
| inn          | 13/50   | 0/50  |
| phone        | 34/50   | 0/50  |
| article      | 42/50   | 5/50  |
| brand        | 32/50   | 12/50 |
| qty          | 21/50   | 21/50 |
| product_name | 38/50   | 0/50  |

Note: `qty.noise=21/50` is the highest noise rate — consistent with known qty extraction issues (quantity mis-fires on spec numbers, dates, etc).

## Task Commits

Previous agent committed tasks 1-3 before checkpoint:

1. **Task 1: .gitignore update** - `7b543a5` (chore(10-03))
2. **Tasks 2+3: run both scripts live** - `c7d49ad` (feat(10-03))

Task 4 was a human checkpoint (approved by user). Task 5 commit requirements were already satisfied by `c7d49ad` and `7b543a5`.

## Files Created/Modified

- `scripts/baselines/baseline_v1.json` — committed live-prod baseline, v1, n=300, 7 fields + n8n_signal + raw_message_ids
- `data/audit_sample_50_report.json` — local only (gitignored), 50 rows with `{value, present, noise, noise_reasons[]}` per field
- `.gitignore` — appended `data/audit_sample_50_report.json` exclusion rule

## Decisions Made

- Baseline sourced from live-prod (not local snapshot): all 7 present% values in plausible range, no 0% or 100% anomalies
- `raw_message_ids` (300 IDs) persisted in baseline so phases 11-14 can re-target the exact same cohort
- `qty` noise rate (42%) is the highest — should be Phase 11 priority target for improvement

## Deviations from Plan

None — plan executed exactly as written. The previous agent (pre-checkpoint) committed both .gitignore and baseline in two separate commits matching the plan's intent. Task 5 commit requirements were verified satisfied post-approval.

## Issues Encountered

None. Live production API was reachable. Both scripts completed successfully on first run.

## Next Phase Readiness

- `scripts/baselines/baseline_v1.json` committed and ready for phases 11-14 delta computation
- Phases 11-14 can run: `python scripts/audit_baseline.py --limit 300 --out scripts/baselines/baseline_vN.json` and compute field-level deltas
- Highest-priority improvement targets (by noise rate): qty (42%), brand (24%), article (12%)
- Phase 10 goal achieved: trustable baseline established

## Self-Check: PASSED

- `scripts/baselines/baseline_v1.json` exists: FOUND (git ls-files confirms tracked)
- `scripts/audit_baseline.py` exists: FOUND (git ls-files confirms tracked)
- `scripts/audit_sample_50.py` exists: FOUND (git ls-files confirms tracked)
- `data/audit_sample_50_report.json` NOT in git: CONFIRMED (git ls-files returns empty)
- Baseline validation: `version=1`, `sample_size=300`, all 7 fields 0<present<1: PASS
- 50-email report validation: `version=1`, `sample_seed=42`, 50 rows, all 7 field keys: PASS
- Commits `7b543a5` and `c7d49ad` exist: FOUND

---
*Phase: 10-audit-baseline*
*Completed: 2026-05-25*
