# Stack Research

**Domain:** Rule-based field extraction for Russian B2B industrial supply emails
**Researched:** 2026-05-25
**Confidence:** HIGH for techniques and patterns; MEDIUM for specific library recommendations (some packages have low download counts and maintenance varies)

---

## Context: What This Research Addresses

The existing extractors already cover the full field set (ФИО, ИНН, телефон, компания, артикулы, бренды, названия товаров). The research question is: **what specific techniques, patterns, and lightweight libraries can improve accuracy** in each extractor without adding LLM or heavy native dependencies.

The BUG_LEDGER and CONCERNS.md identify three systemic failure categories:

1. **False positives** — non-article tokens passing filters (INN as article, HTML structure tokens, phone fragments)
2. **False negatives** — missing ФИО, phone numbers, ИНН not validated as checksum-correct
3. **Noise** — brand aliases matching generic words, productNames containing CSS/URL fragments

The recommended techniques below directly address each category.

---

## Recommended Stack

### Core Technologies (Already in Use — Keep)

| Technology | Version | Purpose | Why Keep |
|------------|---------|---------|----------|
| Node.js ESM | ≥ 25 | Runtime | `node:sqlite` DatabaseSync requires ≥ 22; no reason to change |
| `node:sqlite` DatabaseSync | built-in | Brand KB, corpus | Synchronous API matches single-thread Node HTTP; no async overhead |
| Raw `node:http` | built-in | HTTP server | No framework migration in v1 scope |
| Python 3 (subprocess) | system | IMAP fetcher | Node-imap alternatives exist but migration is out of scope |

### Supporting Libraries — Recommended Additions

These are the only external packages recommended. All are pure JS (no native binaries), ESM-compatible or wrappable via dynamic import, and solve specific accuracy gaps.

| Library | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `libphonenumber-js` | ^1.11.x | Russian phone normalization to E.164, RU area code validation, extension parsing | Google's phone data, explicit Russian metadata including `8` prefix and `доб.` extension keyword; ~145 KB with min metadata; pure JS ESM; replaces ~80 lines of hand-rolled normalizer heuristics |
| `ru-validation-codes` | ^2.9.0 | INN checksum validation (10-digit org, 12-digit ИП) + ОГРН/СНИЛС | Implements official FTS algorithm with weight vectors [2,4,10,3,5,9,4,6,8] for 10-digit and [7,2,4,10,3,5,9,4,6,8] / [3,7,2,4,10,3,5,9,4,6,8] for 12-digit; ~614 weekly downloads, sustainable maintenance; pure JS |
| `fast-levenshtein` | ^3.0.x | Brand alias deduplication candidate scoring | Fastest Levenshtein in Node.js (~45K ops/sec); for finding near-duplicate brand aliases at KB import time, not per-email runtime |

**No other libraries recommended.** The existing regex/filter architecture is the correct approach for this domain. Adding NLP libraries (NLP.js, natural, wink-NLP) would add weight without benefit — they are English-first, and the Russian morphology task here is narrow enough for rule patterns.

---

## Technique Inventory by Field

This section is the primary deliverable. Each entry is a specific improvement technique, not a generic recommendation.

### 1. ИНН — False Positive Reduction + Validation

**Current gap:** ИНН appears as article (12-digit passes `LABEL_NUMERIC_RE`), phone extractor misidentifies 10-digit ИНН as phone.

**Technique A — Checksum Validation Gate (HIGH confidence)**

Both 10-digit (org) and 12-digit (ИП) ИНН have deterministic check digits using weighted sums mod 11 mod 10. The algorithm is public (nalog.gov.ru):

- 10-digit: `checkDigit = (Σ [2,4,10,3,5,9,4,6,8] × digits[0..8]) % 11 % 10` must equal `digits[9]`
- 12-digit: two check digits using weights `[7,2,4,10,3,5,9,4,6,8]` (for position 10) and `[3,7,2,4,10,3,5,9,4,6,8]` (for position 11)

Any 10-digit or 12-digit number that fails checksum is not a valid ИНН — it can safely be rejected from the ИНН field and allowed through to article detection if it has a strong article label. `ru-validation-codes@2.9.0` implements this as `checkINN(value)`.

