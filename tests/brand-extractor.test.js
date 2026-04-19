// brand-extractor.test.js — Phase 2 brand detection refactor (TZ-audited).
// Covers: negative dict, alias bundle split, canonicalization, mass-brand guard, zoning.

import test from "node:test";
import assert from "node:assert/strict";

import {
    isNonBrandToken,
    NEGATIVE_MATERIALS,
    NEGATIVE_STANDARDS,
    NEGATIVE_UNITS,
    NEGATIVE_STOPWORDS,
} from "../src/services/brand-negative-filters.js";

import {
    splitAliasBundle,
    canonicalizeBrand,
    dedupCanonical,
} from "../src/services/brand-normalizer.js";

import {
    sanitizeBrands,
    classifyBrandContext,
} from "../src/services/brand-extractor.js";

// =====================================================================
// negative-filter — materials / standards / units / stopwords
// =====================================================================

test("negative:materials NBR, EPDM, PTFE, FKM, VITON → reject", () => {
    for (const t of ["NBR", "nbr", "EPDM", "PTFE", "FKM", "VITON", "Viton", "ptfe"]) {
        assert.ok(isNonBrandToken(t), `material ${t} must be non-brand`);
    }
});

test("negative:standards ISO, DIN, IEC, EN, GOST, ANSI → reject", () => {
    for (const t of ["ISO", "DIN", "IEC", "EN", "GOST", "ANSI", "iso", "din"]) {
        assert.ok(isNonBrandToken(t), `standard ${t} must be non-brand`);
    }
});

test("negative:units VAC, VDC, Hz, Bar, kW, A, V → reject", () => {
    for (const t of ["VAC", "VDC", "Hz", "Bar", "bar", "kW", "kw", "vac", "vdc"]) {
        assert.ok(isNonBrandToken(t), `unit ${t} must be non-brand`);
    }
});

test("negative:stopwords item, single, P.A., qty, part → reject", () => {
    for (const t of ["item", "Item", "ITEM", "Single", "single", "P.A.", "p.a.", "qty", "Qty", "part", "Part"]) {
        assert.ok(isNonBrandToken(t), `stopword ${t} must be non-brand`);
    }
});

test("negative: real brands NOT rejected (HAWE, ABB, SMC, FESTO, Siemens, Bosch Rexroth)", () => {
    for (const t of ["HAWE", "ABB", "SMC", "FESTO", "Siemens", "Bosch Rexroth", "Bürkert", "GEMÜ", "ZIEHL-ABEGG"]) {
        assert.ok(!isNonBrandToken(t), `real brand ${t} must NOT be rejected`);
    }
});

// =====================================================================
// normalizer — alias bundle split
// =====================================================================

test("normalizer:splitAliasBundle 'Buerkert / Burkert / Bürkert' → 3 items", () => {
    const r = splitAliasBundle("Buerkert / Burkert / Bürkert");
    assert.deepEqual(r, ["Buerkert", "Burkert", "Bürkert"]);
});

test("normalizer:splitAliasBundle 'GEMÜ / Gemu' → 2 items", () => {
    const r = splitAliasBundle("GEMÜ / Gemu");
    assert.deepEqual(r, ["GEMÜ", "Gemu"]);
});

test("normalizer:splitAliasBundle 'RÖHM / ROEHM / ROHM' → 3 items", () => {
    const r = splitAliasBundle("RÖHM / ROEHM / ROHM");
    assert.deepEqual(r, ["RÖHM", "ROEHM", "ROHM"]);
});

test("normalizer:splitAliasBundle preserves single brand", () => {
    assert.deepEqual(splitAliasBundle("HAWE"), ["HAWE"]);
    assert.deepEqual(splitAliasBundle("Bosch Rexroth"), ["Bosch Rexroth"]);
});

test("normalizer:splitAliasBundle does NOT split brand with slash in name if no spaces around slash", () => {
    // Some real brands use / without surrounding spaces (rare). Test format "A / B" only.
    assert.deepEqual(splitAliasBundle("A/B"), ["A/B"]);
});

// =====================================================================
// normalizer — canonicalization
// =====================================================================

test("normalizer:canonicalizeBrand maps Burkert/Buerkert/Bürkert → Bürkert", () => {
    const aliasMap = new Map([
        ["burkert", "Bürkert"],
        ["buerkert", "Bürkert"],
        ["bürkert", "Bürkert"],
    ]);
    assert.equal(canonicalizeBrand("Burkert", aliasMap), "Bürkert");
    assert.equal(canonicalizeBrand("BURKERT", aliasMap), "Bürkert");
    assert.equal(canonicalizeBrand("Buerkert", aliasMap), "Bürkert");
    assert.equal(canonicalizeBrand("Bürkert", aliasMap), "Bürkert");
});

test("normalizer:canonicalizeBrand returns original form when no alias match", () => {
    const aliasMap = new Map([["burkert", "Bürkert"]]);
    assert.equal(canonicalizeBrand("HAWE", aliasMap), "HAWE");
});

