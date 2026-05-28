---
phase: 11
slug: article-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-26
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js `node:test` + `node:assert` (built-in) |
| **Config file** | None — `node --test` directly |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (Node tests); ~120 seconds (audit_baseline.py --local) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test` + `python scripts/audit_baseline.py --local --limit 300`
- **Before `/gsd:verify-work`:** Full suite must be green + audit article.present >= 75.7%
- **Max feedback latency:** ~10 seconds (Node), ~120 seconds (audit --local)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | ART-02 | unit | `npm test` (uuid test) | ❌ Wave 0 | ⬜ pending |
| 11-02-01 | 02 | 1 | ART-01 | unit | `npm test` (sig test) | ❌ Wave 0 | ⬜ pending |
| 11-03-01 | 03 | 2 | ART-01 | smoke | `npm test` | ✅ | ⬜ pending |
| 11-03-02 | 03 | 2 | ART-01 | live | `python scripts/audit_baseline.py --local --limit 300` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/article-extractor.test.js` — add UUID rejection test (ART-02) + signature hard-exclude test (ART-01)

*Existing Node.js test infrastructure covers all other phase requirements — `npm test` is already wired.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `article.present%` >= 75.7% after wiring | ART-01 | Statistical gate — requires live prod data | Run `python scripts/audit_baseline.py --local --limit 300`, verify `article.present >= 0.757` in output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (article-extractor.test.js new tests)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (audit --local) / 10s (npm test)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
