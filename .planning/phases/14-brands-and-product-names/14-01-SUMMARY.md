---
phase: 14-brands-and-product-names
plan: 01
status: completed
completed_at: "2026-05-28"
commits:
  - 8c45225 test(14-01): add failing BRAND-02 subject-priority and BRAND-03 short-alias tests
  - c6954f6 feat(14-01): add subjectGroundedBrands exemption at P15/P18 gates (BRAND-02)
  - 82e8838 feat(14-01): add <=2-char alias guard in both detectBrands paths (BRAND-03)
  - 5f7806a chore(14-01): mirror BRAND-02/03 fixes to .railway-deploy
---

# Plan 01 Summary — BRAND-02 + BRAND-03

## BRAND-02 — Subject Priority

- Added `subjectGroundedBrands` Set before P15 gate (~line 1307) in `analyzeEmail`
- Uses canonical name OR alias (≥3 chars) word-boundary match against raw `subject`
- Modifies P15 filter: `isBrandGrounded(b) || subjectGroundedBrands.has(b.toLowerCase())`
- Modifies P18 filter: same exemption added
- `detectionKb.getBrandAliases()` already cached — no performance concern

## BRAND-03 — Short Alias Rejection

- Guard in `detection-kb.js` detectBrands: `if (!/\s/.test(alias) && alias.length <= 2) return false`
- Guard in `email-analyzer.js` local detectBrands: `if (!/\s/.test(aliasLower) && aliasLower.length <= 2) continue`
- Threshold ≤2 (not ≤3) — preserves `"abb"`→ABB and all other 3-char brand aliases
- 7 live KB 2-char aliases blocked: `av, hp, hu, lb, ue, uv, zj`

## Tests (4/4 GREEN)
- BRAND-02: Siemens in subject only → in lead.detectedBrands ✓
- BRAND-02 regression: no brand in subject/body → no spurious brands ✓
- BRAND-03: `"av"` alias no longer fires ✓
- BRAND-03 regression: `"abb"` (3-char) still matches ABB ✓
