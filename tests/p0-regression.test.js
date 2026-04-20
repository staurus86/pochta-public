// p0-regression.test.js — regression suite for P0 bugs found on prod-messages-local-postAudit2.json.
// Each test corresponds to a BUG-Axx / BUG-Bxx entry in BUG_LEDGER.md.
// Tests must FAIL before fix is applied, PASS after.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    rejectArticleCandidate,
    isInnLike,
    isHtmlStructureToken,
    isSizeTriple,
    isHoursRange,
    isPhoneFragment,
} from "../src/services/article-filters.js";
import {
    normalizeArticleCode,
    dedupeCaseInsensitive,
} from "../src/services/article-normalizer.js";
import {
    normalizeProductName,
    stripCssTokens,
    stripUrlTail,
    stripQuoteMarker,
} from "../src/services/product-name-normalizer.js";
import { isBadProductName } from "../src/services/product-name-filters.js";

// =====================================================================
// BUG-A01 — 12-digit INN (ИП) rejected as article
// =====================================================================
test("BUG-A01: 12-digit pure numeric (ИП ИНН) rejected", () => {
    assert.equal(isInnLike("194000145952"), true);  // 12 digits = ИП ИНН
    assert.equal(isInnLike("770101123456"), true);
    assert.equal(isInnLike("7701011234"), true);    // 10 digits = юр.лицо ИНН
    assert.equal(isInnLike("123"), false);
    assert.equal(isInnLike("DNC-80-PPV-A"), false);

    // Even with hasLabel, pure 12-digit rejected
    assert.equal(
        rejectArticleCandidate("194000145952", { hasLabel: true, sourceLine: "Артикул: 194000145952" }).rejected,
        true,
        "12-digit pure numeric must be rejected even with label"
    );
});

// =====================================================================
// BUG-A02 — HTML table structure tokens (row-19, column-1, block-3...)
// =====================================================================
test("BUG-A02: HTML structure tokens rejected", () => {
    assert.equal(isHtmlStructureToken("row-19"), true);
    assert.equal(isHtmlStructureToken("column-1"), true);
    assert.equal(isHtmlStructureToken("block-3"), true);
    assert.equal(isHtmlStructureToken("cell-22"), true);
    assert.equal(isHtmlStructureToken("col-5"), true);
    assert.equal(isHtmlStructureToken("header-1"), true);
    assert.equal(isHtmlStructureToken("footer-2"), true);
    assert.equal(isHtmlStructureToken("section-7"), true);
    assert.equal(isHtmlStructureToken("group-4"), true);
    assert.equal(isHtmlStructureToken("item-9"), true);
    assert.equal(isHtmlStructureToken("wrapper-1"), true);
    assert.equal(isHtmlStructureToken("container-2"), true);

    // Not structure
    assert.equal(isHtmlStructureToken("ROW-19"), false);  // uppercase = possible SKU like ROW-19 part
    assert.equal(isHtmlStructureToken("Row-19"), false);  // mixed case = possible product
    assert.equal(isHtmlStructureToken("DNC-80-PPV-A"), false);
    assert.equal(isHtmlStructureToken("row"), false);     // no digit
    assert.equal(isHtmlStructureToken("abc-def"), false);

    // Full reject pipeline
    assert.equal(rejectArticleCandidate("row-19").rejected, true);
    assert.equal(rejectArticleCandidate("column-1").rejected, true);
});

// =====================================================================
// BUG-A03 — Size triple (80/95/70)
// =====================================================================
test("BUG-A03: size-triple NN/NN/NN rejected", () => {
    assert.equal(isSizeTriple("80/95/70"), true);
    assert.equal(isSizeTriple("40/55/80"), true);
    assert.equal(isSizeTriple("100/200/300"), true);
    assert.equal(isSizeTriple("80x95x70"), true);
    assert.equal(isSizeTriple("80×95×70"), true);
    assert.equal(isSizeTriple("40х55"), true);   // size pair, cyrillic х

    // Real SKUs with slashes must pass
    assert.equal(isSizeTriple("8579/12-506"), false);   // letter absent but dash present
    assert.equal(isSizeTriple("1114-160-318"), false);  // dashes
    assert.equal(isSizeTriple("413415.003-02"), false); // dot + dash
    assert.equal(isSizeTriple("DN50"), false);          // letters

    // 4-digit+ segments = not a size
    assert.equal(isSizeTriple("8579/1234/506"), false);

    // Full pipeline — 80/95/70 must be rejected
    assert.equal(rejectArticleCandidate("80/95/70").rejected, true);
});

// =====================================================================
// BUG-A04 — Hours pattern 00-18.00
// =====================================================================
test("BUG-A04: hours/time pattern rejected", () => {
    assert.equal(isHoursRange("00-18.00"), true);
    assert.equal(isHoursRange("09-18.00"), true);
    assert.equal(isHoursRange("9:00-18:00"), true);
    assert.equal(isHoursRange("8.30-17.30"), true);

    // Real SKUs
    assert.equal(isHoursRange("DNC-80-PPV-A"), false);
    assert.equal(isHoursRange("40-55-22"), false);  // numbers >24 not hours-range

    assert.equal(rejectArticleCandidate("00-18.00").rejected, true);
});

