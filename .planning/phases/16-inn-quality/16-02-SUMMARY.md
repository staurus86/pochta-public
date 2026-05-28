---
phase: 16-inn-quality
plan: 02
status: completed
completed_at: "2026-05-28"
commits:
  - 13d0843 feat(16-02): auto-learn INN to company_directory after Клиент analysis (Fix D)
---

# Plan 02 Summary — Auto-learning company_directory (Fix D)

## Changes

**detection-kb.js — `upsertCompanyDirectoryEntry`**
- Added after `lookupCompanyDirectory` method
- ON CONFLICT(email) DO UPDATE — never overwrites non-empty existing INN
- Invalidates `this.cache.companyDirectory` after write
- No `kpp` column in schema — omitted
- Guard: caller (server.js) responsible for free-domain and own-INN filtering

**server.js — auto-learn hook**
- After `analyzeEmailAsync` in `/api/projects/:id/analyze` handler
- Guard conditions: `inn && inn !== "9701077015" && label === "Клиент" && source !== "company_directory" && fromEmail && !FREE_DOMAINS.has(emailDomain)`
- FREE_DOMAINS inlined (avoids circular import)

## Tests: 14/14 GREEN (9 from plan-01 + 5 AUTO-01..05)
- AUTO-01: write then lookup round-trip ✅
- AUTO-02: no-overwrite of existing non-empty INN ✅
- AUTO-03: method doesn't throw ✅
- AUTO-04: guard logic unit test (free domain, own INN, Спам) ✅
- AUTO-05: full round-trip via analyzeEmail ✅

## Impact estimate (from research)
+14-19pp on inn.present → should reach ≥50% target after reanalysis
