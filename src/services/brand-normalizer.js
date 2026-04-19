// brand-normalizer.js — splitAliasBundle, canonicalizeBrand, dedupCanonical.
// Fixes TZ §3 defects: dupe surface-forms, alias bundles stored as single string.

// Split "Buerkert / Burkert / Bürkert" → ["Buerkert", "Burkert", "Bürkert"].
// Only splits on " / " (slash with surrounding whitespace) — does NOT break
// legitimate brand names containing "/" without spaces (e.g. "WTO/MAS").
export function splitAliasBundle(input) {
    if (typeof input !== "string") return [];
    const s = input.trim();
    if (!s) return [];
    // Split only on slash/bar with at least one surrounding whitespace
    const parts = s.split(/\s+[/|]\s+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) return parts;
    return [s];
}

// Canonicalize a brand using an alias→canonical map (lowercase keys).
// Returns original form if no mapping found.
export function canonicalizeBrand(brand, aliasMap) {
    if (typeof brand !== "string") return brand;
    const key = brand.trim().toLowerCase();
    if (!key) return brand;
    if (aliasMap && aliasMap.get) {
        const canonical = aliasMap.get(key);
        if (canonical) return canonical;
    }
    return brand.trim();
}

// Normalize a brand to a dedup key:
// - strip non-alnum except & and +
// - lowercase
// - collapse whitespace
function normalizeKey(brand) {
    if (typeof brand !== "string") return "";
    return brand
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}&+ ]/gu, "")
        .trim();
}

// Pick the "nicest" representative when multiple surface-forms collapse to same key.
// Priority: mixed-case > Title > ALL-UPPER.
function pickRepresentative(forms) {
    const nonEmpty = forms.filter((f) => typeof f === "string" && f.trim());
    if (nonEmpty.length === 0) return "";
    const scored = nonEmpty.map((f) => {
        const s = f.trim();
        let score = 0;
        const hasUpper = /[A-ZА-ЯЁ]/.test(s);
        const hasLower = /[a-zа-яё]/.test(s);
        const allUpper = hasUpper && !hasLower;
        const allLower = hasLower && !hasUpper;
        if (hasUpper && hasLower) score += 10; // mixed case preferred
        if (allLower) score += 3;
        if (allUpper) score += 1;
        // prefer shorter (less likely to be concatenation)
        score -= s.length * 0.01;
        return { s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].s;
}

// Dedup brand list collapsing surface-form variants that normalize to the same key.
// Picks the best-looking representative per cluster.
export function dedupCanonical(brands) {
    if (!Array.isArray(brands)) return [];
    const clusters = new Map();
    for (const b of brands) {
        if (typeof b !== "string" || !b.trim()) continue;
        const key = normalizeKey(b);
        if (!key) continue;
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key).push(b.trim());
    }
    const out = [];
    for (const [, forms] of clusters) {
        out.push(pickRepresentative(forms));
    }
    return out;
}
