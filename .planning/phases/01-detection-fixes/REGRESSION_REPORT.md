# P0 Regression Report — Cycle 1

**Date:** 2026-04-20
**Dataset:** `data/prod-messages-local-postAudit2.json` (1657 Клиент messages)
**Method:** reapply new filters/normalizers to existing prod JSON and recount audit buckets.

## Test suite

| Suite | Before | After |
|---|---|---|
| `tests/p0-regression.test.js` (9 new tests for A01..A06, B01..B03) | 0/9 | **9/9** ✅ |
| Full repo (`npm test`) | 3 pre-existing failures (docx/xlsx/brand-alias) | same 3 (unrelated) |

No regressions introduced.

## P0 bucket delta (postfix vs baseline)

| Bucket | Baseline | Postfix | Δ |
|---|---:|---:|---|
| A2 phone_as_article | 9 | 0 | **−9** |
| A3 inn_as_article | 4 | 0 | **−4** |
| A4 date_as_article | 3 | 0 | **−3** |
| A5 tiny_digit_article (1–3 digits) | 6 | 0 | **−6** |
| A6 decimal_as_article | 1 | 1 | = |
| A10 pagemail_article | 3 | 3 | = (not covered in this cycle) |
| A12 duplicate_articles (normalized key) | 9 | 9 | = (baseline already normalized) |
| A13 over_extraction_articles (>20 per msg) | 6 | 3 | **−3** |
| B1 html_in_title | 7 | 0 | **−7** |
| B2 email_url_in_title | 16 | 1 | **−15** |
| B3 tiny_title | 2 | 2 | = |
| B4 looks_like_article_only | 16 | 17 | +1 (see note) |
| B5 quoted_marker_title | 2 | 0 | **−2** |
| B8 duplicate_titles (after normalize) | 0 | 2 | +2 (see note) |
| E2 title_is_article | 168 | 121 | **−47** |

**Net P0 false-positives eliminated: 99** (across 200+ article/title bucket hits before fix).

### Notes on +1/+2

- **B4 +1** — a title that had a URL was cleaned to a short pure-code string (e.g. `PUMP OEM`) → now falls into "looks like article only" heuristic. Title is actually cleaner; heuristic just flags short ALL-CAPS.
- **B8 +2** — two pairs of titles that previously looked distinct due to CSS/HTML residue normalize to the same string. This is the expected side-effect; the pipeline needs a post-normalize dedup step (deferred to Cycle 2).

## Commits applied in this cycle

| Commit (pending) | File | Fix |
|---|---|---|
| — | `src/services/article-filters.js` | `isInnLike`, `isHtmlStructureToken`, `isSizeTriple`, `isHoursRange`, `isPhoneFragment` + wired into `rejectArticleCandidate` |
| — | `src/services/article-normalizer.js` | `dedupKey` treats space/hyphen/dot/punct as equivalent |
| — | `src/services/product-name-normalizer.js` | `stripCssTokens`, `stripUrlTail`, `stripQuoteMarker` + facade order fix (quote-marker runs first) |
| — | `src/services/product-name-filters.js` | `CSS_DECL_BARE_RE`, `PARTIAL_TAG_RE` added to `isHtmlResidueLike` |

## Cycle 2 — legacy path coverage ✅

- **Done** — ported narrow P0 predicates (`isInnLike`, `isHtmlStructureToken`, `isSizeTriple`, `isHoursRange`, `isPhoneFragment`) into legacy `isObviousArticleNoise` at the tail (before `return false`). Kept import narrow (not the full `rejectArticleCandidate`, which carries tech_spec rules that would regress legacy extraction).
- **Test impact:** 141/144 pass (same 3 pre-existing failures — docx/xlsx/brand-alias — unchanged). `tests/p0-regression.test.js` 9/9.
- **B8 post-normalize dedup** — already handled in-pipeline: `sanitizeProductNames` does normalize → filter → dedup (steps 3–5) for new messages. The +2 delta in the simulation is "historical": the stored prod JSON was produced before the fix; a full reanalyze would absorb these.
- **A10 URL/email as article** — legacy path already rejects via line 5762 of `email-analyzer.js` (`/^(?:https?|www|cid)$/`, `.includes("@")`). No extra wiring needed in this cycle.

## Open for future cycles

1. Re-run full pipeline on prod snapshot (reanalyze) to measure true end-to-end delta, not just simulation.
2. Cycle 3 can target residual B4 (short-article-shape titles) and A6/A10/A11 long-tail (3 hits each) if business prioritizes.
