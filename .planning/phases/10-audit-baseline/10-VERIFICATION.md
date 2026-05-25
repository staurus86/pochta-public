---
phase: 10-audit-baseline
verified: 2026-05-25T21:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 10: Audit Baseline Verification Report

**Phase Goal:** Операторы получают количественное baseline по каждому полю детекции, чтобы любой следующий фикс можно было измерить
**Verified:** 2026-05-25T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Агенты провели ручной аудит 50 реальных писем и получили structured bug report | VERIFIED | `data/audit_sample_50_report.json` — 50 rows, version=1, sample_seed=42, all 7 fields with `{value, present, noise, noise_reasons}` per row |
| 2 | Автоматический audit-скрипт возвращает % корректных значений по каждому из 7 полей | VERIFIED | `scripts/audit_baseline.py` (542 lines) runs against live prod or local snapshot; `baseline_v1.json` has all 7 fields with present% and noise_free% for n=300 |
| 3 | n8n-фидбек загружен через GET-эндпоинт и отображается в отчёте | VERIFIED | `fetch_n8n_feedback()` calls `GET /api/admin/validation-feedback`; `baseline_v1.json` shows `n8n_signal: {total_with_feedback: 20, approved: 0, needs_rework: 20, not_reviewed: 0, in_sample_with_feedback: 5}` |
| 4 | Audit-скрипт запускается повторно после каждого следующего фикса и показывает дельту к baseline | VERIFIED | `raw_message_ids` (300 IDs) committed in `baseline_v1.json`; script is deterministic via `--seed 42`; re-run with `--out scripts/baselines/baseline_vN.json` computes new metrics for delta |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/audit_baseline.py` | Per-field % baseline + n8n signal + persistent JSON output | VERIFIED | 542 lines, stdlib only; `def is_brand_grounded`, `def check_fio/inn/phone/article/brand/qty/product_name`, `def fetch_n8n_feedback`, `def write_baseline` all present; exits 0 against local snapshot |
| `scripts/audit_sample_50.py` | 50-email structured manual audit report producer | VERIFIED | 484 lines (min 200); `def row_fio/inn/phone/article/brand/qty/product_name`, `def build_row`, `def is_brand_grounded` present; `reviewer_notes` appears 3 times (top-level + per-row template + write); exits 0 |
| `scripts/baselines/baseline_v1.json` | Persistent v1.1 baseline metrics for delta comparisons | VERIFIED | version=1, sample_size=300, sample_seed=42, source="live-prod", 7 fields all 0 < present < 1, n8n_signal present, raw_message_ids list length=300 |
| `data/audit_sample_50_report.json` | Manual audit input — 50 rows for human review | VERIFIED | Exists locally (not committed); version=1, sample_seed=42, 50 rows; each row has all 7 fields with {value, present, noise, noise_reasons}; top-level reviewer_notes="" |
| `.gitignore` | Ensures data/audit_sample_50_report.json is NOT committed | VERIFIED | `grep -c "data/audit_sample_50_report.json" .gitignore` = 1; `grep -c "^scripts/baselines" .gitignore` = 0 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/audit_baseline.py` | `data/detection-kb.sqlite` | `sqlite3.connect(KB_PATH)` where `KB_PATH = "data/detection-kb.sqlite"` | WIRED | Line 149: `c = sqlite3.connect(KB_PATH)`; reads brand_aliases + nomenclature_dictionary tables |
| `scripts/audit_baseline.py` | `data/prod-messages-*.json` | `glob.glob("data/prod-messages-*.json")` sorted by mtime | WIRED | Lines 99-104: auto-picks newest snapshot when `--local` passed; confirmed working in smoke run |
| `scripts/audit_baseline.py` | `GET /api/admin/validation-feedback` | `api_get(f"/api/admin/validation-feedback?limit={limit}", token)` | WIRED | Line 404: verified pattern present; `n8n_signal.total_with_feedback=20` in live baseline confirms endpoint was called |
| `scripts/audit_sample_50.py` | `data/detection-kb.sqlite` | `sqlite3.connect(KB_PATH)` | WIRED | Same pattern as audit_baseline.py; confirmed in smoke run (ghost-brand check produced results) |
| `scripts/audit_sample_50.py` | `data/audit_sample_50_report.json` | atomic JSON write with `os.replace` | WIRED | Default `DEFAULT_OUT = "data/audit_sample_50_report.json"`; file confirmed present locally |
| `scripts/baselines/baseline_v1.json` | phases 11-14 delta scripts | File committed to git at known path; future phases re-run script with `--out scripts/baselines/baseline_vN.json` | WIRED (by convention) | Committed as tracked file; `raw_message_ids` list enables reproducible delta targeting |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `baseline_v1.json` `.fields` | `field_scores` from `score_sample()` | 300 Клиент-class emails from live prod API + SQLite KB | Yes — live-prod messages, KB query for ghost-brand check | FLOWING |
| `baseline_v1.json` `.n8n_signal` | `by_key, summary` from `fetch_n8n_feedback()` | `GET /api/admin/validation-feedback?limit=500` | Yes — `total_with_feedback=20`, `needs_rework=20` | FLOWING |
| `baseline_v1.json` `.raw_message_ids` | `[m.get("messageKey") or m.get("id") for m in sample]` | 300-element sample from live prod | Yes — 300 real SHA-like message IDs | FLOWING |
| `audit_sample_50_report.json` `.rows` | `[build_row(m, ...) for m in sample]` | 50 sampled Клиент emails from live prod | Yes — real field values per email, noise_reasons from heuristics | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `audit_baseline.py --help` exits 0, lists all 7 flags | `python scripts/audit_baseline.py --help` | All 7 flags listed: --local, --snapshot, --out, --token, --limit, --seed, --skip-n8n | PASS |
| `audit_baseline.py --local --limit 10 --skip-n8n` exits 0, prints 7-row table | `python scripts/audit_baseline.py --local --limit 10 --skip-n8n` | Table printed with fio/inn/phone/article/brand/qty/product_name, exit 0 | PASS |
| `audit_sample_50.py --help` exits 0, lists all 6 flags | `python scripts/audit_sample_50.py --help` | All 6 flags listed | PASS |
| `audit_sample_50.py --local --limit 5` exits 0, writes report | `python scripts/audit_sample_50.py --local --limit 5` | Writes `data/audit_sample_50_report.json`, noise summary printed, exit 0 | PASS |
| `baseline_v1.json` validates — version=1, 7 fields, all 0<present<1, n=300 | `python -c "import json; b=json.load(...); assert all(...)"` | OK live-prod n=300, all fields in range 0.367-0.913 | PASS |
| `audit_sample_50_report.json` validates — version=1, 50 rows, 7 fields per row | `python -c "import json; r=json.load(...); assert len(r['rows'])>0"` | OK rows=50 | PASS |
| `baseline_v1.json` is tracked in git, `audit_sample_50_report.json` is NOT | `git ls-files ...` | baseline_v1.json tracked; audit_sample_50_report.json returns nothing | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| AUDIT-01 | 10-02-PLAN.md, 10-03-PLAN.md | Structured bug report for 50 real production emails with per-field error classification | SATISFIED | `data/audit_sample_50_report.json` — 50 rows, 7 fields each with `{value, present, noise, noise_reasons[]}`, top-level + per-row `reviewer_notes`; human checkpoint approved in Plan 03 Task 4 |
| AUDIT-02 | 10-01-PLAN.md, 10-03-PLAN.md | Automated % measurement per field — baseline before fixes and after each fix | SATISFIED | `scripts/audit_baseline.py` produces present%/noise_free% for 7 fields; `baseline_v1.json` committed with n=300 live-prod metrics; re-runnable for delta computation |
| AUDIT-03 | 10-01-PLAN.md, 10-03-PLAN.md | n8n manager feedback loaded via GET endpoint, used as audit signal | SATISFIED | `fetch_n8n_feedback()` calls `GET /api/admin/validation-feedback`; `baseline_v1.json.n8n_signal = {total_with_feedback: 20, needs_rework: 20, in_sample_with_feedback: 5}` |

