// article-filters.js — hard negative filters for article extraction (TZ §5).
// Each filter is a pure predicate returning true when the token must NOT become an article.
// `rejectArticleCandidate` aggregates them and returns { rejected, reason }.

const HTML_WORD_META_RE = /^(?:page:)?WORDSECTION\d+$|^page:WORDSECTION/i;
const XMP_IID_RE = /^XMP\.[A-Z]+[:#]/i;
const FS_CODE_RE = /^FS\d+$/i;
const IROW_CODE_RE = /^IROW\d+$/i;
const CID_RE = /^cid:/i;
const MAILTO_RE = /^mailto:/i;
const URL_LIKE_RE = /^https?:\/\/|^www\./i;
const EMAIL_LIKE_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/;

export function isHtmlWordMetadata(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    if (HTML_WORD_META_RE.test(t)) return true;
    if (XMP_IID_RE.test(t)) return true;
    if (FS_CODE_RE.test(t)) return true;
    if (IROW_CODE_RE.test(t)) return true;
    if (CID_RE.test(t)) return true;
    if (MAILTO_RE.test(t)) return true;
    if (URL_LIKE_RE.test(t)) return true;
    if (EMAIL_LIKE_RE.test(t)) return true;
    return false;
}

const FILENAME_EXT_RE = /\.(?:jpe?g|png|gif|bmp|tiff?|pdf|docx?|xlsx?|pptx?|rtf|csv|txt|zip|rar|7z|html?|xml)(?:$|\.)/i;

export function isFilenameLike(token) {
    if (typeof token !== "string" || !token) return false;
    return FILENAME_EXT_RE.test(token.trim());
}

const TIME_HMS_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const DATE_DMY_RE = /^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/;
const YEAR_ONLY_RE = /^(?:19|20)\d{2}$/;
const MONTH_YEAR_RE = /^\d{1,2}[.\-/](?:19|20)\d{2}$/;

export function isDateTime(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    if (TIME_HMS_RE.test(t)) return true;
    if (DATE_DMY_RE.test(t)) return true;
    if (YEAR_ONLY_RE.test(t)) return true;
    if (MONTH_YEAR_RE.test(t)) return true;
    return false;
}

// TZ §5.4 — tech specs: IP class, interfaces, steel grades, Hz/Bar, thread sizes, ranges
const TECH_SPEC_RES = [
    /^IP\s?\d{2,3}$/i,                  // IP54, IP65, IP 44
    /^RS\s?\d{3,4}$/i,                  // RS485, RS232
    /^\d{3}[LHT]$/i,                    // 304L, 316L (steel grades)
    /^\d+\s?(?:Hz|Гц)$/i,               // 50Hz, 60 Hz
    /^\d+(?:[.,]\d+)?\s?(?:bar|бар)$/i, // 10 Bar, 2.5 bar
    /^M\s?\d{1,3}(?:x\d+)?$/i,          // M12, M20x2
    /^\d+\s?-\s?\d+$/,                  // 0-600, 4-1/2 (ranges)
    /^\d+-\d+\/\d+$/,                   // 4-1/2
    /^\d+(?:[.,]\d+)?\s*(?:mm|cm|м|kg|g|A|V|VAC|VDC|kW|W|kVA)$/i,
    /^\d{1,3}P$/,                        // 5P, 3P (poles)
    /^Ex\s?[a-z]+$/i,                   // Ex e, Ex d (ATEX)
];

export function isTechSpec(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    for (const re of TECH_SPEC_RES) {
        if (re.test(t)) return true;
    }
    return false;
}

// Refrigerant codes (HHR sample): R22, R134A, R404A, R407C, R410A, R32
const REFRIGERANT_RE = /^R\d{2,3}[A-Z]?$/;

export function isRefrigerantCode(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim().toUpperCase();
    if (!REFRIGERANT_RE.test(t)) return false;
    // Exclude multi-block articles with R-prefix + space ("R 480316021")
    if (t.includes(" ")) return false;
    // Must be short (R + 2-3 digits + optional letter)
    return t.length <= 5;
}

// Section numbering: dotted codes of the form 1.2.3 or 1.2.3.4 with ≥2 segments
// Only reject when context indicates document structure (many sibling entries).
const SECTION_NUMBER_RE = /^\d{1,2}(?:\.\d{1,3}){2,4}$/;

export function isSectionNumbering(token, ctx = {}) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    if (!SECTION_NUMBER_RE.test(t)) return false;
    // Only reject if there is document-structure context (≥3 sibling section numbers).
    if (ctx.sectionCount && ctx.sectionCount >= 3) return true;
    // Also reject when first segment is small (1.3.1 more likely section than catalog code 88.1.82.9.02)
    const first = parseInt(t.split(".")[0], 10);
    const segments = t.split(".").length;
    if (first <= 20 && segments === 3 && ctx.sectionCount >= 1) return true;
    return false;
}

