---
phase: 18-qty-quality
plan: 02
status: completed
completed_at: "2026-05-29"
deploy:
  commit_sha: "8767dc52ec79b6f619cdb90e9135e0a93c7f1101"
  status: SUCCESS
  health: 200 OK
reanalysis:
  project_3: "done (252 messages)"
  project_4: "done (2245 messages)"
baseline_v9:
  qty_present: 0.46
  qty_noise_free: 0.46
  n: 300
  seed: 42
  target_met: true
  target: 0.30
---

# Phase 18 Plan 02 — SUMMARY

## Deploy

- Commit SHA: `8767dc5` (4 commits from Plan 01)
- Railway: `SUCCESS`, builder RAILPACK, health `/railway-health` → 200
- Checkpoint approved by user before reanalysis

## Reanalysis

- `project-3-mailbox-file`: 252 messages — done
- `project-4-klvrt-mail`: 2245 messages — done
- Total: 2497 messages reanalyzed with new `quantity-extractor.js`

## Baseline v9 Results

```
Field        | present%  | noise_free%
-------------|-----------|------------
fio          |   87.7%   |   87.7%
inn          |   45.7%   |   45.7%
phone        |   75.7%   |   75.7%
article      |   78.7%   |   77.7%
brand        |   60.0%   |   46.0%
qty          |   46.0%   |   46.0%   ← TARGET MET
positions    |   78.7%   |   53.3%
product_name |   71.0%   |   71.0%
```

## Delta: baseline_v8 → baseline_v9

| Metric | v8 | v9 | Delta |
|--------|----|----|-------|
| qty.present | 41.3% | 46.0% | +4.7pp |
| qty.noise_free | 4.0% | 46.0% | **+42.0pp** |

Target: ≥30% → **PASS** (46.0%)

## What drove the improvement

**+42pp noise_free** comes from two independent changes:

1. **check_qty v2 metric** (~37pp): The dominant factor. Re-defines "noise" — absence of qty is no longer noise. 75 genuine no-qty emails stopped being penalised. Under v2, noise only fires when qty IS extracted but is >10000 unlabeled.

2. **QTY-1 multiline_table scanner** (~5pp): Recovers 13–14 HTML-table-rendered emails where number and unit were on separate lines. `qty.present` rose from 41.3% to 46.0% — the 4.7pp gap is the extractor fix contribution.

3. **QTY-2 bold strip** (<1pp): 1 Outlook-bold-wrapped email. Negligible on aggregate metric.

## Noise_free = Present (zero noisy messages)

Under the v2 metric, `noise_free == present` (both 46.0%) because:
- Messages with articles but no qty → `present=False, noise=False` (not penalised)
- Messages with articles AND valid qty → `present=True, noise=False` (clean)
- Messages with articles AND outlier qty (>10000) → would be `noise=True`, but none in sample

## Phase 18 Success Criteria

| Criterion | Status |
|-----------|--------|
| QTY-1 multiline_table scanner | ✅ 10/10 tests pass |
| QTY-2 bold strip | ✅ included in test suite |
| check_qty v2 metric | ✅ deployed + verified |
| qty.noise_free ≥ 30% | ✅ 46.0% |
| Mirror to .railway-deploy | ✅ MIRROR_OK |
| No regression in 32 existing tests | ✅ 39/39 new+existing pass |
