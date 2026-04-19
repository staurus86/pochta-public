// brand-negative-filters.js — hard-negative dictionary for brand extraction.
// Tokens that LOOK like brands but ARE NOT: materials, standards, units, stopwords.
// Covers TZ §2.3 defects: "NBR, ISO, VAC, item, Single, P.A." leaking into Бренды.

// Materials (rubbers, plastics, metals, elastomers)
export const NEGATIVE_MATERIALS = new Set([
    "nbr", "epdm", "ptfe", "fkm", "viton", "hnbr", "silicon", "silicone",
    "rubber", "polyurethane", "pur", "pu", "polyamide", "nylon", "pa6", "pa66",
    "pom", "pa", "pp", "pe", "pvc", "pps", "peek", "pctfe", "aflas", "neoprene",
    // steel grades (304L/316L/321H are tech-specs, not brands)
    "aisi", "ss", "304l", "316l", "321h", "310s",
    // misc materials
    "stainless", "carbon", "brass", "bronze",
]);

// Standards & norms
export const NEGATIVE_STANDARDS = new Set([
    "iso", "din", "iec", "en", "gost", "ansi", "astm", "ul", "ce", "atex",
    "ip", "ip54", "ip65", "ip66", "ip67", "ip68",
    "rohs", "reach", "fda", "dnv", "abs", "lloyd", "csa", "nema",
    "тр", "ту", "гост",
]);

// Units / technical designators
export const NEGATIVE_UNITS = new Set([
    "vac", "vdc", "vac/vdc",
    "hz", "khz", "mhz",
    "bar", "mbar", "psi", "pa", "kpa", "mpa",
    "kw", "w", "mw", "kva", "hp",
    "v", "a", "ma", "ka",
    "mm", "cm", "m", "km",
    "kg", "g", "mg", "t",
    "rpm", "ppm",
    "°c", "°f",
    "nm",
]);

// Service words, positions, generic labels
export const NEGATIVE_STOPWORDS = new Set([
    "item", "items", "single", "double", "triple", "multi",
    "p.a.", "pa.", "n/a", "na",
    "qty", "quantity", "amount", "count", "total",
    "part", "parts", "piece", "pieces", "pcs", "pc",
    "model", "type", "serie", "series", "version",
    "new", "used", "refurbished", "original", "copy",
    "standard", "custom", "special",
    "set", "kit", "pack", "package", "box",
    "price", "cost", "sum",
    // noise letters-only placeholders
    "n", "m", "x", "y", "z",
]);

// Combined helper
const ALL_NEGATIVES = new Set([
    ...NEGATIVE_MATERIALS,
    ...NEGATIVE_STANDARDS,
    ...NEGATIVE_UNITS,
    ...NEGATIVE_STOPWORDS,
]);

// Unit pattern — numbers attached to units ("380V", "50Hz", "10Bar", "75A").
const UNIT_VALUE_RE = /^\d+(?:[.,]\d+)?\s*(?:v|vac|vdc|a|ma|ka|hz|khz|mhz|kw|w|mw|kva|hp|bar|mbar|psi|pa|kpa|mpa|mm|cm|m|km|kg|g|mg|t|rpm|ppm|°c|°f|nm)$/i;

// Strict numeric stand-alone — not a brand.
const PURE_NUMERIC_RE = /^\d+(?:[.,]\d+)?$/;

export function isNonBrandToken(token) {
    if (typeof token !== "string") return true;
    const t = token.trim();
    if (!t) return true;
    const lower = t.toLowerCase();
    if (ALL_NEGATIVES.has(lower)) return true;
    if (UNIT_VALUE_RE.test(t)) return true;
    if (PURE_NUMERIC_RE.test(t)) return true;
    // Single-char latin letter/digit — too generic
    if (t.length === 1 && /[A-Za-z0-9]/.test(t)) return true;
    return false;
}
