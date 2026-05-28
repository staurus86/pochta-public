---
phase: 10
slug: audit-baseline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js `node:test` + `node:assert` (built-in) for Node tests; Python smoke runs for audit scripts |
| **Config file** | None — `node --test` directly |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (Node tests); ~60-120 seconds (live Python audit scripts) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test` + live Python script smoke run
- **Before `/gsd:verify-work`:** Full suite must be green + `data/baseline_v1.json` must exist with all 7 field metrics
- **Max feedback latency:** ~10 seconds (Node), ~120 seconds (live audit run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | AUDIT-02 | smoke | `python scripts/audit_baseline.py --local` | ❌ Wave 0 | ⬜ pending |
| 10-01-02 | 01 | 1 | AUDIT-03 | smoke | included in audit_baseline.py | ❌ Wave 0 | ⬜ pending |
| 10-02-01 | 02 | 2 | AUDIT-01 | smoke | `python scripts/audit_sample_50.py --local` | ❌ Wave 0 | ⬜ pending |
| 10-03-01 | 03 | 3 | AUDIT-02 | live | `python scripts/audit_baseline.py` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/audit_baseline.py` — new script covering AUDIT-02 + AUDIT-03 (per-field % + n8n signal + baseline_v1.json)
- [ ] `scripts/audit_sample_50.py` — new script covering AUDIT-01 (50-email structured bug report)

*Existing Node.js tests pass (`npm test`) — no new Node unit tests needed for this phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 50-email bug report reviewed and annotations added | AUDIT-01 | Requires human judgment to confirm whether detected values are correct | Run `python scripts/audit_sample_50.py`, review JSON output, add `reviewer_notes` field |
| baseline_v1.json field metrics look reasonable | AUDIT-02 | Statistical plausibility check (e.g., ФИО present % should be ~72%, not 2%) | Open `data/baseline_v1.json` or `scripts/baselines/baseline_v1.json`, verify field values in expected ranges |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`audit_baseline.py`, `audit_sample_50.py`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (live run) / 10s (local snapshot mode)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
