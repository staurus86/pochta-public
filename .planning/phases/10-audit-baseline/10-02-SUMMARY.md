---
phase: 10-audit-baseline
plan: 02
subsystem: audit-scripts
tags: [audit, python, sampling, json-report, AUDIT-01]
dependency_graph:
  requires: []
  provides: [scripts/audit_sample_50.py, data/audit_sample_50_report.json]
  affects: []
tech_stack:
  added: []
  patterns: [deterministic-sampling, per-field-noise-heuristics, atomic-json-write]
key_files:
  created:
    - scripts/audit_sample_50.py
  modified: []
decisions:
  - "Implemented Task 1 and Task 2 in a single file commit — scaffold and scoring are tightly coupled in one 480-line module"
  - "Copied is_brand_grounded verbatim from audit_prod_json.py to keep scripts fully standalone (Karpathy Rule 2: simplicity)"
  - "Used datetime.datetime.utcnow() despite deprecation warning — stdlib only, no third-party deps allowed"
metrics:
  duration_seconds: 152
  completed_date: "2026-05-25"
  tasks_completed: 2
  files_created: 1
  files_modified: 0
---

# Phase 10 Plan 02: audit_sample_50.py — Structured 50-Email Audit Report Summary

**One-liner:** Deterministic 50-email per-field JSON audit report producer using seed=42 sampling and 7-field noise heuristics for AUDIT-01.

## What Was Built

`scripts/audit_sample_50.py` (480 lines) — a standalone Python script that:

1. Loads messages from live production API or local `data/prod-messages-*.json` snapshot
2. Filters to `classification.label == 'Клиент'` before sampling
3. Samples exactly 50 emails deterministically via `random.seed(42)`
4. Runs 7-field correctness heuristics (fio, inn, phone, article, brand, qty, product_name)
5. Writes `data/audit_sample_50_report.json` with one row per email containing `{value, present, noise, noise_reasons[]}`
6. Prints per-field noise summary to stdout

### Report schema

```json
{
  "version": 1,
  "created_at": "2026-05-25T...Z",
  "sample_size": 50,
  "sample_seed": 42,
  "source": "local:data/prod-messages-p4.json",
  "rows": [...],
  "reviewer_notes": ""
}
```

Each row has `project_id`, `message_key`, `subject`, `from`, `classification_confidence`, 7 `fields`, and `reviewer_notes: ""`.

## Verification Results

- `python scripts/audit_sample_50.py --help` exits 0, lists all 6 flags
- `python scripts/audit_sample_50.py --local --limit 50` exits 0, writes 50-row JSON
- JSON validates: `version==1`, `sample_seed==42`, all 7 field keys present, `reviewer_notes` at both top-level and per-row
- Determinism: two runs with same seed produce identical `message_key` lists (verified)
- 480 lines (minimum required: 200)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 + Task 2 | 285e209 | feat(10-02): add audit_sample_50.py scaffold with CLI, loader, Клиент sampling, 7-field row builders, JSON report writer |

## Deviations from Plan

**1. Tasks 1 and 2 combined into single commit**
- The plan describes Task 1 (scaffold) and Task 2 (row builders) as sequential steps
- Both tasks target the same file (`scripts/audit_sample_50.py`) and the row builder logic depends on the scaffold
- Combined into one complete implementation and one commit — all acceptance criteria for both tasks satisfied

No bugs, no architectural changes, no blockers encountered.

## Known Stubs

None. The script is fully functional: it loads real data, runs real heuristics, and writes a reviewer-ready JSON file. The `reviewer_notes` fields are intentionally empty — they are placeholders for human annotation.

## Self-Check: PASSED

- `scripts/audit_sample_50.py` exists: FOUND
- Commit `285e209` exists: FOUND
- `data/audit_sample_50_report.json` generated successfully with 50 rows
- All acceptance criteria from both tasks: PASS
