// phone-extractor.js — facade for Phone extraction.
// Priority cascade: form_fields > signature > current_message > contact_lines >
//                   company_blob (misplacement recovery) > quoted_thread >
//                   template_footer > sender_header.
// Output: { primary, alt, ext, type, country, isMobile, isLandline, isFax,
//           source, confidence, needsReview, recoveredFromCompany,
//           rawCandidates[], rejected[] }

import {
    isInnLike,
    isOgrnLike,
    isKppLike,
    isBankAccountLike,
    isPostalCodeLike,
    isArticleLike,
    isDateLike,
    isRiskyShort,
    isPhoneDigitCountValid,
    classifyRejectionReason,
} from "./phone-filters.js";
import {
    stripExtension,
    stripLabel,
    canonicalToPlus7,
    normalizeBareDigits,
    classifyMobileLandline,
    classifyCountry,
    normalizeIntl,
} from "./phone-normalizer.js";

const SOURCE_CONFIDENCE = {
    form: 0.95,
    signature: 0.9,
    current_message: 0.8,
    contact_lines: 0.75,
    company_blob: 0.6,
    quoted_thread: 0.55,
    template_footer: 0.4,
    sender_header: 0.35,
};

// RU phone pattern — must include "+" or "8" or bare 10+ digit sequences
// with clear separators. The extension fragment is optional.
// We capture a broad match; normalization decides if it's valid.
const RU_PHONE_RE = /(?:\+7|8)[\s().\-]*\d{3,5}[\s().\-]*\d{2,4}[\s().\-]*\d{2,4}[\s().\-]*\d{0,4}(?:[,.\s;:]+(?:доб|ext|вн|внутр|extension|x)\.?\s*\d{1,6})?/gi;
const BARE_10_RE = /(?<![\d+])\d{10}(?![\d])/g;
const INTL_PHONE_RE = /\+(?!7[\s(.\-]*\d)\d{1,3}[\s().\-]*\d{1,4}(?:[\s().\-]*\d{2,4}){1,4}/g;
// Bare parenthesized: "(3812) 606-23-22" — 4-5 digit code + subscriber.
const PAREN_LOCAL_RE = /\(\d{3,5}\)\s*\d{2,4}[\s().\-]*\d{2,4}[\s().\-]*\d{0,4}/g;

// Label-aware line patterns — capture label + rest-of-line.
// We use these in line-scan mode so we can attach the label's type to the
// phone found on the same line.
const LABEL_LINE_RE = /(?:^|[\s;,])((?:т\/ф|тел\.?\s*\/\s*факс|tel\s*\/\s*fax|phone\s*\/\s*fax|факс|fax|fx|тел|моб|mob|mobile|cell|phone|тлф)[.:]?)\s*([^\n]*)/gi;

function safeString(v) {
    if (v == null) return "";
    return String(v);
}

function digitsOnly(s) {
    return String(s || "").replace(/\D/g, "");
}

function collectRawCandidates(text) {
    const out = [];
    if (!text) return out;
    const seenSpans = new Set();

    const push = (match, kind, labelType) => {
        const value = match[0];
        const start = match.index;
        const end = start + value.length;
        const span = `${start}-${end}`;
        if (seenSpans.has(span)) return;
        seenSpans.add(span);
        out.push({ value: value.trim(), start, end, kind, labelType: labelType || "unknown" });
    };

    let m;
    RU_PHONE_RE.lastIndex = 0;
    while ((m = RU_PHONE_RE.exec(text))) push(m, "ru");
    INTL_PHONE_RE.lastIndex = 0;
    while ((m = INTL_PHONE_RE.exec(text))) push(m, "intl");
    PAREN_LOCAL_RE.lastIndex = 0;
    while ((m = PAREN_LOCAL_RE.exec(text))) push(m, "paren");
    BARE_10_RE.lastIndex = 0;
    while ((m = BARE_10_RE.exec(text))) push(m, "bare10");

    return out;
}

// Scan lines for explicit label → attach label type to any phone on same line.
function applyLineLabels(text, candidates) {
    if (!text || candidates.length === 0) return;
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (const line of lines) {
        const lineStart = offset;
        const lineEnd = offset + line.length;
        offset = lineEnd + 1; // +1 for \n

        const { type } = stripLabel(line);
        if (type === "unknown") continue;

        for (const c of candidates) {
            if (c.start >= lineStart && c.end <= lineEnd) {
                // Only upgrade if we still have unknown; don't overwrite.
                if (c.labelType === "unknown") c.labelType = type;
            }
        }
    }
}

// Process a raw candidate into a normalized record. Returns null if rejected.
function processCandidate(rawCand, source, personHint, companyHint) {
    const raw = safeString(rawCand.value).trim();
    if (!raw) return { rejected: { value: raw, source, reason: "empty" } };

    const extSplit = stripExtension(raw);
    let main = extSplit.main;
    const ext = extSplit.ext;

    const labelSplit = stripLabel(main);
    main = labelSplit.value || main;
    let type = rawCand.labelType && rawCand.labelType !== "unknown"
        ? rawCand.labelType
        : labelSplit.type;

    // Requisite rejection based on bare digit appearance (no +/() separators).
    const reason = classifyRejectionReason(main);
    if (reason) {
        return { rejected: { value: raw, source, reason } };
    }

    // Non-RU intl phone → preserve original formatting, compute country.
    let canonical = null;
    let country = "unknown";
    let isIntl = false;
    if (/^\s*\+(?!7\D*\d)\d/.test(main)) {
        canonical = normalizeIntl(main);
        if (!canonical) return { rejected: { value: raw, source, reason: "intl_malformed" } };
        country = classifyCountry(canonical);
        isIntl = true;
    } else {
        canonical = canonicalToPlus7(main) || normalizeBareDigits(main);
        if (!canonical) return { rejected: { value: raw, source, reason: "normalize_failed" } };
        country = classifyCountry(canonical);
    }

    // Post-normalization digit count guard.
    if (!isPhoneDigitCountValid(canonical)) {
        return { rejected: { value: raw, source, reason: "digit_count_invalid" } };
    }

    const isMobile = !isIntl && classifyMobileLandline(canonical) === "mobile";
    const isLandline = !isIntl && classifyMobileLandline(canonical) === "landline";
    const isFax = type === "fax";

    // Cross-field: personHint / companyHint exact-digit match → NOT reject,
    // but a phone matching the INN of a companyHint would have been filtered above.

    // Risky / short-subscriber detection: RU area code with 5-digit subscriber
    // (e.g., +7 (3349) 22450 = 4+5 = 9 digits, so canonicalToPlus7 fails;
    //  but +7 (495) 12345 = 3+5 = 8 digits, also fails normalize).
    // Here we treat "subscriber block looks short" via digit span.
    let risky = false;
    const canonDigits = digitsOnly(canonical);
    if (canonDigits.length < 10) risky = true;
    if (isRiskyShort(raw)) risky = true;

    return {
        accepted: {
            raw,
            value: canonical,
            ext,
            type,
            country,
            isMobile,
            isLandline,
            isFax,
            isIntl,
            risky,
            source,
            confidence: SOURCE_CONFIDENCE[source] || 0.5,
        },
    };
}

// Process a whole text (signature / body / …) — returns { accepted, rejected, rawCandidates }.
function processText(text, source, personHint, companyHint) {
    const accepted = [];
    const rejected = [];
    const rawCandidates = [];
    const cands = collectRawCandidates(text || "");
    applyLineLabels(text || "", cands);

    for (const c of cands) {
        rawCandidates.push({ value: c.value, source, kind: c.kind });
        const r = processCandidate(c, source, personHint, companyHint);
        if (r.accepted) accepted.push(r.accepted);
        else if (r.rejected) rejected.push(r.rejected);
    }
    return { accepted, rejected, rawCandidates };
}

// Dedup by canonical value — keep best confidence.
function dedupeAccepted(list) {
    const byVal = new Map();
    for (const item of list) {
        const key = item.value;
        const prev = byVal.get(key);
        if (!prev || item.confidence > prev.confidence) {
            byVal.set(key, item);
        }
    }
    return Array.from(byVal.values());
}

// Main facade.
export function extractPhone(input = {}) {
    const {
        formFields = null,
        signature = "",
        body = "",
        senderDisplay = "",
        quotedBody = "",
        footer = "",
        contactLines = "",
        personHint = null,
        companyHint = null,
    } = input;

    const rawCandidates = [];
    const rejected = [];
    const accepted = [];
    let recoveredFromCompany = false;

    const runZone = (text, source) => {
        if (!text) return;
        const r = processText(text, source, personHint, companyHint);
        rawCandidates.push(...r.rawCandidates);
        rejected.push(...r.rejected);
        accepted.push(...r.accepted);
    };

    // 1. form_fields — highest confidence.
    if (formFields && typeof formFields === "object") {
        const keys = ["Телефон", "Phone", "Tel", "Тел", "Mobile", "Моб", "phone"];
        for (const k of keys) {
            if (formFields[k]) {
                const r = processText(String(formFields[k]), "form", personHint, companyHint);
                rawCandidates.push(...r.rawCandidates);
                rejected.push(...r.rejected);
                accepted.push(...r.accepted);
            }
        }
    }
    // 2. signature
    runZone(signature, "signature");
    // 3. current_message body
    runZone(body, "current_message");
    // 4. contact_lines (if explicitly provided — e.g. parsed "Контакты:" block)
    runZone(contactLines, "contact_lines");
    // 5. company_blob — misplacement recovery.
    if (companyHint) {
        const preCount = accepted.length;
        const r = processText(String(companyHint), "company_blob", personHint, companyHint);
        rawCandidates.push(...r.rawCandidates);
        rejected.push(...r.rejected);
        accepted.push(...r.accepted);
        if (accepted.length > preCount) recoveredFromCompany = true;
    }
    // 6. quoted_thread
    runZone(quotedBody, "quoted_thread");
    // 7. template_footer
    runZone(footer, "template_footer");
    // 8. sender_header (often just a name — rarely contains a phone).
    runZone(senderDisplay, "sender_header");

    const dedup = dedupeAccepted(accepted);
    if (dedup.length === 0) {
        return {
            primary: null,
            alt: null,
            ext: null,
            type: "unknown",
            country: "unknown",
            isMobile: false,
            isLandline: false,
            isFax: false,
            source: null,
            confidence: 0,
            needsReview: true,
            recoveredFromCompany: false,
            rawCandidates,
            rejected,
        };
    }

    // Pick primary = highest confidence; if tie, prefer phone over fax/unknown.
    dedup.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        const typeRank = { phone: 0, phone_or_fax: 1, unknown: 2, fax: 3 };
        return (typeRank[a.type] ?? 2) - (typeRank[b.type] ?? 2);
    });

    const best = dedup[0];
    const altCand = dedup.find((c) => c.value !== best.value) || null;

    // Mark recoveredFromCompany only if best actually came from company blob.
    if (best.source !== "company_blob") recoveredFromCompany = false;

    // Needs review if: confidence < 0.6 OR risky OR type ambiguous (phone_or_fax).
    const needsReview = best.confidence < 0.6
        || best.risky
        || best.type === "phone_or_fax"
        || best.type === "unknown";

    return {
        primary: best.value,
        alt: altCand ? altCand.value : null,
        ext: best.ext,
        type: best.type,
        country: best.country,
        isMobile: best.isMobile,
        isLandline: best.isLandline,
        isFax: best.isFax,
        source: best.source,
        confidence: best.confidence,
        needsReview,
        recoveredFromCompany,
        rawCandidates,
        rejected,
    };
}