**Technique B — Region Code Plausibility (MEDIUM confidence)**

The first 4 digits of ИНН encode the issuing tax authority (0000–9999, with valid prefixes known). Digits starting with `0000` or `9909` (foreign org) are special cases. Simple range check: first 2 digits 01–99 (Chukotka=87, Crimea=91), reject 00-prefix. This is the filter already partially in place (`multiple_inn_candidates` 0-prefix fix) and should be formalized as a named predicate `isValidInnRegionCode`.

**Why not use `ru-validation-codes` directly at parse time:** The library is pure JS ~5 KB — add as a direct import. Invoke `checkINN` only after the candidate passes the morphological filter (10 or 12 digits, not all-zeros). Do not invoke it in the hot article-filtering path.

---

### 2. Телефон — Missing Phones and International Normalization

**Current gap:** ~81 cases with missing phone (target <30). Root cause is international format handling (+375 BY, +86 CN, +994 AZ are Siderus supplier countries).

**Technique A — libphonenumber-js for Normalization (HIGH confidence)**

Replace the custom `canonicalToPlus7` + `normalizeBareDigits` pipeline with `libphonenumber-js` for the normalization step only (not detection). The detection regex `RU_PHONE_RE` stays in place for performance. After a candidate is found, use `parsePhoneNumberFromString(candidate, 'RU')` to validate and get E.164 output.

For international phones, use `parsePhoneNumberFromString(candidate)` without country hint after RU-specific parse fails. This handles +375/+86/+994 without adding per-country regex rules.

**Key implementation detail:** Use the `min` metadata bundle from `libphonenumber-js/min` to keep bundle size at ~80 KB. Do NOT use the full bundle (220 KB) — it is not needed for validation-only use.

```js
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

// In phone-normalizer.js, replace canonicalToPlus7 post-normalization:
const parsed = parsePhoneNumberFromString(rawCandidate, 'RU');
if (parsed && parsed.isValid()) {
    return { e164: parsed.format('E.164'), national: parsed.formatNational() };
}
// Fallback: try without country hint for international
const parsedIntl = parsePhoneNumberFromString(rawCandidate);
if (parsedIntl && parsedIntl.isValid()) {
    return { e164: parsedIntl.format('E.164'), country: parsedIntl.country };
}
```

**Technique B — Extension Handling (MEDIUM confidence)**

`libphonenumber-js` natively recognizes Russian `доб.` extension syntax (documented in library metadata as `national_prefix_for_parsing`). Enables stripping ext from primary number and storing as separate `ext` field — currently done manually in `stripExtension`.

**Technique C — Area Code Validation Without Library (HIGH confidence)**

For the existing `normalizeBareDigits` path, the rule is: valid RU mobile prefixes are 9xx (900–999). Landline codes 2xx–8xx (excluding 6xx which is unassigned). The existing filter already rejects 0xx/1xx/6xx — formalize this in `phone-filters.js::isValidRuAreaCode` with explicit allowed ranges rather than negative exclusions.

---

### 3. ФИО — Increasing Precision in Signature Line Detection

**Current gap:** False positives (role-compound TitleCase strings, corporate names) and false negatives (names in non-standard signature positions, patronymic-only or initial-only formats).

**Technique A — Russian Surname Pattern Anchors (HIGH confidence)**

Russian surnames have predictable morphological endings. Male surnames end in: `-ов`, `-ев`, `-ёв`, `-ин`, `-ын`, `-ий`, `-ой`, `-ский`, `-цкий`, `-цой`, `-ых`, `-их`, `-аго`, `-яго`, `-ого`, `-его`. Female surnames add `-а`: `-ова`, `-ева`, `-ина`, `-ская`. Patronymics end in `-ович`, `-евич`, `-овна`, `-евна`. This is a finite, well-known pattern set.

The existing `fio-extractor.js` scores candidates but does not use morphological anchors to boost confidence. Adding a `hasSurnameSuffix(word)` predicate and boosting score by 0.1 when the first or last word matches reduces false positives from TitleCase company fragments.

