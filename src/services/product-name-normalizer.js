// product-name-normalizer.js — strippers + normalizers for product names.
// Pipeline stages (idempotent, composable):
//   stripHtmlResidue   — tags + entities
//   stripPdfOps        — /Document, /FillIn, AcroForm, Type0, ...
//   stripContactTail   — trailing phones, "с уважением", email
//   stripQuantityTail  — trailing "- 5 шт", "10 штук", "3 pcs"
//   collapseWhitespace — \s+ → " ", trim
//   capLength          — cap at boundary, sentence-aware
//   splitMultiItem     — ; or \n separator split
//   normalizeProductName — facade: strip → collapse → cap

const DEFAULT_MAX_LEN = 200;

const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;
const HTML_ENTITY_MAP = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
};
const HTML_NUMERIC_ENTITY_RE = /&#(\d+);/g;
const HTML_NAMED_ENTITY_RE = /&[a-z]+;/gi;

const PDF_OP_RE = /\/(?:Document|FillIn|Delete|Submit\w*|AcroForm|Type\d|FirstChar|LastChar|Font\w*|Encoding|PageLayout|Outlines|Catalog|MediaBox|Contents|Producer|Creator|CreationDate|ModDate|XObject|Annot|Parent|Kids)\b\s*(?:Add\s*)?/gi;
const PDF_BARE_CHAIN_RE = /\b(?:AcroForm|Type0|FirstChar|LastChar|Encoding|Producer|MediaBox)\b/gi;

const PHONE_TAIL_RE = /\s*(?:tel|phone|mob|fax|тел|моб|факс)[:.\s]*\+?[\d()\s\-]{7,}.*$/i;
const PHONE_BARE_TAIL_RE = /\s*\+?\d[\d()\s\-]{8,}\s*$/;
const REGARDS_TAIL_RE = /\s*с\s+уважением.*$/i;

// Terminal "… 5 шт", "… 10 штук", "… 3 pcs", "… 2 ea", allowing - – — prefix
const QTY_TAIL_RE = /\s*[-–—]?\s*\d+(?:[.,]\d+)?\s*(?:шт|штук[аи]?|единиц[аы]?|компл|к-т|комплект(?:ов|а)?|пар[аы]?|pcs|pc|ea|each|units?)\.?\s*$/i;

export function stripHtmlResidue(value) {
    let s = String(value || "");
    if (!s) return "";
    s = s.replace(HTML_TAG_RE, "");
    for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
        s = s.split(entity).join(replacement);
    }
    s = s.replace(HTML_NUMERIC_ENTITY_RE, (_, code) => {
        const n = parseInt(code, 10);
        if (Number.isFinite(n) && n >= 32 && n <= 0x10ffff) {
            try { return String.fromCodePoint(n); } catch { return ""; }
        }
        return "";
    });
    s = s.replace(HTML_NAMED_ENTITY_RE, " ");
    // Collapse any whitespace introduced by tag/entity removal (idempotent)
    return s.replace(/\s+/g, " ").trim();
}

export function stripPdfOps(value) {
    let s = String(value || "");
    if (!s) return "";
    s = s.replace(PDF_OP_RE, " ");
    s = s.replace(PDF_BARE_CHAIN_RE, " ");
    s = s.replace(/CANON_PFINF_\w*/gi, " ");
    s = s.replace(/MSFT_FO_\w*/gi, " ");
    return s.replace(/\s+/g, " ").trim();
}

export function stripContactTail(value) {
    let s = String(value || "");
    if (!s) return "";
    // Apply iteratively — a string may have regards → phone chain
    let prev = "";
    let iter = 0;
    while (prev !== s && iter < 6) {
        prev = s;
        s = s.replace(PHONE_TAIL_RE, "");
        s = s.replace(REGARDS_TAIL_RE, "");
        s = s.replace(PHONE_BARE_TAIL_RE, "");
        iter++;
    }
    return s.trim();
}

export function stripQuantityTail(value) {
    let s = String(value || "");
    if (!s) return "";
    let prev = "";
    let iter = 0;
    while (prev !== s && iter < 5) {
        prev = s;
        s = s.replace(QTY_TAIL_RE, "");
        iter++;
    }
    return s.trim();
}

export function collapseWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

// Cap length at sentence/word boundary, not mid-word.
// Prefer: last sentence terminator (. ! ?) → last comma → last space → hard cut
export function capLength(value, max = DEFAULT_MAX_LEN) {
    const s = String(value || "");
    if (s.length <= max) return s;
    const slice = s.slice(0, max);
    const sentenceIdx = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (sentenceIdx > max * 0.5) return slice.slice(0, sentenceIdx + 1).trim();
    const commaIdx = slice.lastIndexOf(", ");
    if (commaIdx > max * 0.6) return slice.slice(0, commaIdx).trim();
    const spaceIdx = slice.lastIndexOf(" ");
    if (spaceIdx > max * 0.5) return slice.slice(0, spaceIdx).trim();
    return slice.trim();
}

// Split on "; " or newline. Does NOT split on inner comma (product names often contain commas).
// Returns array of non-empty items.
export function splitMultiItem(value) {
    const s = String(value || "").trim();
    if (!s) return [];
    const parts = s
        .split(/\s*(?:;|\n|\r\n)\s*/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    return parts;
}

// Facade: full pipeline on a single name, no multi-item split.
export function normalizeProductName(value, options = {}) {
    const maxLen = options.maxLen ?? DEFAULT_MAX_LEN;
    let s = String(value || "");
    if (!s) return "";
    s = stripHtmlResidue(s);
    s = stripPdfOps(s);
    s = stripContactTail(s);
    s = stripQuantityTail(s);
    s = collapseWhitespace(s);
    s = capLength(s, maxLen);
    // Trailing punctuation cleanup
    s = s.replace(/[;,.:\s\-]+$/g, "").trim();
    return s;
}
