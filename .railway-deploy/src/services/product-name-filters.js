// product-name-filters.js — hard-negative predicates for product name extraction.
// Covers business-audit defect categories:
//   - phones / contacts / hours / signatures
//   - accounting / legal / document noise
//   - PDF / HTML parser residue
//   - code-only bare SKU
//   - overlong (>200 chars)
//   - multi-item lists (3+ items)

const PHONE_RE = /(?:\+?\d[\s\-()]{0,4}){7,}/;
const TEL_LABEL_RE = /\b(?:tel|phone|mob|fax|тел|моб|факс)\b[\s:.]/i;

// Pure hours like "9.00-18.00", "9:00-18:00", optional text
const HOURS_RE = /\b\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}\b/;

// NOTE: JS \b is ASCII-only — Cyrillic word boundaries require explicit negated-letter
// lookaround. Below we use context-free matches without \b since the patterns are
// Russian-only technical terms that rarely embed in other words.
const NAME_TITLE_RE = /(?:инженер|менеджер|директор|начальник|специалист|механик|руководитель|коммерческий\s+директор|главный\s+инженер)/i;
const REGARDS_RE = /с\s+уважением/i;

// Russian legal / accounting / document keywords indicating non-product text
const DOC_RE = /(?:паспорт\s+(?:физического|гражданина)|акт\s+сверки|акт\s+выполненных|карточк[аи]\s+предприятия|реквизит[ыа]\s+(?:организации|компании)|поступление\s+на\s+расч[её]тный|расч[её]тный\s+счет|договор\s+поставки|устав\s+организации|свидетельство\s+(?:о\s+постановке|ИНН|ОГРН)|выписка\s+из\s+(?:ЕГРЮЛ|ЕГРИП))/i;
const DOC_PHYS_PERSON_RE = /если\s+контрагент\s+физическое\s+лицо/i;
const DOC_LINE_RE = /^\s*\d{1,3}[.)]\s*(?:поступление|списание|начисление|оплата|платеж|платёж|акт|договор|реквизит)/i;

// PDF operator / form residue
const PDF_OPS_RE = /\/(?:Document|FillIn|Delete|Submit\w*|AcroForm|Type\d|FirstChar|LastChar|Font\w*|Encoding|PageLayout|Outlines|Catalog|MediaBox|Contents|Producer|Creator|CreationDate|ModDate|Subj|Subject|Keywords|Title|Author|XObject|Annot|Parent|Kids)\b/;
const PDF_CANON_RE = /CANON_PFINF_|MSFT_FO_/i;
const PDF_MULTI_OPS_RE = /\/\w+\s+\/\w+\s+\/\w+/; // 3+ slash-ops in a row
const PDF_BARE_TOKEN_CHAIN_RE = /\b(?:AcroForm|Type0|FirstChar|LastChar|Encoding|Producer)\b/i;

// HTML residue
const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;
const HTML_ENTITY_RE = /&(?:[a-z]+|#\d+);/i;
const WORD_META_RE = /\b(?:WordSection\d*|page:\s*\w+|XMP\.IID|o:p\s*\/?|mso-\w+|style=["'][^"']*["'])/i;

// Code-only: no letters in "word" form, or very short alnum with no Cyrillic
// Allow things like "VK/A-02/20" but reject "4.5015-24" (no product noun letters)
// A code is code-only if after stripping digits, dots, slashes, hyphens it leaves
// no letter sequence ≥3 chars.
const LETTER_RUN_RE = /[A-Za-zА-Яа-яЁё]{3,}/;

const MAX_LENGTH = 200;

// 3+ items (2 separators of ; or \n) between non-empty fragments
function countItemSeparators(text) {
    const parts = String(text || "")
        .split(/\s*[;\n]\s*/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return parts.length;
}

export function isPhoneLike(value) {
    const s = String(value || "");
    if (!s) return false;
    if (TEL_LABEL_RE.test(s)) return true;
    // Strip out obviously non-phone tokens; test a digit-dense substring
    const digits = s.replace(/[^\d]/g, "");
    if (digits.length >= 9 && PHONE_RE.test(s)) {
        // But guard against strings with substantial non-phone letter content
        // (e.g. "Клапан DN50 PN16" has letters and short digit runs).
        const letterRuns = (s.match(/[А-Яа-яA-Za-zЁё]{3,}/g) || []);
        // If there are multiple letter-runs AND the digit block is embedded mid-string,
        // it is NOT phone-only.
        if (letterRuns.length >= 2 && digits.length < 11) return false;
        return true;
    }
    return false;
}

export function isContactLike(value) {
    const s = String(value || "");
    if (!s) return false;
    if (HOURS_RE.test(s)) return true;
    if (NAME_TITLE_RE.test(s) && /\+?\d/.test(s)) return true;
    if (NAME_TITLE_RE.test(s) && /[А-Я][а-я]+\s+[А-Я][а-я]+/.test(s)) return true;
    if (REGARDS_RE.test(s)) return true;
    return false;
}

export function isDocumentLike(value) {
    const s = String(value || "");
    if (!s) return false;
    if (DOC_RE.test(s)) return true;
    if (DOC_PHYS_PERSON_RE.test(s)) return true;
    if (DOC_LINE_RE.test(s)) return true;
    return false;
}

export function isPdfOpsLike(value) {
    const s = String(value || "");
    if (!s) return false;
    if (PDF_CANON_RE.test(s)) return true;
    if (PDF_MULTI_OPS_RE.test(s)) return true;
    if (PDF_OPS_RE.test(s)) return true;
    // Multiple bare PDF tokens without slashes ("AcroForm Type0 FirstChar LastChar")
    const bareMatches = s.match(/\b(?:AcroForm|Type0|FirstChar|LastChar|Encoding|Producer)\b/gi);
    if (bareMatches && bareMatches.length >= 2) return true;
    return false;
}

export function isHtmlResidueLike(value) {
    const s = String(value || "");
    if (!s) return false;
    if (HTML_TAG_RE.test(s)) return true;
    if (HTML_ENTITY_RE.test(s)) return true;
    if (WORD_META_RE.test(s)) return true;
    return false;
}

export function isCodeOnly(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    // If there is a letter-run ≥3 chars (likely product noun), not code-only
    if (LETTER_RUN_RE.test(s)) {
        // But single all-caps acronym in isolation like "EA4073" — if the ONLY
        // letter-run is embedded in a code pattern, still code-only
        const stripped = s.replace(/[\d.\-/]+/g, " ").replace(/\s+/g, " ").trim();
        // "EA4073" -> "EA" (len 2, rejected by LETTER_RUN_RE but still made it in).
        // Handle this separately: if stripped has no letter-run ≥3, it's code-only.
        if (!LETTER_RUN_RE.test(stripped)) return true;
        return false;
    }
    // No letter runs at all => definitely code-only
    return true;
}

export function isOverlong(value, max = MAX_LENGTH) {
    return String(value || "").length > max;
}

export function isMultiItemList(value) {
    return countItemSeparators(value) >= 3;
}

export function isBadProductName(value) {
    const s = String(value || "").trim();
    if (!s) return true;
    if (s.length < 3) return true;
    if (isPhoneLike(s)) return true;
    if (isContactLike(s)) return true;
    if (isDocumentLike(s)) return true;
    if (isPdfOpsLike(s)) return true;
    if (isHtmlResidueLike(s)) return true;
    if (isCodeOnly(s)) return true;
    return false;
}
