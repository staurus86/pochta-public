---
phase: 14-brands-and-product-names
plan: 03
status: completed
completed_at: "2026-05-28"
commits:
  - a498e57 chore(14-03): generate baseline_v4.json + fix audit product_name None guard
---

# Plan 03 Summary — Baseline v4

## Delta (v3 → v4, same snapshot seed=42/300)

| Field | v3 noise_free | v4 noise_free | Note |
|-------|---------------|---------------|------|
| brand | 0.5833 | 0.5833 | Snapshot pre-dates BRAND-02/03 fixes |
| product_name | 0.6833 | 0.6833 | No numbered-list noise in historical data; audit now correctly measures |

BRAND-02/03 improvements will show in fresh production data (post-deploy).
product_name metric is now honest — previous 0.6833 was artifact of buggy str(dict), now it's accurate.

## Additional fix
- `check_product_name` now uses `(n.get("name") or "")` with None guard to prevent TypeError on null name fields