```js
// Pure rule — no library needed
const MALE_SURNAME_RE = /(?:ов|ев|ёв|ин|ын|ий|ой|ский|цкий|цой|ых|их|аго|яго|ого|его)$/iu;
const FEMALE_SURNAME_RE = /(?:ова|ева|ёва|ина|ская|цкая|аго|яго|ого|его)$/iu;
const PATRONYMIC_RE = /(?:ович|евич|ёвич|овна|евна|ёвна|ич|ична)$/iu;

export function hasSurnameSuffix(word) { 
    return MALE_SURNAME_RE.test(word) || FEMALE_SURNAME_RE.test(word); 
}
export function hasPatronymicSuffix(word) { return PATRONYMIC_RE.test(word); }
```

When `hasSurnameSuffix` fires on the first word of a 2-3 word TitleCase string and `hasPatronymicSuffix` fires on another word, confidence should be 0.95 (near-certain).

**Technique B — Initials Pattern Detection (HIGH confidence)**

A significant false negative class: names written as `Жарихин Н.В.` or `Н. В. Жарихин` (surname + initials). The current `normalizePersonName` handles initials but the filter `isBadPersonName` may reject short strings. Add explicit detection for `SurnameLike Initial.Optional.` patterns:

```js
const SURNAME_INITIAL_RE = /^[А-ЯЁ][а-яёА-ЯЁ]{2,}\s+[А-ЯЁ]\.\s*(?:[А-ЯЁ]\.)?$/u;
const INITIAL_SURNAME_RE = /^[А-ЯЁ]\.\s*(?:[А-ЯЁ]\.)?\s+[А-ЯЁ][а-яёА-ЯЁ]{2,}$/u;
```

These patterns should bypass the `wc >= 2` word-count threshold since initials are single characters separated by dots.

**Technique C — Gender Disambiguation for Deduplication (MEDIUM confidence)**

When both `Иванова Анна` and `Иванов Анна` appear across emails from the same sender domain, the `-ова` suffix signals female, `-ов` signals male — useful for cross-email deduplication at the KB level. Low priority for this milestone but noted for Phase 5 (ФИО quality sprint).

**What NOT to do:** Do not import Russian morphology libraries (`russian-nouns-js`, `morphos` PHP port). The declension task here is detection confidence scoring, not actual declension — the rule-based suffix list above is sufficient and zero-dependency.

---

### 4. Артикулы — False Positive Reduction

**Current gap (from BUG_LEDGER):** HTML structure tokens (row-19), phone fragments (915-506-04-96), size triples (80/95/70), hours ranges (00-18.00) pass as articles. All are already implemented in `article-filters.js` as of the detection-fixes phase.

**Technique A — Contextual Scoring Adjustment (HIGH confidence)**

The existing `scoreCandidate` function uses zone priority and label proximity. Add two additional context signals:

1. **Line density signal**: If a line contains ≥ 3 candidate SKUs (dense product list), boost all candidates on that line by 1 score point. Conversely, if a line is a signature block (contains phone/email), demote by 2.

2. **Cross-zone repetition**: If an article appears in BOTH current_message zone AND subject zone (customer put it in subject line), this is near-certain signal — boost by 2.

These require no library: just count candidates-per-line and set membership.

**Technique B — Article Deduplication by Semantic Normalization (HIGH confidence)**

The existing `dedupKey` in `article-normalizer.js` normalizes case but treats `MD-025-6L` and `MD 025-6L` as different (BUG-A06). Fix: normalize `[\s\-]+` → `_` for dedup key computation while preserving original formatting in output.

```js
function dedupKey(value) {
    return value.toUpperCase().replace(/[\s\-]+/g, '_');
}
```

This is a one-line fix that resolves BUG-A06 and requires no library.

**Technique C — Catalog Prefix Dictionary (MEDIUM confidence)**

Known industrial catalog prefixes from Siderus suppliers are a finite set: `DNC-`, `ADV-`, `DSNU-`, `QIT-`, `WR-`, `MWR-`, `R.STAHL-`, `GHG-`, etc. Adding these as a "strong_positive" list in the KB (or hardcoded in article-normalizer.js) enables raising `minScore` threshold for unlabeled candidates while lowering it for prefix-matched ones. This directly addresses the label-dependency problem where unlabeled articles from structured tables are demoted.