// =====================================================================
// BUG-A05 — Phone fragments as articles
// =====================================================================
test("BUG-A05: phone-fragment patterns rejected", () => {
    assert.equal(isPhoneFragment("915-506-04-96"), true);   // 3-3-2-2 = phone
    assert.equal(isPhoneFragment("495-123-45-67"), true);
    assert.equal(isPhoneFragment("8-800-123-45-67"), true);
    assert.equal(isPhoneFragment("+7 915 506 04 96"), true);

    // Real SKUs
    assert.equal(isPhoneFragment("H0019-0008-28"), false);  // letter prefix + dashes — legit SKU
    assert.equal(isPhoneFragment("1114-160-318"), false);   // 4-3-3 not phone shape

    assert.equal(rejectArticleCandidate("915-506-04-96").rejected, true);
});

// =====================================================================
// BUG-A06 — Dedup space/hyphen equivalent
// =====================================================================
test("BUG-A06: dedup treats MD-025-6L == MD 025-6L", () => {
    const out = dedupeCaseInsensitive(["MD-025-6L", "MD 025-6L"]);
    assert.equal(out.length, 1, `Expected 1 item after dedup, got ${out.length}: ${JSON.stringify(out)}`);

    const out2 = dedupeCaseInsensitive(["DNC-80-PPV-A", "dnc 80 ppv a", "DNC 80-PPV-A"]);
    assert.equal(out2.length, 1, `Expected 1 after dedup, got ${out2.length}: ${JSON.stringify(out2)}`);

    // Different SKUs must survive
    const out3 = dedupeCaseInsensitive(["MD-025-6L", "MD-026-6L"]);
    assert.equal(out3.length, 2);
});

// =====================================================================
// BUG-B01 — CSS tokens in title
// =====================================================================
test("BUG-B01: CSS tokens stripped from product names", () => {
    const in1 = `Бренд K0311 вставки резьбовые <span style="background-color:#ffffff;color:#000000;font-family:'times new roman';font-size:medium">`;
    const out1 = stripCssTokens(in1);
    assert.ok(!/font-family/i.test(out1), `CSS font-family must be stripped: ${out1}`);
    assert.ok(!/color\s*:\s*#/i.test(out1), `color:#xxx must be stripped: ${out1}`);
    assert.ok(!/background-color/i.test(out1), `background-color must be stripped: ${out1}`);
    assert.ok(/K0311/.test(out1), `Real content preserved: ${out1}`);

    // Standalone CSS fragments
    assert.equal(stripCssTokens("font-family:'times new roman'").trim(), "");
    assert.equal(stripCssTokens("color:#000000").trim(), "");
    assert.equal(stripCssTokens("font-size:medium").trim(), "");

    // isBadProductName should now flag these
    assert.equal(isBadProductName("font-family:'times new roman'"), true);
    assert.equal(isBadProductName("color:#000000"), true);
    assert.equal(isBadProductName("font-size:medium"), true);
});

// =====================================================================
// BUG-B02 — URL / email in title
// =====================================================================
test("BUG-B02: URL/email stripped from title", () => {
    const in1 = "SEEPEX ( https://siderus.ru/brands/seepex/ )";
    const out1 = stripUrlTail(in1);
    assert.ok(!/https?:\/\//i.test(out1), `URL must be stripped: ${out1}`);
    assert.ok(/SEEPEX/i.test(out1), `Brand name preserved: ${out1}`);

    // Pure URL line
    assert.equal(stripUrlTail("www.huntsman-nmg.com").trim(), "");

    // Angle-bracketed URL
    assert.equal(
        stripUrlTail("<https://tender.lot-online.ru/etp/app/OfferCard/>").trim(),
        ""
    );

    // Email-only
    assert.equal(stripUrlTail("info@siderus.ru ( info@siderus.ru )").trim(), "");

    // Normalizer facade
    assert.equal(
        normalizeProductName("SEEPEX ( https://siderus.ru/brands/seepex/ )"),
        "SEEPEX"
    );
});

// =====================================================================
// BUG-B03 — Quote marker prefix in title
// =====================================================================
test("BUG-B03: quote-marker prefix stripped", () => {
    assert.equal(
        stripQuoteMarker(">>: ГПС Запрос Rolls-Royce Marine").trim(),
        "ГПС Запрос Rolls-Royce Marine"
    );
    assert.equal(
        stripQuoteMarker(">> Насос-дозатор Seepex").trim(),
        "Насос-дозатор Seepex"
    );
    assert.equal(
        stripQuoteMarker("> Кольцо уплотнительное").trim(),
        "Кольцо уплотнительное"
    );

    // No quote = no change
    assert.equal(stripQuoteMarker("Насос Grundfos"), "Насос Grundfos");

    // Via normalizer facade
    assert.equal(
        normalizeProductName(">>: ГПС Запрос Rolls-Royce Marine - 2026"),
        "ГПС Запрос Rolls-Royce Marine - 2026"
    );
});