const DESC_PREFIX_RE = /^DESC[:#-]/i;
// Slug pattern: lowercase kebab-case with ≥4 segments (catalog slug) or ru-latin mix
const LONG_SLUG_RE = /^[a-z]+(?:-[a-z]+){3,}$/;
const LATIN_RU_MIX_SLUG_RE = /^(?:[a-zа-яё]+-){2,}[a-zа-яё]+$/;

export function isDescriptorSlug(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    if (DESC_PREFIX_RE.test(t)) return true;
    if (LONG_SLUG_RE.test(t)) return true;
    if (LATIN_RU_MIX_SLUG_RE.test(t) && !/\d/.test(t)) return true;
    return false;
}

// OCR noise: random mixed-case alnum with no clear SKU structure.
// Heuristics focus on tokens WITHOUT dash separators (structural SKUs have dashes).
export function isOCRNoise(token) {
    if (typeof token !== "string" || !token) return false;
    const t = token.trim();
    if (t.length < 4 || t.length > 20) return false;

    // Obvious SKU patterns with dash/slash must pass (DNC-80-PPV-A, QIT3-5033, G392-012-000-002, CLS15E-B1A3A)
    // Case-sensitive: real SKUs are uppercase; mixed-case like U8qRi-I is noise.
    if (/^[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)+$/.test(t)) return false;

    // Pattern: repeated dots/commas ("Rloe5....1Muo5F")
    if (/\.{2,}/.test(t)) return true;

    const hasLetter = /[A-Za-z]/.test(t);
    const hasDigit = /\d/.test(t);
    if (!hasLetter || !hasDigit) return false;

    // Count case transitions (upper↔lower)
    let transitions = 0;
    // Count type transitions (digit↔letter, upper↔lower)
    let typeTrans = 0;
    const typeOf = (ch) => (/\d/.test(ch) ? "d" : /[a-z]/.test(ch) ? "l" : /[A-Z]/.test(ch) ? "u" : "o");
    for (let i = 1; i < t.length; i++) {
        const a = t[i - 1];
        const b = t[i];
        if (/[a-z]/.test(a) && /[A-Z]/.test(b)) transitions++;
        if (/[A-Z]/.test(a) && /[a-z]/.test(b)) transitions++;
        if (typeOf(a) !== typeOf(b)) typeTrans++;
    }

    // Pattern "q.yna8jiy" / "aeb2.Ew50" — has dot or slash with mixed case/type
    if (/[./]/.test(t) && (transitions >= 1 || typeTrans >= 3) && t.length <= 12) return true;

    // Pattern "U8qRi-I" — dash with mixed case transitions ≥2 and short segments
    if (/-/.test(t) && transitions >= 2 && t.length <= 10) {
        const segments = t.split(/-/);
        if (segments.every((s) => s.length <= 5)) return true;
    }

    // No separator + mixed case transitions (9pnr0X, 8vjolR, Rloe5)
    if (!/[-/.]/.test(t) && transitions >= 1 && t.length <= 10) {
        // Exclude standard SKU patterns like "QIT35033" (2-6 letters then digits)
        if (!/^[A-Z]{2,6}\d{2,8}[A-Z]{0,6}$/i.test(t)) return true;
    }

    // No separator + many type transitions (digit-letter-digit-letter): 9pnr0X, 4a3B2c
    if (!/[-/.]/.test(t) && typeTrans >= 3 && t.length <= 10) {
        if (!/^[A-Z]{2,6}\d{2,8}[A-Z]{0,6}$/i.test(t)) return true;
    }

    // Pure uppercase random "AY3DZAR" (7 chars, letters+digits intermixed, no clear split)
    if (t.length >= 5 && t.length <= 10 && /^[A-Z0-9]+$/.test(t) && !/-/.test(t)) {
        // Allow standard prefix+digit pattern
        if (/^[A-Z]{2,6}\d{2,8}[A-Z]{0,6}$/.test(t)) return false;
        // Reject intermixed random
        const digitCount = (t.match(/\d/g) || []).length;
        if (digitCount >= 1 && digitCount <= 2 && t.length >= 6) {
            const letters = t.replace(/\d/g, "");
            // Random if letters don't form a clean prefix (digits are in the middle)
            if (!/^\d+$/.test(t.slice(0, digitCount)) && !/^[A-Z]+\d+$/.test(t)) {
                return true;
            }
        }
    }

    return false;
}

const STRONG_LABEL_RE = /\b(?:part\s*number|manufacturer\s*part\s*number|mpn|p\/n|pn|арт\.?|артикул|каталож(?:ный|ного)\s+номер|код\s+товара)\b/i;
const PURE_NUMERIC_RE = /^\d+$/;

// Aggregate reject. Returns { rejected: bool, reason: string }.
// Context: { hasLabel?: bool, sectionCount?: number, sourceLine?: string }
export function rejectArticleCandidate(token, context = {}) {
    if (typeof token !== "string" || !token.trim()) {
        return { rejected: true, reason: "empty" };
    }

    if (isHtmlWordMetadata(token)) return { rejected: true, reason: "html_word_meta" };
    if (isFilenameLike(token)) return { rejected: true, reason: "filename" };
    if (isDateTime(token)) return { rejected: true, reason: "datetime" };
    if (isTechSpec(token)) return { rejected: true, reason: "tech_spec" };
    if (isRefrigerantCode(token)) return { rejected: true, reason: "refrigerant" };
    if (isSectionNumbering(token, context)) return { rejected: true, reason: "section_numbering" };
    if (isDescriptorSlug(token)) return { rejected: true, reason: "descriptor_slug" };
    if (isOCRNoise(token)) return { rejected: true, reason: "ocr_noise" };

    // TZ Rule 1: pure numeric without strong context → reject
    const t = token.trim();
    if (PURE_NUMERIC_RE.test(t)) {
        const hasLabel = Boolean(context.hasLabel);
        const hasStrongLabel = context.sourceLine ? STRONG_LABEL_RE.test(context.sourceLine) : false;
        if (!hasLabel && !hasStrongLabel) {
            return { rejected: true, reason: "pure_numeric_no_context" };
        }
        // Year-like even with label → reject
        if (YEAR_ONLY_RE.test(t)) return { rejected: true, reason: "year_like" };
    }

    return { rejected: false, reason: "" };
}
