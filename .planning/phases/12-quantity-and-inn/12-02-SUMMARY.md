---
phase: 12-quantity-and-inn
plan: 02
status: completed
completed_at: "2026-05-28"
commits:
  - 735b3e3 test(12-02): add failing INN checksum tests for CONTACT-02
  - 341aeef feat(12-02): add FNS mod-11 INN checksum validation (CONTACT-02)
  - 4aa572e chore(12-02): mirror INN checksum changes to .railway-deploy
---

# Plan 02 Summary — CONTACT-02 INN checksum

## What was done

- Added `export function validateInnChecksum(digits)` in `email-analyzer.js` (FNS mod-11)
  - 9-digit Belarus УНП: accepted without checksum
  - 10-digit: validates against weight vector [2,4,10,3,5,9,4,6,8,0]
  - 12-digit ИП: validates both control digits with w1 and w2
- Exported `normalizeInn` — now gates on checksum (returns null on failure)
- Updated `isObviousArticleNoise`: 10-digit pure-numeric always rejected as article (P12)
- Updated `tests/email-analyzer.test.js`: replaced 3 fake INNs:
  - `7701234567` → `7701234507` (valid, checksum passes)
  - `7812345678` → `7812345675` (valid, checksum passes)
  - `9510451992` (10-digit article) → `9510451-992` (dash prevents INN-like rejection)
- Mirrored `email-analyzer.js` to `.railway-deploy/src/services/` (SHA256 OK)

## Test results

- 15/15 batch-12 tests green (5 ART-04 + 10 CONTACT-02)
- Full suite: only pre-existing FAIL (docx/xlsx attachments)

## Intentional behavior changes

- 10-digit pure-numeric tokens rejected as articles in ALL contexts (hasStrongArticleContext exception removed)
- `normalizeInn("7701234567")` → null (was "7701234567") — test INNs updated to valid values
