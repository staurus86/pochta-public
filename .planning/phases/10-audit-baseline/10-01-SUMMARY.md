---
phase: 10-audit-baseline
plan: 01
subsystem: testing
tags: [python, audit, sqlite, detection, baseline, n8n, email-classifier]

# Dependency graph
requires: []
provides:
  - "scripts/audit_baseline.py — per-field detection baseline (AUDIT-02 + AUDIT-03)"
  - "scripts/baselines/baseline_v1.json — persistent baseline file with 7 field metrics + n8n signal"
affects:
  - "10-audit-baseline plan 02 (manual 50-email audit)"
  - "10-audit-baseline plan 03 (delta comparisons post-fix)"
  - "phases 11-14 (all use baseline_v1.json for delta computation)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deterministic sampling: random.seed(42) + raw_message_ids persisted in JSON for reproducible deltas"
    - "KB-aware ghost-brand check: is_brand_grounded() with explicit KB args instead of closure"
    - "Atomic JSON write: write to .tmp then os.replace to avoid half-written baseline on crash"
    - "Dual source mode: --local (newest data/prod-messages-*.json) vs live API fetch"
    - "INN normalization: str(inn).split('.')[0] before re.sub(r'\\D','') to strip .0 float artifact"

key-files:
  created:
    - scripts/audit_baseline.py
    - scripts/baselines/baseline_v1.json
  modified: []

key-decisions:
  - "baseline_v1.json goes in scripts/baselines/ (committed to git) not data/ (gitignored)"
  - "is_brand_grounded() refactored from closure to explicit KB args so KB is loaded once and passed in"
  - "Skip n8n fetch when --local AND no --token to avoid requiring network in offline/CI mode"
  - "All three tasks (scaffold + scorer + n8n/writer) written in one pass — same file, single commit"

patterns-established:
  - "Pattern: score_sample() returns dict of FIELDS with present/noise_free/n — delta scripts subtract two such dicts"
  - "Pattern: check_*(msg) returns {present:bool, noise:bool} — uniform interface for all 7 field checkers"

requirements-completed:
  - AUDIT-02
  - AUDIT-03

# Metrics
duration: 10min
completed: 2026-05-25
---

# Phase 10 Plan 01: Audit Baseline Summary

**Automated per-field accuracy script: 7 detection fields (ФИО/ИНН/телефон/артикул/бренд/кол-во/название товара) measured with present% + noise_free% against Клиент-class emails, persisted to scripts/baselines/baseline_v1.json**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-25T20:19:39Z
- **Completed:** 2026-05-25T20:28:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `scripts/audit_baseline.py` (300+ lines, stdlib only): deterministic 7-field scorer + ghost-brand KB check + n8n feedback fetch + atomic JSON baseline writer
- `scripts/baselines/baseline_v1.json` produced: version=1, all 7 fields, n8n_signal, raw_message_ids for reproducible deltas
- Script works offline via `--local` (CI-safe smoke) and live via no-flag mode; determinism verified across two identical runs
- Sample baseline metrics on 30 Клиент emails: fio 93%, inn 70%/67%, phone 70%, article 60%, brand 70%/67%, qty 40%/20%, product_name 57%

## Task Commits

All three tasks written in one pass to a single file (no partial file existed):

1. **Task 1: CLI scaffold + message loader** - `b691cd9` (feat)
2. **Task 2: 7-field scorer + KB ghost-brand check** - `b691cd9` (feat)
3. **Task 3: n8n feedback fetch + JSON persistence** - `b691cd9` (feat)

## Files Created/Modified

- `scripts/audit_baseline.py` — 7-field baseline script covering AUDIT-02 + AUDIT-03
- `scripts/baselines/baseline_v1.json` — persisted baseline (30-email smoke; re-run with --limit 300 against live prod for canonical baseline)
- `scripts/baselines/baseline_run1.json` / `baseline_run2.json` — determinism test artefacts (can be deleted)

## Decisions Made

- `scripts/baselines/` chosen over `data/` so baseline is committed to git (required for cross-session delta comparisons)
- All three tasks done in one Write pass — no intermediate partial file existed, so a single atomic commit was appropriate
- `is_brand_grounded()` refactored from closure (using module-level KB vars) to explicit parameter passing — KB loaded once in `main()` and passed to all callers
- n8n fetch skipped automatically when `--local` and no `--token` (offline mode); explicit `--skip-n8n` also available

## Deviations from Plan

None - plan executed exactly as written. The script was created in a single Write pass covering all three tasks rather than three incremental edits, but this is an implementation detail that does not change the delivered artefacts.

## Issues Encountered

None. Local snapshot auto-pick resolved to `data/prod-messages-local-postAudit2.json` (newest by mtime, 2041 msgs / 1657 Клиент). KB loaded from `data/detection-kb.sqlite` successfully.

Python `datetime.utcnow()` deprecation warning (Python 3.14) is informational only — does not affect output correctness.

## Known Stubs

None. `baseline_v1.json` was written with real data (30-email smoke). For canonical Phase 10 baseline, re-run:
```
python scripts/audit_baseline.py --local --limit 300 --out scripts/baselines/baseline_v1.json
```
or with live prod (add `--token` or omit `--local`).

## User Setup Required

None - runs offline with `--local`. For live mode, admin credentials are embedded in script constants (same as all other audit scripts in this project).

## Next Phase Readiness

- Phase 10 Plan 02 (audit_sample_50.py for AUDIT-01 manual audit) can start immediately
- Phase 10 Plan 03 (live prod run + delta verification) requires live API access
- Phases 11-14 can use `baseline_v1.json` as delta reference once the canonical 300-email run completes

---
*Phase: 10-audit-baseline*
*Completed: 2026-05-25*
