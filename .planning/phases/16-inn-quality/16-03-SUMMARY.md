---
phase: 16-inn-quality
plan: 03
status: completed
completed_at: "2026-05-28"
commits:
  - b17414e feat(16-03): add auto-learn INN to reanalysis batch loop (Fix D)
  - 0574fff feat(16): capture baseline_v7 — inn.present 34.7%→45.7% (+11pp)
---

# Plan 03 Summary — Deploy + Reanalysis + baseline_v7

## What Was Done

1. **Discovered**: Fix D (auto-learn to company_directory) was wired ONLY to `/analyze` endpoint, not to the batch `/reanalyze` loop. This is why the first baseline_v7 snapshot (captured at 16:47 UTC, before this plan) showed 34.7% = unchanged.

2. **Fixed**: Added auto-learn block to the reanalysis loop in both `src/server.js` and `.railway-deploy/src/server.js` (commit b17414e). Same guard logic as the `/analyze` endpoint.

3. **3-pass reanalysis**:
   - Pass 1: builds company_directory incrementally as emails are processed (later emails in batch benefit from earlier ones)
   - Pass 2: all emails benefit from company_directory populated by pass 1
   - Pass 3: convergence check — same result as pass 2

4. **baseline_v7 captured** after pass 3 convergence.

## Results

| Field | v6 (baseline) | v7 (post-Phase 16) | Delta |
|-------|-------------|-------------------|-------|
| fio | 87.7% | 87.7% | +0.0pp |
| **inn** | **34.7%** | **45.7%** | **+11.0pp** |
| phone | 75.7% | 75.7% | +0.0pp |
| article | 78.7% | 78.7% | +0.0pp |
| brand | 60.0% | 60.0% | +0.0pp |
| qty | 41.3% | 41.3% | +0.0pp |
| positions | 78.7% | 78.7% | +0.0pp |
| product_name | 71.0% | 71.0% | +0.0pp |

**Target gate: inn.present ≥ 50% — FAIL (45.7%, gap 4.3pp)**

## Analysis of Remaining Gap

The research estimated +14–19pp from Fix D. We achieved +11pp. The 3–8pp shortfall is explained by:

1. **Order-dependency in single-pass reanalysis**: Pass 1 populates company_directory incrementally — emails processed *before* the INN-bearing email from their domain don't benefit. Pass 2 closes most of this gap, but some domains may have ALL their emails without INN (no INN-bearing email to seed from).

2. **No cross-project domain sharing**: project-3 and project-4 are reanalyzed independently. A domain that appears in project-3 with INN but in project-4 without INN won't benefit unless the domain entry was seeded from project-3 first.

3. **Company_directory UNIQUE(email) constraint**: Auto-learn writes per-email entries only (not per-domain). Emails from the same domain but different email addresses don't benefit unless each individual email has been seeded.

4. **Corpus ceiling**: ~35% of Клиент emails have genuinely no INN-bearing sibling in the corpus. No further improvement is possible without OCR for scanned PDFs or new email ingestion.

## Convergence Proof

| Pass | inn.present | Delta from prior |
|------|------------|-----------------|
| v6 baseline | 34.7% | — |
| Post-deploy (no fix D in reanalyze) | 34.7% | +0.0pp |
| Pass 1 (first auto-learn in reanalyze loop) | 45.7% | +11.0pp |
| Pass 2 | 45.7% | +0.0pp |
| Pass 3 | 45.7% | +0.0pp |

Metric is converged. Additional reanalysis passes will not improve it.

## What Would Reach 50%

The 4.3pp gap (~13 more INNs in 300-sample) could come from:
- **Domain-level auto-learning**: currently only per-email; adding domain-level upsert would cover cross-email-address cases within same domain (~est. +2pp)
- **New email ingestion**: as new Клиент emails arrive with INN, they'll auto-seed company_directory for future lookups
- **OCR for scanned PDFs**: 44 skipped PDFs — partial recovery possible

## Deployment

- GitHub: pushed to main (commits b17414e, 0574fff)
- Railway: auto-deployed, health check confirmed 200
- Reanalysis: 3 passes total (project-3: 142/252; project-4: 1835/2245)