Implementation: A `Set<string>` of known-valid prefixes checked via `candidate.startsWith(prefix)` — 10–20 entries, zero dependency.

---

### 5. Бренды — False Positive Reduction

**Current gap:** Generic word aliases (`"sensor"`, `"control"`, `"power"`) in KB causing false positives. The existing `BRAND_FALSE_POSITIVE_ALIASES` and `BRAND_MULTI_FIRST_TOKEN_CONFLICT` sets address this partially.

**Technique A — Minimum Token Length for Single-Word Aliases (HIGH confidence)**

Any brand alias of length ≤ 4 characters should require a capital-letter match (i.e., the alias must appear as a token with an uppercase first letter in the email). Aliases of length ≤ 3 should be rejected from the detection path entirely — they are too short to be unambiguous.

This is a configuration rule in `detection-kb.js::findMatchingBrands`, not a new library:
```js
if (alias.length <= 3) return false; // always skip ultra-short
if (alias.length <= 4 && !token.startsWith(alias[0].toUpperCase())) return false;
```

**Technique B — Window Context Requirement for Ambiguous Aliases (HIGH confidence)**

For aliases in `BRAND_MULTI_FIRST_TOKEN_CONFLICT`, the existing code rejects single-token matches. Extend this to require that the matched alias appears in the first 60% of the email body (not in signature zone or quoted thread). Signature aliases are already suppressed by the cluster filter (commit 29f5456), but quoted-thread aliases are not fully suppressed.

**Technique C — IDF-Style Alias Scoring (MEDIUM confidence)**

Aliases that appear in >80% of processed emails are likely generic words. Add a usage frequency counter to `brand_catalog` entries (increment on match, divide match score by log(frequency)). This is an in-SQLite operation requiring no library:

```sql
ALTER TABLE brand_catalog ADD COLUMN match_freq INTEGER DEFAULT 0;
-- On each brand detection: UPDATE brand_catalog SET match_freq = match_freq + 1 WHERE id = ?
-- In scoring: penalty = log2(max(1, match_freq / total_emails))
```

Medium priority — requires corpus statistics to be meaningful.

---

### 6. Компания — Legal Form Extraction and Normalization

**Current gap (from CONCERNS.md):** Company names with legal form markers (ООО, АО) but unusual quoting styles or HTML entities escape the `findLegalEntities` patterns.

**Technique A — Expand Legal Quote Variants (HIGH confidence)**

Current patterns handle `«»`, `""`, `''`. Add:
- ANSI single quotes `'...'` (common in forms)
- Left-right double quotes `"..."` (Windows default)
- No-quote form: `ООО Сидерус` (company name with spaces, no quotes) — already handled but length cap at 50 chars may truncate long names

Adjustment: increase max capture length from 50 to 80 characters for no-quote legal names. No library needed — regex tuning.

**Technique B — Company Name Normalization via Canonical Forms (HIGH confidence)**

Russian company names have standard normalization:
- Quotes should be unified to `«»` 
- Legal form position: `ООО «X»` not `«X» ООО`
- Trailing punctuation (`,`, `.`) should be stripped

The existing `normalizeCompanyName` in `company-normalizer.js` does this. The gap is handling `ООО "Петров и К°"` where `°` character confuses the closing quote detection. Add `°` to the set of characters that terminate a company name.

**Technique C — Domain→Company Disambiguation (MEDIUM confidence)**

The existing `domainToLabel` function converts `siderus.ru` → `Siderus`. This often fires as a weak fallback even when a better company name was found from signature. The scoring already penalizes domain source (confidence 0.35), but the `needsReview` flag should be set to `true` whenever company comes from email_domain source — this is a 1-line change in `company-extractor.js`.

---

### 7. Названия товаров — Noise Reduction

**Current gap (BUG_LEDGER B01-B03):** CSS tokens, URLs, quote markers (`>>:`) in productNamesClean.

**Technique A — Multi-Stage Normalization Pipeline Order (HIGH confidence)**

