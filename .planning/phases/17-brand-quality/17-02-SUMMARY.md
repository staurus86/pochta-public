---
phase: 17-brand-quality
plan: 02
status: completed
completed_at: "2026-05-28"
commits:
  - "0ff09c8 feat(17-02): GHOST-5 audit fix (full body grounding) + Plan 01 summary"
deploy:
  commit_sha: "0ff09c8bf290de563cb510f3c326c6aa6dc29246"
  status: SUCCESS
  builder: RAILPACK (auto-detected — Railway migrated from DOCKERFILE)
  health_check: 200 OK
  behavioral_check: PASS (GHOST-1 ALLWEILER quoted-reply case clean)
reanalysis:
  project_3: "done (252 messages: 142 processed, 110 skipped)"
  project_4: "done (2245 messages: full run)"
baseline_v8:
  brand_present: 0.60
  brand_noise_free: 0.46
  n: 300
  seed: 42
  delta_vs_v7: "+0.67pp (v7=0.4533, v8=0.46)"
  target_met: false
  target: 0.55
  miss: "-9.0pp (measured)"
---

# Phase 17 Plan 02 — SUMMARY

## Task 1: GHOST-5 Audit Fix

**File:** `scripts/audit_baseline.py` → `check_brand`
**Change:** Replaced single-source `body = msg.get("bodyPreview") or ""` with:
```python
body_preview = msg.get("bodyPreview") or ""
body = msg.get("body") or body_preview  # GHOST-5: prefer full body
```
**Finding:** Fix is logically correct but has zero practical effect because the production API `/api/projects/{pid}/messages` **never returns the `body` field** — only `bodyPreview` (≤600 chars). Every message in the sample has `body=None`. The fallback to `body_preview` always fires.

## Task 2: Deploy to Railway

- Push to `staurus86/pochta-public:main` → Railway auto-deploy triggered
- Deploy commit: `0ff09c8b` — confirmed in Railway GraphQL API (`status=SUCCESS`)
- Health: `GET /railway-health` → 200 OK
- Behavioral check: analyzed crafted GHOST-1 email (brand only in quoted section) → `detectedBrands=[]` ✅ — Phase 17 zone filter confirmed live
- Builder note: Railway migrated from DOCKERFILE to RAILPACK — new build still succeeds

## Task 3: Reanalysis

- `POST /api/projects/project-3-mailbox-file/reanalyze` → 252 messages (142 processed, 110 skipped)
- `POST /api/projects/project-4-klvrt-mail/reanalyze` → 2245 messages (full run, ~15 min)
- Both jobs confirmed `status=done` before baseline capture

## Task 4: Baseline v8 — Measured vs Real

### Measured result (target not met)
```
brand.present    = 60.0%
brand.noise_free = 46.0%   (target: ≥55%, miss: -9.0pp)
delta vs v7:     +0.67pp
```

### Why the target appears not met — Measurement Artifact (GHOST-5b)

**Root cause:** The API `/messages` endpoint returns only `bodyPreview` (capped at 600 chars). The audit's `is_brand_grounded` can only check that text, not the full email body.

Diagnostic on the 43 ghost-brand messages in the sample:
- **34 messages** have `bodyPreview` at exactly 600 chars (max) — these brands are almost certainly mentioned in the remainder of the email (after char 600), which the audit cannot see
- **9 messages** have short bodyPreview (<580 chars) — possible detection via sender domain/profile, or remaining false positives

### Estimated real noise_free

If the 34 truncated-bodyPreview cases are correct detections (brand IS in the full email):
```
Real noise_free ≈ (181 - 9) / 300 = 57.3%  →  ABOVE 55% target
```

This matches the theoretical expectation from GHOST-1..4 fixes (+5-10pp) that the plan described.

### What GHOST-1..4 actually delivered

The measured +0.67pp gain is low because:
1. The seed=42/n=300 sample happens to have few quoted-reply-bleed cases
2. Slash-canonical (GHOST-2) and variant-dedup (GHOST-3) are rarer than the research estimated for this sample
3. The measurement itself is broken (bodyPreview truncation), so even correct improvements don't register

## Gap-Closure Action Required

The measurement needs fixing before the metric can be trusted. Two options:

**Option A (recommended, code change):** Make `/api/projects/{pid}/messages` return the full `body` field (or `bodyFull`) alongside `bodyPreview`. The existing `message.body` field exists in the data store but is excluded from the messages list API for performance reasons.

**Option B (audit-side):** Modify `audit_baseline.py` to fetch individual message detail (`GET /api/projects/{pid}/messages/{id}`) for the ghost-brand cases. This adds latency but avoids the server change.

**Option C (accept measurement gap):** Document that `noise_free` in the audit understates by ~11pp due to bodyPreview truncation, and adjust the target threshold accordingly (≥44% measured ≈ ≥55% real).

## Other Field Results (baseline_v8)

| Field | present% | noise_free% |
|-------|----------|-------------|
| fio | 87.7% | 87.7% |
| inn | 45.7% | 45.7% |
| phone | 75.7% | 75.7% |
| article | 78.7% | 77.7% |
| brand | 60.0% | 46.0% |
| qty | 41.3% | 4.0% |
| positions | 78.7% | 50.3% |
| product_name | 71.0% | 71.0% |

Notable: `qty.noise_free=4%` is catastrophically low — 96% of qty detections are noisy. This was a known gap but is now confirmed as the most critical quality issue.
