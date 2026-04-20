# FIX_LOG — Cycle 1 (P0)

All fixes are minimal, isolated to filter/normalizer modules. No pipeline-wide changes.
Each bug has one failing test in `tests/p0-regression.test.js` that proves red→green.

---

## BUG-A01 — 12-digit pure numeric (ИП ИНН) classified as article

- **File:** `src/services/article-filters.js`
- **Added:** `INN_LIKE_RE = /^\d{10}$|^\d{12}$/` + `isInnLike(v)` predicate.
- **Wired into `rejectArticleCandidate`:** 12-digit always rejected, 10-digit only accepted with strict `Артикул:` label.
- **Test:** `BUG-A01: 12-digit pure numeric (ИП ИНН) rejected`

## BUG-A02 — HTML table structure tokens (row-19, column-1, block-3)

- **File:** `src/services/article-filters.js`
- **Added:** `HTML_STRUCT_RE` covering 20 prefixes (row/column/col/block/cell/header/footer/section/group/item/wrapper/container/nav/aside/main/article/hero/banner/card/tile) — lowercase only to keep uppercase SKUs safe.
- **Test:** `BUG-A02: HTML structure tokens rejected`

## BUG-A03 — Size triple `80/95/70`

- **File:** `src/services/article-filters.js`
- **Added:** `SIZE_TRIPLE_RE = /^\d{1,3}(?:[/×xXхХ*]\d{1,3}){1,2}$/` — 2–3 segments, ≤3-digit each, no letters/dashes.
- **Test:** `BUG-A03: size-triple NN/NN/NN rejected`

## BUG-A04 — Hours pattern `00-18.00`

- **File:** `src/services/article-filters.js`
- **Added:** `HOURS_RANGE_RE = /^\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}$/` and variant for `HH-HH.MM`.
- **Test:** `BUG-A04: hours/time pattern rejected`

## BUG-A05 — Phone fragments `915-506-04-96`

- **File:** `src/services/article-filters.js`
- **Added:** `PHONE_FRAG_RES` (4 shape regexes: 3-3-2-2, 3-3-2, 1-3-3-2-2, spaced intl).
- **Test:** `BUG-A05: phone-fragment patterns rejected`

## BUG-A06 — Dedup treats `MD-025-6L` and `MD 025-6L` as different

- **File:** `src/services/article-normalizer.js`
- **Changed `dedupKey`:** strips ALL non-alnum chars (space/hyphen/dot/slash/underscore) before case-fold — equivalents now collapse into one key.
- **Test:** `BUG-A06: dedup treats MD-025-6L == MD 025-6L`

## BUG-B01 — CSS tokens leak into product names

- **Files:** `src/services/product-name-normalizer.js`, `src/services/product-name-filters.js`
- **Added:** `stripCssTokens()` — handles `font-family:'times new roman'`, `color:#xxx`, inline `<span style="…">`, trailing `"/>`. Order in facade: `style="…"` attribute first, then CSS decls, then tag bodies, then residue.
- **Filter-side:** `CSS_DECL_BARE_RE` + `PARTIAL_TAG_RE` now flag standalone CSS as bad product name.
- **Test:** `BUG-B01: CSS tokens stripped from product names`

## BUG-B02 — URL / email in product name

- **File:** `src/services/product-name-normalizer.js`
- **Added:** `stripUrlTail()` — strips `https?://`, `www.`, `<…>`, bracketed URL, email. Preserves non-URL text like brand name.
- **Test:** `BUG-B02: URL/email stripped from title`

## BUG-B03 — Quote-marker prefix `>>:`, `> `

- **File:** `src/services/product-name-normalizer.js`
- **Added:** `stripQuoteMarker()` + facade pipeline re-ordered to strip quote markers **before** HTML/CSS cleanup (otherwise `TAG_RESIDUE_RE` consumes bare `>` and orphans `:`).
- **Test:** `BUG-B03: quote-marker prefix stripped`

---

## Verification

```
node --test tests/p0-regression.test.js
# tests 9 / pass 9 / fail 0

npm test
# Only 3 pre-existing failures remain (docx/xlsx/brand-alias — unrelated to P0 work).
```

## Postfix audit delta

See `REGRESSION_REPORT.md`. Net elimination: 99 P0 false-positive bucket entries (mostly A2/A3/A4/A5/B1/B2/E2).