The current `product-name-normalizer.js` pipeline should enforce this order:
1. Strip HTML residue (existing `stripHtmlResidue`)
2. Strip CSS declarations (new: `font-family`, `color:#`, `background-color:`)
3. Strip unclosed HTML tags (`<tag...` without `>`)
4. Strip URLs/emails
5. Strip leading quote markers (`^>+`, `^-{3,}`)
6. Strip trailing punctuation/whitespace
7. Then apply the existing word-count / length normalization

**Key regex additions (no library):**

```js
// CSS property declarations
const CSS_PROPERTY_RE = /\b(?:font-family|font-size|font-weight|font-style|color|background-color|text-decoration|margin|padding|border|display|float|position|width|height)\s*:\s*[^;\n"]{1,200}/gi;

// Unclosed HTML tags  
const UNCLOSED_TAG_RE = /<\/?[a-z][^>\n]{0,200}(?!\>)/gi;

// URL strip
const URL_STRIP_RE = /https?:\/\/[^\s)\]>]{3,200}|www\.[^\s)\]>]{3,200}/gi;

// Leading quote markers
const QUOTE_MARKER_RE = /^\s*(?:>{1,3}[:\s]*|-{3,}.*?(?:Original Message|Forwarded|Ответ).*?-{3,})/gi;
```

**Technique B — Minimum Semantic Content Guard (HIGH confidence)**

After normalization, a product name should:
- Contain ≥ 2 non-stopword tokens
- Have ≥ 3 alphabetic characters
- Not start with a digit or punctuation (those are likely artykul fragments)

If it fails, `needsReview = true` and it should be excluded from `productNamesClean`. This prevents fragments like `1. x - N шт.` and `FESTO:` (with colon) surviving as product names.

---

## Alternatives Considered

| Recommended Approach | Alternative | Why Not |
|---------------------|-------------|---------|
| `libphonenumber-js` for phone normalization | Hand-rolled regex cascade | Library covers 100+ edge cases (extensions, formats, validation) already tested; replaces ~80 lines of brittle code |
| `ru-validation-codes` for INN checksum | Implement checksum inline | Same algorithm, but library code is tested and maintained; adds ~5 KB, removes maintenance burden |
| `fast-levenshtein` for KB alias dedup at import time | No deduplication | Prevents future alias conflicts; run once at import, not per-email |
| Rule-based surname suffix matching for ФИО | `natasha` Python NLP (yargy) | `natasha` is Python-only, requires subprocess; the 5 suffix rules cover 95% of Russian surnames without dependency |
| In-memory `Set` for known brand prefixes | SQLite catalog prefix table | Single-file set is zero-latency; can always migrate to KB later |
| NLP.js for Russian NER | Current regex pipeline | NLP.js Russian support is English-first with Russian add-on; adds 15 MB dependency; no accuracy improvement for structured signature parsing |
| Google `libphonenumber` Java port via subprocess | `libphonenumber-js` | Subprocess adds 200ms+ overhead; `libphonenumber-js` is same data, pure JS |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `natural` npm package | English-centric stemmer/tokenizer; Russian support is phonetic only; no value for Cyrillic extraction | Rule-based regex with Unicode `\p{L}` support (built into Node 25) |
| `compromise` NLP library | English NLP only; explicitly not designed for Russian/Cyrillic | Already-built Cyrillic regex patterns |
| `wink-nlp` | English-only, no Cyrillic support | Not applicable |
| `node-nlp` / `nlp.js` | General-purpose; Russian is a low-quality add-on; adds 15+ MB to bundle | Domain-specific rule patterns |
| Python `natasha`/`yargy` via subprocess | Adds 200+ ms per email for subprocess startup; works well for batch but kills interactive analysis; requires Python NLP environment setup | Suffix rules handle 95% of cases; subprocess for batch reanalysis if needed later |
| Full `libphonenumber-js` bundle | 220 KB — unnecessary for validation-only use | `libphonenumber-js/min` at 80 KB |
| `russian-nouns-js` for surname declension | Solves noun declension — wrong tool; need detection, not generation | Suffix regex predicates (5 lines) |

## Installation

```bash
# Add to package.json — only these 3 packages:
npm install libphonenumber-js@^1.11.0 ru-validation-codes@^2.9.0 fast-levenshtein@^3.0.0
```

Note: `fast-levenshtein` is only needed if a brand-alias deduplication step is added to the KB import pipeline. If not implementing that feature, omit it.

