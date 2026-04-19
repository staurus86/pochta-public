// brand-extractor.js — facade pipeline for brand sanitization.
// Input: raw brand list (from detectBrands / projectBrands / lead.detectedBrands).
// Output: { brands, rejected, context, massBrand }.
//
// Pipeline:
//   1. splitAliasBundle — "Buerkert / Burkert / Bürkert" → 3 items
//   2. isNonBrandToken — strip materials / standards / units / stopwords
//   3. canonicalizeBrand — apply alias→canonical map (from KB)
//   4. dedupCanonical — collapse case/surface-form variants
//   5. classifyBrandContext — mass-brand guard

import { isNonBrandToken } from "./brand-negative-filters.js";
import {
    splitAliasBundle,
    canonicalizeBrand,
    dedupCanonical,
} from "./brand-normalizer.js";

// Thresholds for mass-brand context detection (TZ §8).
const MASS_BRAND_WARNING = 6;      // 6-7 brands: warning
const MASS_BRAND_SUSPICIOUS = 8;   // 8-12 brands: suspicious, likely capability list
const MASS_BRAND_CATALOG = 13;     // 13+ brands: catalog/brand-dump

export function classifyBrandContext(brands) {
    const n = Array.isArray(brands) ? brands.length : 0;
    if (n >= MASS_BRAND_CATALOG) return { context: "catalog", massBrand: true, count: n };
    if (n >= MASS_BRAND_SUSPICIOUS) return { context: "suspicious", massBrand: true, count: n };
    if (n >= MASS_BRAND_WARNING) return { context: "warning", massBrand: false, count: n };
    return { context: "normal", massBrand: false, count: n };
}

// Main facade: clean a raw brand list.
// options.aliasMap — Map<lowercase_alias, canonical_brand> from detection-kb.
export function sanitizeBrands(rawBrands, options = {}) {
    const aliasMap = options.aliasMap || null;

    if (!Array.isArray(rawBrands)) {
        return { brands: [], rejected: [], context: "normal", massBrand: false, count: 0 };
    }

    // 1. Split alias bundles
    const split = [];
    for (const b of rawBrands) {
        if (typeof b !== "string") continue;
        for (const piece of splitAliasBundle(b)) {
            split.push(piece);
        }
    }

    // 2. Negative filter
    const rejected = [];
    const filtered = [];
    for (const b of split) {
        if (isNonBrandToken(b)) {
            rejected.push(b);
            continue;
        }
        filtered.push(b);
    }

    // 3. Canonicalize (if aliasMap provided)
    const canonicalized = filtered.map((b) => canonicalizeBrand(b, aliasMap));

    // 4. Dedup
    const deduped = dedupCanonical(canonicalized);

    // 5. Classify context
    const ctx = classifyBrandContext(deduped);

    return {
        brands: deduped,
        rejected,
        context: ctx.context,
        massBrand: ctx.massBrand,
        count: ctx.count,
    };
}