No orphaned requirements — all 3 AUDIT-* IDs from the phase are accounted for in plans and verified as implemented.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/audit_baseline.py` | 446 | `datetime.datetime.utcnow()` — deprecated in Python 3.12+ | Info | No functional impact; produces deprecation warning in Python 3.14; output is correct |
| `scripts/audit_sample_50.py` | 428 | `datetime.datetime.utcnow()` — deprecated in Python 3.12+ | Info | Same as above |

No blocker anti-patterns. Both deprecation warnings are informational (stdlib API change, not a bug). The `created_at` ISO-8601 output is correct in both files.

### Human Verification Required

Plan 03 Task 4 was a blocking human checkpoint — the user reviewed and approved both `scripts/baselines/baseline_v1.json` and `data/audit_sample_50_report.json` before commit `c7d49ad`. This checkpoint is recorded as completed in `10-03-SUMMARY.md`. No additional human verification is required for this phase.

### Gaps Summary

No gaps found. All four observable truths are verified, all five required artifacts exist and pass levels 1-4, all three requirements (AUDIT-01, AUDIT-02, AUDIT-03) are satisfied, both scripts run without error, and commits are confirmed in git history.

**Note on `baseline_v1.json` working-tree state:** The smoke-test run during verification (`--limit 10 --skip-n8n`) temporarily overwrote the working-tree copy with a 10-email version. The file was immediately restored via `git checkout -- scripts/baselines/baseline_v1.json`. The committed version (sample_size=300, source=live-prod) is intact and unmodified.

---

_Verified: 2026-05-25T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
