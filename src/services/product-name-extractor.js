// product-name-extractor.js — facade pipeline for product name sanitization.
//
// Input: array of raw names (strings or objects with .name/.product_name/.descriptionRu).
// Options: { subject, maxLen=200 }
// Output: { names, primary, items, rejected }
//
// Pipeline:
//   1. Extract raw strings (handle objects)
//   2. Split multi-item strings → items[]
//   3. Normalize each item (strip HTML/PDF/contacts/qty, cap length)
//   4. Filter bad (phone/contact/doc/code-only)
//   5. Dedup (case-insensitive)
//   6. Pick primary (prefer subject match, then shortest clean)
//   7. Fallback to subject if all raw rejected

import {
    isBadProductName,
    isMultiItemList,
    isOverlong,
} from "./product-name-filters.js";
import {
    normalizeProductName,
    splitMultiItem,
    collapseWhitespace,
} from "./product-name-normalizer.js";

const DEFAULT_MAX_LEN = 200;

function toRawString(input) {
    if (typeof input === "string") return input;
    if (input && typeof input === "object") {
        return input.name || input.product_name || input.productName || input.descriptionRu || input.description || "";
    }
    return "";
}

function dedupCaseInsensitive(arr) {
    const seen = new Map();
    for (const s of arr) {
        if (typeof s !== "string" || !s.trim()) continue;
        const key = s.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key) continue;
        // Keep first occurrence (preserves order); prefer mixed-case over all-lower
        if (!seen.has(key)) {
            seen.set(key, s.trim());
        } else {
            const existing = seen.get(key);
            const hasMixed = /[A-ZА-ЯЁ]/.test(s) && /[a-zа-яё]/.test(s);
            const existingMixed = /[A-ZА-ЯЁ]/.test(existing) && /[a-zа-яё]/.test(existing);
            if (hasMixed && !existingMixed) seen.set(key, s.trim());
        }
    }
    return [...seen.values()];
}

// Cyrillic↔Latin visually-identical homoglyphs. Used to canonicalize names for dedup
// so "ОТ400U03" (cyr ОТ + lat 400U03) matches Latin article "OT400U03".
const CYR_LAT_HOMOGLYPH = {
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
    "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h",
    "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
};
function homoglyphFold(s) {
    return String(s || "").replace(/[АВЕКМНОРСТУХавекмнорстух]/g, (c) => CYR_LAT_HOMOGLYPH[c] || c);
}
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g;
function reEscape(s) { return String(s).replace(REGEX_META_RE, "\\$&"); }

function countMeaningfulTokens(s) {
    return (String(s || "").match(/[A-Za-zА-Яа-яЁё]{2,}/g) || []).length;
}