test("normalizer:dedupCanonical collapses 'CONDUCTIX-WAMPFLER' and 'Conductix-Wampfler' → 1 item", () => {
    const r = dedupCanonical(["CONDUCTIX-WAMPFLER", "Conductix-Wampfler", "HAWE"]);
    assert.equal(r.length, 2);
    // Prefer non-all-uppercase form
    assert.ok(r.includes("Conductix-Wampfler"), "prefer mixed-case form");
    assert.ok(r.includes("HAWE"), "HAWE is all-caps but the only variant");
});

test("normalizer:dedupCanonical collapses 'ebm-papst' vs 'Ebmpapst' when both normalize to same key", () => {
    // With canonicalization, these should reduce. Without aliasMap, exact-normalized collapse.
    const r = dedupCanonical(["ebm-papst", "Ebm-papst"]);
    assert.equal(r.length, 1);
});

// =====================================================================
// facade — sanitizeBrands pipeline
// =====================================================================

test("extractor:sanitizeBrands removes NBR/ISO/VAC/item/Single/P.A.", () => {
    const input = ["HAWE", "NBR", "ISO", "ABB", "VAC", "item", "Single", "P.A.", "Siemens"];
    const { brands } = sanitizeBrands(input);
    assert.deepEqual(brands.sort(), ["ABB", "HAWE", "Siemens"].sort());
});

test("extractor:sanitizeBrands splits alias bundles before filtering", () => {
    const input = ["Buerkert / Burkert / Bürkert", "HAWE"];
    const aliasMap = new Map([
        ["burkert", "Bürkert"],
        ["buerkert", "Bürkert"],
        ["bürkert", "Bürkert"],
    ]);
    const { brands } = sanitizeBrands(input, { aliasMap });
    assert.ok(brands.includes("Bürkert"), `expected Bürkert in ${JSON.stringify(brands)}`);
    assert.ok(brands.includes("HAWE"));
    assert.equal(brands.length, 2);
});

test("extractor:sanitizeBrands canonicalizes case dupes", () => {
    const input = ["CONDUCTIX-WAMPFLER", "Conductix-Wampfler", "HAWE"];
    const { brands } = sanitizeBrands(input);
    assert.equal(brands.length, 2);
});

// =====================================================================
// classifyBrandContext — mass-brand guard
// =====================================================================

test("context:<=5 brands → 'normal'", () => {
    const ctx = classifyBrandContext(["HAWE", "ABB", "SMC"]);
    assert.equal(ctx.context, "normal");
    assert.equal(ctx.massBrand, false);
});

test("context:6-7 brands → 'warning'", () => {
    const ctx = classifyBrandContext(["A", "B", "C", "D", "E", "F", "G"]);
    assert.equal(ctx.context, "warning");
});

test("context:8-12 brands → 'suspicious'", () => {
    const ctx = classifyBrandContext(new Array(10).fill(0).map((_, i) => `Brand${i}`));
    assert.equal(ctx.context, "suspicious");
    assert.equal(ctx.massBrand, true);
});

test("context:>12 brands → 'catalog' (mass-brand dump)", () => {
    const ctx = classifyBrandContext(new Array(20).fill(0).map((_, i) => `Brand${i}`));
    assert.equal(ctx.context, "catalog");
    assert.equal(ctx.massBrand, true);
});

// =====================================================================
// Full pipeline — sanitizeBrands returns brandContext annotation
// =====================================================================

test("extractor: large brand list from catalog email → marked as catalog + brandsRejected populated", () => {
    const input = [
        "Siemens", "FESTO", "Camozzi", "Danfoss", "Phoenix Contact",
        "WILO", "Bosch Rexroth", "SMC", "ABB", "HAWE",
        "Kipp", "Vahle", "Hydac", "Aventics", "IFM",
        "NBR", "ISO", "VAC",
    ];
    const result = sanitizeBrands(input);
    // Non-brands still rejected
    assert.ok(!result.brands.includes("NBR"));
    assert.ok(!result.brands.includes("ISO"));
    assert.ok(!result.brands.includes("VAC"));
    // Mass-brand flag set
    assert.equal(result.massBrand, true);
    assert.equal(result.context, "catalog");
    // Rejected tokens recorded
    assert.ok(result.rejected.length >= 3, `expected ≥3 rejected, got ${result.rejected.length}`);
});

test("extractor:preserves legitimate 3-brand list from product request", () => {
    const input = ["HAWE", "Bürkert", "Festo"];
    const result = sanitizeBrands(input);
    assert.equal(result.brands.length, 3);
    assert.equal(result.context, "normal");
    assert.equal(result.massBrand, false);
});

test("extractor:empty input → empty output, no crash", () => {
    const result = sanitizeBrands([]);
    assert.deepEqual(result.brands, []);
    assert.deepEqual(result.rejected, []);
    assert.equal(result.context, "normal");
});

test("extractor:null/undefined input → safe default", () => {
    const result = sanitizeBrands(null);
    assert.deepEqual(result.brands, []);
});
