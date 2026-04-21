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

// BUG-B01 — CSS declarations that leak from HTML-to-text (<span style="…">
// gets partially stripped, leaving "font-family:'times new roman'" fragments in title).
const CSS_PROPERTY_NAMES = [
    "font-family", "font-size", "font-weight", "font-style",
    "background-color", "text-decoration-color", "text-decoration-style",
    "text-indent", "text-transform", "word-spacing", "white-space",
    "letter-spacing", "line-height", "margin-\\w+", "padding-\\w+",
    "border-\\w+", "max-width", "min-width", "max-height", "min-height",
    "display", "float", "clear", "position", "overflow",
    "left", "right", "top", "bottom", "width", "height",
    "color",
].join("|");
// Capture "prop: value" where value is quoted or runs up to ; " \n or end.
// Two alternatives for value: quoted string OR unquoted run.
const CSS_DECL_RE = new RegExp(
    `\\b(?:${CSS_PROPERTY_NAMES})\\s*:\\s*(?:'[^'\\n]*'|"[^"\\n]*"|[^;"\\n]+?)\\s*(?:;|(?="|$|\\s{2,}))`,
    "gi"
);
// HTML tag or its fragment. Also catches unclosed tags <span style="…
const TAG_ANY_RE = /<\/?[a-z][^<\n]{0,400}?(?:>|$)/gi;
// Dangling `">` / `"/>` residue after CSS strip
const TAG_RESIDUE_RE = /["']?\s*\/?>/g;

// BUG-B02 — URL / bracketed-URL / email anywhere in title.
const URL_ANY_RE = /\(?\s*<?\s*https?:\/\/[^\s)>]+\s*>?\s*\)?/gi;
const WWW_URL_RE = /\(?\s*<?\s*www\.[^\s)>]+\s*>?\s*\)?/gi;
const EMAIL_ANY_RE = /\(?\s*<?\s*[\w.+\-]+@[\w.-]+\.[a-z]{2,}\s*>?\s*\)?/gi;

// BUG-B03 — Quote marker prefix from reply quoting: ">>: ", ">> ", "> "
const QUOTE_PREFIX_RE = /^\s*>+\s*[:>]?\s*/;

// Terminal "… 5 шт", "… 10 штук", "… 3 pcs", "… 2 ea", allowing - – — prefix
const QTY_TAIL_RE = /\s*[-–—]?\s*\d+(?:[.,]\d+)?\s*(?:шт|штук[аи]?|единиц[аы]?|компл|к-т|комплект(?:ов|а)?|пар[аы]?|pcs|pc|ea|each|units?)\.?\s*$/i;

// Leading numbered-list prefix: "1. ", "1.", "2) ", "3] ", glued "1.АВВ".
// Require next char to be a letter (lookahead) — keeps dimensions like "1.5A Предохранитель" intact.
// Do NOT consume two-level "N.N.": a date like "21.01. Заявка" would otherwise be mis-stripped
// into "Заявка". Two-level numbered lists ("1.1. X") are rare enough to skip; dates are common.
const LIST_NUM_PREFIX_RE = /^\s*\d{1,3}[.)\]]\s*(?=[A-Za-zА-ЯЁа-яё])/;

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

export function stripCssTokens(value) {
    let s = String(value || "");
    if (!s) return "";
    // Order: style="…" attribute first (before CSS_DECL_RE eats inner declarations
    // and leaves dangling `"/>`), then CSS decls, then tag fragments, then residue.
    s = s.replace(/\sstyle\s*=\s*["'][^"']*["']?/gi, " ");
    s = s.replace(CSS_DECL_RE, " ");
    s = s.replace(TAG_ANY_RE, " ");
    s = s.replace(TAG_RESIDUE_RE, " ");
    return s.replace(/\s+/g, " ").trim();
}

export function stripUrlTail(value) {
    let s = String(value || "");
    if (!s) return "";
    s = s.replace(URL_ANY_RE, " ");
    s = s.replace(WWW_URL_RE, " ");
    s = s.replace(EMAIL_ANY_RE, " ");
    // Leftover empty parens "( )"
    s = s.replace(/\(\s*\)/g, " ");
    return s.replace(/\s+/g, " ").trim();
}

export function stripQuoteMarker(value) {
    let s = String(value || "");
    if (!s) return "";
    let prev;
    do {
        prev = s;
        s = s.replace(QUOTE_PREFIX_RE, "");
    } while (s !== prev);
    // Forward/reply message separators: "-----Original Message-----", "---- Forwarded ----"
    s = s.replace(/^[-=]{3,}\s*(?:Original\s+Message|Forwarded(?:\s+Message)?)\s*[-=]{3,}/i, "").trim();
    return s;
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

// Strip "1. ", "2) ", "3] " and glued "1.АВВ" / "2.Клапан" numbering.
// Safe against "1.5A Предохранитель" and "24V Реле" (no list-prefix applied when next char is a digit).
export function stripListNumberPrefix(value) {
    return String(value || "").replace(LIST_NUM_PREFIX_RE, "").trim();
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
    // Quote markers must run before HTML/CSS strip: TAG_RESIDUE_RE eats bare `>`
    // and would leave ">>: title" as ": title".
    s = stripQuoteMarker(s);
    s = stripHtmlResidue(s);
    s = stripCssTokens(s);
    s = stripPdfOps(s);
    s = stripUrlTail(s);
    s = stripQuoteMarker(s);
    s = stripContactTail(s);
    s = stripQuantityTail(s);
    s = stripListNumberPrefix(s);
    s = collapseWhitespace(s);
    s = capLength(s, maxLen);
    // Trailing punctuation cleanup
    s = s.replace(/[;,.:\s\-]+$/g, "").trim();
    return s;
}