// Two canonical keys per entry:
//   baseKey     — list-num prefix + qty stripped, homoglyph-folded, lowercased
//                 (does NOT strip trailing article — keeps distinct variants distinct)
//   strippedKey — same, plus trailing article stripped (with optional "+SPEC+SPEC" chain).
//                 Used ONLY to collapse "N. Клапан Norgren V04A486l-Q116A" onto bare
//                 "Клапан Norgren" when the bare base is present in the same list.
function buildBaseCanon(value) {
    let s = collapseWhitespace(String(value || ""));
    if (!s) return "";
    // Single-level list prefix only (see product-name-normalizer.js for rationale:
    // two-level would mis-strip dates like "21.01. ").
    s = s.replace(/^\s*\d{1,3}[.)\]]\s*(?=[A-Za-zА-ЯЁа-яё])/, "");
    s = s.replace(/\s*[-–—]?\s*\d+(?:[.,]\d+)?\s*(?:шт|штук[аи]?|единиц[аы]?|компл|к-т|комплект(?:ов|а)?|пар[аы]?|pcs|pc|ea|each|units?)\.?\s*$/i, "");
    const base = homoglyphFold(s).toLowerCase().replace(/\s+/g, " ").trim();
    return base.replace(/[\s.,:;!?"'«»\-–—_+]+$/, "").trim();
}

// Try to strip trailing article (with optional +SPEC chain) from baseCanon.
// Returns the stripped canon, or null if no article matched / guard blocked strip.
// Guard: require ≥2 word tokens remaining (prevents "abb ot400u03+…" → bare "abb").
function tryStripArticle(baseCanon, articles) {
    if (!baseCanon) return null;
    for (const art of articles) {
        if (!art) continue;
        const artFolded = homoglyphFold(String(art)).toLowerCase().trim();
        if (!artFolded || artFolded.length < 3) continue;
        const artEsc = reEscape(artFolded);
        const re = new RegExp(`\\s*[-–—+]?\\s*${artEsc}(?:\\+[A-Za-z0-9.\\-]+)*\\s*$`, "i");
        if (!re.test(baseCanon)) continue;
        const candidate = baseCanon.replace(re, "").replace(/[\s.,:;!?"'«»\-–—_+]+$/, "").trim();
        if (countMeaningfulTokens(candidate) >= 2) return candidate;
    }
    return null;
}

// 2-pass canonical dedup:
//   Pass 1: collect all baseCanon keys present in the list ("base set").
//           Records with distinct baseCanon are always preserved.
//   Pass 2: if a record's trailing-article-stripped canon matches an entry in the
//           base set (i.e. some OTHER record is the naked base), collapse onto it —
//           prefer shorter original (the "naked" one) and mixed-case.
// This keeps "Фильтры SERFILCO SF10u20" + "Фильтры SERFILCO SF20u20" distinct
// (no naked "Фильтры SERFILCO" present), while still collapsing
// "Клапан Norgren" + "2. Клапан Norgren V04A486l-Q116A" onto the first.
function dedupByCanonical(arr, articles = []) {
    const entries = [];
    const baseSet = new Set();
    for (const s of arr) {
        if (typeof s !== "string" || !s.trim()) continue;
        const trimmed = s.trim();
        const base = buildBaseCanon(trimmed);
        if (!base) continue;
        entries.push({ trimmed, base });
        baseSet.add(base);
    }

    const seen = new Map();
    const pickBetter = (existing, incoming) => {
        if (!existing) return incoming;
        if (incoming.length < existing.length) return incoming;
        if (incoming.length === existing.length) {
            const incMixed = /[A-ZА-ЯЁ]/.test(incoming) && /[a-zа-яё]/.test(incoming);
            const existMixed = /[A-ZА-ЯЁ]/.test(existing) && /[a-zа-яё]/.test(existing);
            if (incMixed && !existMixed) return incoming;
        }
        return existing;
    };

    for (const { trimmed, base } of entries) {
        const stripped = tryStripArticle(base, articles);
        // Collapse onto stripped form ONLY if that stripped form exists in the base set
        // (some other record is already the naked base).
        const key = (stripped && baseSet.has(stripped)) ? stripped : base;
        seen.set(key, pickBetter(seen.get(key), trimmed));
    }
    return [...seen.values()];
}

// Pick primary: prefer a candidate that mentions a subject keyword, else shortest.
function pickPrimary(candidates, subject = "") {
    if (!candidates.length) return null;
    const subj = collapseWhitespace(subject).toLowerCase();
    const subjTokens = subj
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !/^\d+$/.test(t));

    const scored = candidates.map((c) => {
        const low = c.toLowerCase();
        let score = 0;
        // subject-alignment bonus
        for (const t of subjTokens) {
            if (low.includes(t)) score += 5;
        }
        // length preference: 12-80 chars is ideal; penalty for too short/long
        const len = c.length;
        if (len >= 12 && len <= 80) score += 4;
        else if (len >= 8 && len <= 120) score += 2;
        else if (len > 150) score -= 3;
        // brand-like capital + word combo (e.g. "Датчик VEGABAR")
        if (/[A-ZА-Я]{3,}/.test(c) && /[А-Яа-яЁё]{3,}/.test(c)) score += 2;
        // penalty for many punctuation marks (concatenated noise)
        const puncCount = (c.match(/[;,()]/g) || []).length;
        if (puncCount > 3) score -= 2;
        return { name: c, score, len };
    });
    scored.sort((a, b) => b.score - a.score || a.len - b.len);
    return scored[0].name;
}

// If subject looks like a product name, use it as fallback.
function subjectAsFallback(subject, maxLen) {
    const s = collapseWhitespace(subject || "");
    if (!s) return null;
    // Reject corporate boilerplate subjects
    if (/^(?:re|fw|fwd)[:\s]/i.test(s)) return null;
    if (isBadProductName(s)) return null;
    const normalized = normalizeProductName(s, { maxLen });
    if (!normalized) return null;
    if (isBadProductName(normalized)) return null;
    if (normalized.length < 5) return null;
    return normalized;
}

export function sanitizeProductNames(rawInputs, options = {}) {
    const maxLen = options.maxLen ?? DEFAULT_MAX_LEN;
    const subject = options.subject || "";
    const articles = Array.isArray(options.articles) ? options.articles : [];

    if (!Array.isArray(rawInputs)) {
        return { names: [], primary: null, items: [], rejected: [] };
    }

    const rejected = [];
    const accepted = [];
    const multiItems = [];

    // Step 1-2: unwrap + split multi-item
    for (const input of rawInputs) {
        const raw = toRawString(input);
        if (!raw || !raw.trim()) continue;

        // Detect multi-item and split
        if (isMultiItemList(raw)) {
            const pieces = splitMultiItem(raw);
            for (const piece of pieces) {
                multiItems.push(piece);
            }
            continue;
        }
        multiItems.push(raw);
    }

    // Step 3-4: normalize + filter
    for (const raw of multiItems) {
        const normalized = normalizeProductName(raw, { maxLen });
        if (!normalized) {
            rejected.push({ raw, reason: "empty_after_normalize" });
            continue;
        }
        if (isBadProductName(normalized)) {
            rejected.push({ raw, normalized, reason: "bad_product_name" });
            continue;
        }
        if (isOverlong(normalized, maxLen)) {
            rejected.push({ raw, normalized, reason: "overlong" });
            continue;
        }
        accepted.push(normalized);
    }

    // Step 5: dedup (canonical-aware — collapses "Клапан Norgren" with
    // "2. Клапан Norgren V04A486l-Q116A" and CYR/LAT homoglyph variants).
    const names = dedupByCanonical(accepted, articles);

    // Step 6: pick primary
    let primary = pickPrimary(names, subject);

    // Step 7: fallback to subject if nothing survived
    if (!primary) {
        const fallback = subjectAsFallback(subject, maxLen);
        if (fallback) {
            primary = fallback;
            if (!names.some((n) => n.toLowerCase() === fallback.toLowerCase())) {
                names.push(fallback);
            }
        }
    }

    return {
        names,
        primary: primary || null,
        items: names.length > 1 ? names : [],
        rejected,
    };
}