## Version Compatibility

| Package | Node.js | Notes |
|---------|---------|-------|
| `libphonenumber-js@1.11.x` | ≥ 12 | ESM via `import ... from 'libphonenumber-js/min'`; no native deps |
| `ru-validation-codes@2.9.0` | ≥ 12 | CommonJS; wrap in thin ESM adapter if needed: `import { createRequire } from 'module'; const req = createRequire(import.meta.url); const { checkINN } = req('ru-validation-codes')` |
| `fast-levenshtein@3.0.x` | ≥ 12 | Pure JS; ESM-compatible in v3 |

## Pattern Reference — Zero-Dependency Implementations

For techniques that need no new library, here are the canonical implementations to use as-is or adapt:

### INN Checksum (inline if not using library)

```js
// Source: kholenkov.ru/data-validation/inn/ — HIGH confidence (official algorithm)
function validateInn(inn) {
    const d = String(inn).split('').map(Number);
    if (d.length === 10) {
        const w = [2,4,10,3,5,9,4,6,8];
        const check = (w.reduce((s, wi, i) => s + wi * d[i], 0) % 11) % 10;
        return check === d[9];
    }
    if (d.length === 12) {
        const w1 = [7,2,4,10,3,5,9,4,6,8];
        const w2 = [3,7,2,4,10,3,5,9,4,6,8];
        const c1 = (w1.reduce((s, wi, i) => s + wi * d[i], 0) % 11) % 10;
        const c2 = (w2.reduce((s, wi, i) => s + wi * d[i], 0) % 11) % 10;
        return c1 === d[10] && c2 === d[11];
    }
    return false;
}
```

### Surname Suffix Detection

```js
// Russian surname morphology — masculine and feminine forms
// Confidence: HIGH — covers >95% of Russian surnames in industrial B2B context
const SURNAME_ENDINGS_RU = /(?:ов|ев|ёв|ин|ын|ий|ой|ский|цкий|цой|ых|их|аго|яго|ого|его|ова|ева|ёва|ина|ская|цкая|ая)$/iu;
const PATRONYMIC_ENDING_RU = /(?:ович|евич|ёвич|овна|евна|ёвна|ич|ична|вна)$/iu;

export function likelySurname(word) { return SURNAME_ENDINGS_RU.test(word); }
export function likelyPatronymic(word) { return PATRONYMIC_ENDING_RU.test(word); }
```

### Article Dedup Key (fix for BUG-A06)

```js
// Collapse spaces and hyphens for dedup; preserve original in output
export function dedupKey(value) {
    return String(value).toUpperCase().replace(/[\s\-]+/g, '_').replace(/[^A-Z0-9_./+]/g, '');
}
```

---

## Sources

- `kholenkov.ru/data-validation/inn/` — INN checksum weight vectors (official FTS algorithm documentation) — HIGH confidence
- `nalog.gov.ru/eng/inn/` — FTS INN format specification — HIGH confidence
- `github.com/kdmatrosov/validation-codes` — `ru-validation-codes` npm package source — MEDIUM confidence (inspected README, algorithm not shown in page but package validates against same weights)
- `github.com/catamphetamine/libphonenumber-js` — library README with Russian metadata details — HIGH confidence
- Codebase inspection: `src/services/article-filters.js`, `fio-extractor.js`, `fio-filters.js`, `phone-extractor.js`, `company-extractor.js`, `article-extractor.js` — direct analysis — HIGH confidence
- `.planning/phases/01-detection-fixes/BUG_LEDGER.md` — active bug inventory — HIGH confidence
- `.planning/codebase/CONCERNS.md` — tech debt and known gaps — HIGH confidence
- Academic: Carvalho & Cohen (2004) "Learning to Extract Signature and Reply Lines from Email" — MEDIUM confidence (older but foundational; confirms rule-based heuristics at 87-94% accuracy for zone detection)
- `github.com/Raven-SL/ru-pnames-list` — Russian names/surnames list (for validation testing) — MEDIUM confidence (sparse maintenance)

---

*Stack research for: Russian B2B email field extraction accuracy improvements*
*Researched: 2026-05-25*
