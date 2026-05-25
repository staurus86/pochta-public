# Phase Summary: 01-detection-fixes

**Milestone:** v1.0 Entity Extraction Sprint (parallel track)
**Completed:** 2026-04-22
**Type:** P0/P1 regression cycle

---

## Goal

Fix P0 false-positive bugs discovered during v1.0 Entity Extraction Sprint. All bugs rooted in article and product-name extraction producing false results from real production email corpus (1657 Клиент messages).

---

## Bugs Fixed

### Articles (A-series)

| Bug | Description | Files | Tests |
|-----|-------------|-------|-------|
| A01 | 12-digit pure numeric (ИП ИНН) accepted as article | article-filters.js | 1 |
| A02 | HTML table structure tokens (row-19, column-1) accepted as article | article-filters.js | 1 |
| A03 | Size triple 80/95/70 accepted as article | article-filters.js | 1 |
| A04 | Hours pattern 00-18.00 accepted as article | article-filters.js | 1 |
| A05 | Phone fragment 915-506-04-96 accepted as article | article-filters.js | 1 |
| A06 | MD-025-6L and MD 025-6L treated as different articles (dedup miss) | article-normalizer.js | 1 |

### Product Names (B-series)

| Bug | Description | Files | Tests |
|-----|-------------|-------|-------|
| B01 | CSS tokens leaked into productNames | product-name-normalizer.js, product-name-filters.js | 1 |
| B02 | URL/email in product name title | product-name-normalizer.js | 1 |
| B03 | Quote-marker prefix >>: in product name title | product-name-normalizer.js | 1 |

**Total:** 9 bugs, 9 tests, all pass.

---

## Measurable Impact

From REGRESSION_REPORT.md — net false-positive bucket elimination on 1657-message prod corpus:

| Bucket | Delta |
|--------|-------|
| A2 phone_as_article | -9 |
| A3 inn_as_article | -4 |
| A4 date_as_article | -3 |
| A5 tiny_digit_article | -6 |
| A13 over_extraction | -3 |
| B1 html_in_title | -7 |
| B2 email_url_in_title | -15 |
| B5 quoted_marker_title | -2 |
| E2 title_is_article | -47 |

**Net P0 false-positives eliminated: 99**

No regressions introduced. 3 pre-existing unrelated failures unchanged.

---

## Cycle 2 — Legacy path coverage

P0 predicates (isInnLike, isHtmlStructureToken, isSizeTriple, isHoursRange, isPhoneFragment) ported into legacy isObviousArticleNoise in email-analyzer.js. Legacy article extraction path also benefits from the fixes.

---

## Files Changed

- src/services/article-filters.js — 5 new rejection predicates
- src/services/article-normalizer.js — dedupKey collapses space/hyphen/punct as equivalent
- src/services/product-name-normalizer.js — stripCssTokens, stripUrlTail, stripQuoteMarker
- src/services/product-name-filters.js — CSS_DECL_BARE_RE, PARTIAL_TAG_RE
- src/services/email-analyzer.js — legacy path ported; extractArticles() wired in Phase 11
- tests/p0-regression.test.js — 9 regression tests (all pass)

---

## Phase 11 Connection

email-analyzer.js was later modified in Phase 11 (commit ac054f4) to wire extractArticles() facade. The .railway-deploy/src/services/email-analyzer.js mirror was updated in Task 4 (commit 5fd8a19) — SHA256 verified match.
