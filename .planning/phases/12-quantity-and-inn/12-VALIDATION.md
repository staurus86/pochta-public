---
phase: 12
slug: quantity-and-inn
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test + node:assert (no external framework) |
| **Config file** | none — built-in Node.js test runner |
| **Quick run command** | `node tests/batch-12-fixes.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node tests/batch-12-fixes.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green (148 existing + new tests)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | ART-04 | unit | `node tests/batch-12-fixes.test.js` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | ART-04 | unit | `node tests/batch-12-fixes.test.js` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | CONTACT-02 | unit | `node tests/batch-12-fixes.test.js` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | CONTACT-02 | unit | `node tests/batch-12-fixes.test.js` | ❌ W0 | ⬜ pending |
| 12-03-01 | 03 | 2 | CONTACT-01 | integration | `node tests/batch-12-fixes.test.js` | ❌ W0 | ⬜ pending |
| 12-03-02 | 03 | 2 | AUDIT | manual | `python scripts/audit_baseline.py --local --limit 300` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/batch-12-fixes.test.js` — стубы для ART-04 (Belgormash case) и CONTACT-02 (INN checksum)

*Existing infrastructure (npm test → node:test) covers framework. Only test file needs to be created.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Audit baseline delta | AUDIT (SC-4) | Требует live production data | `python scripts/audit_baseline.py --local --limit 300`, сравнить с baseline_v1.json |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
