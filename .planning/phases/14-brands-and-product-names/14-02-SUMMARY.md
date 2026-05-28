---
phase: 14-brands-and-product-names
plan: 02
status: completed
completed_at: "2026-05-28"
commits:
  - 0719cbe feat(14-02): PROD-01/02 productNames fixes, PROD-02 HTML dedup, audit check_product_name fix
---

# Plan 02 Summary — PROD-01 + PROD-02 + audit fix

## PROD-01 — Numbered List Cleanup
- Existing inline cleanup (email-analyzer.js:1612-1618) already handles `" - N шт"` pattern
- Tests confirmed current behavior is correct — no code change needed
- 2 regression tests added to batch-14-fixes.test.js

## PROD-02 — HTML Dedup
- Added `stripHtmlResidue` import from `product-name-normalizer.js`
- `canonicalNameKey` now calls `stripHtmlResidue(String(s || ""))` as first step
- Prevents `<br>` / `&amp;` residue from creating different canonical keys

## Audit fix (check_product_name)
- Fixed `str(n)` → `(n.get("name") or "")` for each dict entry
- `NUMBERED_LIST_RE.match(n)` now receives actual name string, not Python `str(dict)` repr
- Result: product_name noise measurement now accurate (v4 shows 0.6833 — no numbered-list noise in historical data)
