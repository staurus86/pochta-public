---
phase: 16-inn-quality
plan: 01
status: completed
completed_at: "2026-05-28"
commits:
  - 3807bd6 test(16-01): add failing INN-A..E regex gap tests
  - 4f76046 feat(16-01): INN regex fixes A+B+C
---

# Plan 01 Summary — INN Regex Fixes A+B+C

## Changes

**Fix A — INN_PATTERN (email-analyzer.js:60)**
- Before: `/(?:ИНН|inn|УНП)(?:\/КПП)?\s*[:#-]?\s*(\d{1,6}(?:\s\d{1,6}){1,3}|\d{9,12})/i`
- After: `/(?:ИНН|inn|УНП|УНН)(?:\/КПП)?(?:\s*\([^)]{0,30}\))?\s*[:#\-–—]?\s*(\d{1,6}(?:\s\d{1,6}){1,9}|\d{9,12})/i`
- Added: УНН, parenthetical `(?:\s*\([^)]{0,30}\))?`, en-dash `–`, em-dash `—`, group limit `{1,3}→{1,9}`

**Fix B — stripLightMarkup**
- New function before `extractRequisites`
- Strips HTML tags, markdown asterisks/underscores, table pipes, HTML entities
- Applied at `extractRequisites(stripLightMarkup(body))` call site in extractSender

**Fix C — EDO identifier pattern in extractRequisites**
- Pattern: `/\b2[A-Z]{2}-(\d{10})-(\d{9})-\d{14,}/i`
- Extracts INN+KPP from ЭДО operator IDs (Taxcom, СБИС formats)
- Bypasses EDO context suppression (passes null to filterInn)

**attachment-content.js**
- `INN_LABELED_SPACED` group limit: `{1,3}→{1,9}`

## Tests: 9/9 GREEN
INN-A (em-dash), INN-A2 (en-dash), INN-B (5-group), INN-C (markdown), INN-D (EDO), INN-E (HTML), REG-1/2/3

## Mirror: src/ == .railway-deploy/src/ for both files ✅
