# Company Name Detection Improvement

**Date:** 2026-04-09  
**Status:** Approved, ready for implementation

## Problem
`extractCompanyName` finds companies only with legal form prefixes (ООО/АО/GmbH) or KB rules. "Вентинтех" without "ООО" → null. Georgiy's test: 0/5 company detection.

## Approved Approach: Combo (Labels → Signature → Domain)

### Architecture
Only `extractCompanyName` in `email-analyzer.js:1674` changes. Three new steps added after existing logic:

```
1. KB matchField("company_name")         ← existing
2. LEGAL_ENTITY_PATTERNS (ООО/АО/GmbH)  ← existing
3. [NEW] Label patterns ("Компания: X")
4. [NEW] Signature line parsing
5. [NEW] Domain fallback
```

Winner chosen via existing `companyNameScore`. New candidates get lower base score so legal forms always win on conflict.

### Step 3 — Label Patterns
New `COMPANY_LABEL_PATTERNS` array:
```js
/(?:компания|организация|предприятие|работодатель|employer|company)\s*[:\-–]\s*(.{3,60})/i
/(?:от|from)\s+компани[иея]\s+(.{3,60})/i
```
Clean extracted value: strip quotes, trailing phone/INN. Score: 0 (neutral).

### Step 4 — Signature Line Parsing
Only within `signature` string (already extracted). Algorithm:
1. Find ФИО line (via `extractFullNameFromBody`)
2. Take 1-3 lines after it, before first phone/email/URL
3. Candidate line criteria:
   - 3–50 chars
   - Starts with capital letter
   - Not phone, not email, not URL
   - Not a position word (стоп-лист: менеджер, директор, инженер, специалист, руководитель, главный, ведущий, старший)
   - Not only Latin > 20 chars
4. Score: `-5` (loses to legal forms, wins over domain)

### Step 5 — Domain Fallback
```js
// ivanov@ventitech.ru → "Ventitech"
domain → strip TLD → Title Case
```
Guards: skip if free domain, own Siderus domain, domain < 5 chars, or generic word (metal, group, trade, service, info, mail, opt).  
Score: `-15` (last resort only).

### False Positive Guards (Signature Step)
- Стоп-лист городов: Москва, Санкт-Петербург, Екатеринбург, Новосибирск, Казань, Нижний Новгород, Челябинск, Самара, Уфа, Ростов (top-30)
- Check against KB brands via `detectionKb.detectBrands`
- Skip if matches sender ФИО

### New Functions (testable independently)
- `extractCompanyFromLabels(body, signature)` → string|null
- `extractCompanyFromSignatureLine(signature, fullName)` → string|null
- `inferCompanyFromDomain(email)` → string|null

## Key Constraints
- False positive worse than missing → conservative thresholds
- No API changes, no `sender` structure changes
- Existing tests must stay green
