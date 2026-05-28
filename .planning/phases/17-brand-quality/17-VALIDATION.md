---
phase: 17
slug: brand-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` + `node:assert/strict` |
| **Config file** | none — direct `node` invocation |
| **Quick run command** | `node tests/batch-17-brand-fixes.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node tests/batch-17-brand-fixes.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | BRAND-05 | unit | `node tests/batch-17-brand-fixes.test.js` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | BRAND-05 | unit | `node tests/batch-17-brand-fixes.test.js` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | BRAND-05 | unit | `node tests/batch-17-brand-fixes.test.js` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 2 | BRAND-06 | script | `python -c "import ast, sys; src=open('scripts/audit_baseline.py', encoding='utf-8').read(); ast.parse(src); assert 'msg.get(\"body\") or body_preview' in src; print('OK')"` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/batch-17-brand-fixes.test.js` — regression tests for GHOST-1..5 brand patterns

*Existing infrastructure (`npm test` = node:test runner) covers all other needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| baseline_v7 brand.noise_free ≥ 55% after deploy+reanalysis | BRAND-06 | Requires live prod reanalysis + audit script | Run `python scripts/audit_baseline.py --token $TOKEN --limit 300 --seed 42 --skip-n8n --out scripts/baselines/baseline_v8.json` after reanalysis, then `python -c "import json; b=json.load(open('scripts/baselines/baseline_v8.json', encoding='utf-8'))['fields']['brand']['noise_free']; assert b >= 0.55, b"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
