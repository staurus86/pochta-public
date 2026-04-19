// article-normalizer.js — normalization + dedup + descriptor/brand strip.
// Complements legacy normalizeArticleCode in email-analyzer.js but with preserved prefix rules.

const CYR_TO_LAT = {
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M",
    "О": "O", "Р": "P", "Т": "T", "Х": "X", "У": "Y", "І": "I",
};

function transliterateCyrillicInCode(value) {
    if (!value) return value;
    // Only transliterate in codes that are mostly latin (mixed-script article codes)
    let cyrCount = 0;
    let latCount = 0;
    for (const ch of value) {
        if (/[А-ЯЁ]/.test(ch)) cyrCount++;
        if (/[A-Z]/.test(ch)) latCount++;
    }
    if (cyrCount === 0 || latCount === 0) return value;
    // Mixed — translit known look-alikes
    return value.replace(/[А-ЯЁ]/g, (ch) => CYR_TO_LAT[ch] || ch);
}

// Preserve space-dash prefix like "WR- 2510GLW" → "WR-2510GLW" and "WR -2510GLW" → "WR-2510GLW"
// Also handle cyrillic М → M at the start of "МWR-..."
// Uses negative lookbehind to avoid collapsing trailing "GLW - 10" (qty) or "code - N шт"
function normalizeSpaceDashPrefix(value) {
    return value
        // LETTERS-DASH[ \t]+ALNUM  (e.g. "WR- 2510" → "WR-2510")
        .replace(/(?<![A-Za-zА-ЯЁа-яё0-9])([A-Za-zА-ЯЁа-яё]{1,4})-[ \t]+([A-Za-z0-9])/g,
            (_, prefix, rest) => `${prefix}-${rest}`)
        // LETTERS[ \t]+-ALNUM  (e.g. "WR -2510" → "WR-2510")
        .replace(/(?<![A-Za-zА-ЯЁа-яё0-9])([A-Za-zА-ЯЁа-яё]{1,4})[ \t]+-([A-Za-z0-9])/g,
            (_, prefix, rest) => `${prefix}-${rest}`);
}

// Exported for pre-candidate-generation preprocessing
export function preprocessForExtraction(text) {
    if (typeof text !== "string") return "";
    let t = text;
    // Collapse space-dash prefix (WR- 2510GLW → WR-2510GLW)
    t = normalizeSpaceDashPrefix(t);
    // Transliterate cyrillic look-alikes in code-like tokens (МWR-..., М12 excluded — handled by tech-spec filter)
    // No \b — unreliable on cyrillic↔latin boundaries.
    t = t.replace(/([А-ЯЁA-Z]{1,5}(?:-[A-Za-zА-ЯЁ0-9]+)+)/g, (token) => {
        return token.replace(/[А-ЯЁ]/g, (ch) => CYR_TO_LAT[ch] || ch);
    });
    return t;
}

export function normalizeArticleCode(value) {
    if (typeof value !== "string") return "";
    let v = value.trim();
    if (!v) return "";

    // 1. Preserve WR-/MWR- style space-dash prefix BEFORE stripping junk
    v = normalizeSpaceDashPrefix(v);

    // 2. Strip leading/trailing non-alnum (except preserved internal punctuation)
    v = v.replace(/^[^A-Za-zА-ЯЁа-яё0-9]+/, "").replace(/[^A-Za-zА-ЯЁа-яё0-9]+$/, "");

    // 3. Collapse multiple internal spaces to single space (multi-block articles)
    v = v.replace(/\s+/g, " ");

    // 4. Transliterate mixed cyr+lat tokens
    v = transliterateCyrillicInCode(v);

    return v;
}

