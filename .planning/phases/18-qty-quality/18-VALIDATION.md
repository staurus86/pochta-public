---
phase: 18-qty-quality
created: 2026-05-28
type: validation-strategy
---

# Phase 18 — Validation Strategy

## What We Are Testing

Phase 18 introduces two code fixes and one metric redefinition:

| Fix | File | Pattern | Impact |
|-----|------|---------|--------|
| QTY-1: HTML table split | quantity-extractor.js | Standalone number + standalone unit within 2 lines | 13/112 noise messages recovered |
| QTY-2: Bold Outlook markers | quantity-extractor.js | Strip `*` before parsing, enabling `*10****шт.*` → 10 | 1/112 noise messages recovered |
| QTY-3: Metric redefinition | audit_baseline.py check_qty | "No qty in email" is NOT noise; only outlier qty is | 75/112 no-longer-penalised |

---

## Test File Structure

### New: `tests/batch-18-qty-fixes.test.js`

**Purpose:** Regression tests for QTY-1 and QTY-2. Written BEFORE implementation (TDD RED phase), then made to pass GREEN.

| Test | Covers | Expected |
|------|--------|---------|
| QTY-1 distance=1 (number then unit) | `"10\nшт"` | items contains source="multiline_table", value=10 |
| QTY-1 distance=2 (number, blank, unit) | `"10\n\nшт"` | items contains source="multiline_table", value=10 |
| QTY-1 unit-first distance=1 | `"шт\n10"` | items contains source="multiline_table", value=10 |
| QTY-1 unit-first distance=2 | `"шт\n\n10"` | items contains source="multiline_table", value=10 |
| QTY-1 realistic HTML block | `"ДАТЧИК DSD 1820\n\n10\n\nшт"` | items contains source="multiline_table", value=10 |
| QTY-1 pcs variant | `"5\npcs"` | items contains source="multiline_table", value=5, unit="шт" |
| QTY-1 false-positive guard (distance=4) | `"100\n\n\n\nшт"` | NO multiline_table item (beyond 2-line window) |
| QTY-2 bold strip | `"*1**0****шт.*"` | items contains value=10 |
| QTY-2 regression guard (90 мм) | `"90 мм"` | primary === null |
| QTY-2 regression guard (Клапан шаровой 90 мм) | existing pattern | primary === null |

### Existing: `tests/quantity-extractor.test.js`

32 tests covering filters, normalizer, and extractor facade. These MUST NOT regress.
Run after every change to confirm zero new failures.

---

## Why These Test Cases

### QTY-1 Distance Variants
The scanner searches backward and forward up to 2 lines from a unit-only line. Tests at distance=1 and distance=2 confirm both positions. The false-positive guard at distance=4 confirms the window is respected.

### QTY-1 Unit-First
HTML tables may render as `шт\n\n10` (unit cell before value cell) depending on column order. Both orderings are tested.

### QTY-1 False-Positive Risk
The scanner uses `NUM_ONLY_RE = /^(\d+(?:[.,]\d+)?)$/` — it matches ONLY lines containing nothing but a number (and optional decimal). Section numbers like "2. Раздел" do NOT match (the period and text prevent it). This is a natural guard; no special test needed beyond the distance=4 window guard.

### QTY-2 Bold Strip Risk
Bold markers are stripped globally with `/\*+/g`. The risk is stripping legitimate content. In this corpus, `*` does not appear in Russian article codes or technical specs. Regression guard `"90 мм"` confirms the technical spec filter still works after the strip.

---

## Metric Validation Strategy

### check_qty v2 Logic

| Email state | v1 result | v2 result | Correct? |
|------------|-----------|-----------|---------|
| Has articles, no qty in email | present=False, noise=True | present=False, noise=False | v2 correct |
| Has articles, qty=5 шт extracted | present=True, noise=False | present=True, noise=False | same |
| Has articles, qty=50000 (unlabeled) | present=True, noise=False (was not caught!) | present=True, noise=True | v2 correct |
| No articles | present=False, noise=False | present=False, noise=False | same |

### Estimated Impact on noise_free_pct

| Scenario | noise_free_pct |
|---------|----------------|
| baseline_v8 (current) | 4.0% (12/300) |
| After QTY-1+2 code fixes only, old metric | ~8.3% (25/300) |
| After metric redefinition only, no code fix | ~40% (75 genuine no-qty stop being noise) |
| After all three (QTY-1 + QTY-2 + QTY-3) | ~40-46% (estimate) |

The ≥30% target (conservative) is expected to be met primarily by the metric redefinition.

### Manual Spot-Check (for human verifier)

After deploy and reanalysis, pick any 5 "noise" messages from baseline_v8 that were classified
as "genuine no-qty" (category A in the research). Verify that in baseline_v9 they are now
`noise=False` (not penalised).

Example query approach:
```python
# In a Python REPL after loading baseline_v9.json samples:
noise_msgs = [m for m in sample if check_qty(m)["noise"]]
# Should be far fewer than 112 (the v8 count)
```

---

## Non-Fixable Noise (Expected Residual)

The following categories will remain in noise even after Phase 18:

| Category | Count | Why not fixable in Phase 18 |
|---------|-------|---------------------------|
| Outlier qty values (>10000 unlabeled) | ~5 | Correctly flagged as noise by v2 |
| Tech spec rejection with no count | 0 | v2 metric does not penalise these |
| Genuine no-qty emails | 0 | v2 metric does not penalise these |

Under v2, the expected residual noise is only emails where an obviously wrong quantity was extracted — approximately 5-10 messages out of 300.

---

## Automated Verification Commands

```bash
# Before deploy (local):
node tests/quantity-extractor.test.js
node tests/batch-18-qty-fixes.test.js

# After deploy (production):
curl -s https://pochta-production.up.railway.app/railway-health

# After reanalysis:
python scripts/audit_baseline.py \
  --token "$TOKEN" \
  --limit 300 \
  --seed 42 \
  --skip-n8n \
  --out scripts/baselines/baseline_v9.json

# Check target:
python -c "
import json
b = json.load(open('scripts/baselines/baseline_v9.json'))
nf = b.get('fields', {}).get('qty', {}).get('noise_free_pct', 0)
print(f'qty.noise_free = {nf}%  |  target >= 30%  |  PASS' if nf >= 30 else f'FAIL  shortfall={round(30-nf,1)}pp')
"
```