// Strip numbering prefix ("1. ", "2) ", "1.1. ") and trailing "- N шт." / "× N шт"
export function normalizeProductName(rawLine) {
    if (typeof rawLine !== "string") return "";
    let s = rawLine.trim();

    // Strip leading numbering
    s = s.replace(/^\d{1,3}(?:[.)]\d{1,3})?[.)]\s+/, "");

    // Replace underscores with spaces (common separator in free-text lists)
    s = s.replace(/_+/g, " ");

    // Collapse double spaces
    s = s.replace(/\s{2,}/g, " ");

    // Strip trailing "- N шт." / "- N pcs" / "× N шт"
    s = s.replace(/[-–—×*]\s*\d+(?:[.,]\d+)?\s*(?:шт\.?|pcs?\.?|штук)[.\s]*$/i, "").trim();

    // Normalize space-dash prefix (TZ case: "тип WR- 2510GLW" → "тип WR-2510GLW")
    s = s.replace(/([A-Za-zА-ЯЁ]{1,4})\s*-\s+([A-Za-z0-9])/g, (_, prefix, rest) => `${prefix}-${rest}`);

    // Transliterate cyrillic in code-like tokens (e.g. МWR-5020FLWH → MWR-5020FLWH; mixed prefix cyr+lat)
    // Note: no \b — cyrillic chars aren't in \w, so \b misfires on mixed-script prefixes
    s = s.replace(/([А-ЯЁA-Z]{1,5}-[A-Za-zА-ЯЁ0-9]+)/g, (token) => {
        return token.replace(/[А-ЯЁ]/g, (ch) => CYR_TO_LAT[ch] || ch);
    });

    return s.trim();
}

// Normalize key for dedup: uppercase, strip edge punctuation, collapse spaces
function dedupKey(s) {
    if (typeof s !== "string") return "";
    return s
        .replace(/[^A-Za-zА-ЯЁа-яё0-9 \-/.]+/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[.\-/\s]+|[.\-/\s]+$/g, "")
        .trim()
        .toUpperCase();
}

export function dedupeCaseInsensitive(list) {
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
        if (typeof item !== "string" || !item.trim()) continue;
        const key = dedupKey(item);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

// Cut descriptor tails after article: "TG40-55/22285 Betriebsdaten:..." → "TG40-55/22285"
const DESCRIPTOR_TAIL_MARKERS = [
    /\s+(?:Betriebsdaten|Specification|Характеристик|Описание|Параметры)\s*[:-]/i,
    /\s+Вас\s+сообщить/i,
    /\s+(?:сообщит[ея]|уточнит[ея]|подскажит[ея])/i,
    /\s+(?:pcs?|шт|units?)\b/i,
];

export function stripDescriptorTail(token, sourceLine = "") {
    if (typeof token !== "string" || !token) return token;
    // If the source line starts with token and has descriptor tail, return token as-is.
    // Token itself usually doesn't carry the tail since it comes from extraction;
    // this function is a safety net for candidates that captured too much.
    let t = token;
    for (const marker of DESCRIPTOR_TAIL_MARKERS) {
        const m = t.match(marker);
        if (m) {
            t = t.slice(0, m.index).trim();
        }
    }
    return t;
}

// Trim trailing tech-spec fragments from multi-block capture:
//   "R 480316021 10 Bar"        → "R 480316021"
//   "R. STAHL 8579/12-506 63A 5P IP66 Ex e" → "R. STAHL 8579/12-506"
const TECH_SPEC_TAIL_RES = [
    /\s+\d+(?:[.,]\d+)?\s*(?:bar|бар|Hz|Гц|VAC|VDC|kW|W|kVA|mm|cm|V|A)$/i,
    /\s+(?:IP\s?\d{2,3}|Ex\s?[a-zа-яё]+|RS\s?\d{3,4}|M\s?\d{1,3}(?:x\d+)?|\d{3}[LHT]|\d{1,3}P)$/i,
];

export function trimTechSpecTail(s) {
    if (typeof s !== "string" || !s) return s;
    let out = s;
    for (let i = 0; i < 5; i++) {
        let changed = false;
        for (const re of TECH_SPEC_TAIL_RES) {
            const trimmed = out.replace(re, "").trim();
            if (trimmed !== out) {
                out = trimmed;
                changed = true;
            }
        }
        if (!changed) break;
    }
    return out;
}

export function stripBrandPrefix(token, knownBrands = []) {
    if (typeof token !== "string" || !token) return token;
    if (!Array.isArray(knownBrands) || knownBrands.length === 0) return token;

    // Normalize brand list: unique upper
    const brandUpper = new Set(knownBrands.map((b) => String(b).trim().toUpperCase()).filter(Boolean));

    // Try each `BRAND:` / `BRAND ` prefix
    for (const brand of brandUpper) {
        const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:.]?\\s*`, "i");
        if (re.test(token)) {
            return token.replace(re, "").trim();
        }
    }
    return token;
}
