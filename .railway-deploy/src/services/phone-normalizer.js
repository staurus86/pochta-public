// phone-normalizer.js — canonicalization + metadata helpers for Phone.
// Goals:
//   - stripExtension: separate "доб. 123" / "ext 10" / "вн. 5" from main number
//   - stripLabel:     detect "тел / моб / факс / т/ф / tel/fax" label → type
//   - canonicalToPlus7 / normalizeBareDigits: produce "+7 (XXX) XXX-XX-XX"
//   - classifyMobileLandline / classifyCountry

// Extension suffix — various RU / EN conventions.
// Keep generous suffixes; user input varies widely.
const EXT_RE = /[,.\s;:]+(?:доб|ext|вн|внутр|extension|x)\.?\s*[#:]?\s*(\d{1,6})\s*$/i;
// Bracket form: "(доб. 123)" / "(ext 5)"
const EXT_BRACKET_RE = /\(\s*(?:доб|ext|вн|внутр|extension)\.?\s*[#:]?\s*(\d{1,6})\s*\)\s*$/i;
// Short form after hash/slash: "+7 495 123 45 67 / 123" — rare, treat as ext.
const EXT_HASH_RE = /\s*#\s*(\d{1,6})\s*$/;

export function stripExtension(raw) {
    if (raw == null) return { main: "", ext: null };
    let s = String(raw).trim();
    let ext = null;
    const tryExt = (re) => {
        const m = s.match(re);
        if (m) {
            ext = m[1];
            s = s.slice(0, s.length - m[0].length).replace(/[,;:\s]+$/, "").trim();
        }
    };
    tryExt(EXT_BRACKET_RE);
    if (!ext) tryExt(EXT_RE);
    if (!ext) tryExt(EXT_HASH_RE);
    return { main: s, ext };
}

// Label patterns — order matters: more specific first (т/ф before тел).
// JS `\b` does NOT work with Cyrillic → use explicit char-class lookarounds.
const WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])";
const WE = "(?=[^A-Za-zА-Яа-яЁё0-9_]|$)";
const LABEL_FAX_ONLY_RE = new RegExp(`${WB}(?:fax|факс|fx)${WE}[.:]?`, "i");
const LABEL_PHONE_OR_FAX_RE = new RegExp(
    `${WB}(?:т\\s*\\/\\s*ф|тел\\.?\\s*\\/\\s*факс|tel\\s*\\/\\s*fax|phone\\s*\\/\\s*fax)[.:]?`,
    "i"
);
const LABEL_PHONE_RE = new RegExp(
    `${WB}(?:телефон|моб(?:ильный)?|тел|мобильный|mob|mobile|cell|phone|тлф)${WE}[.:]?`,
    "i"
);

export function stripLabel(raw) {
    if (raw == null) return { value: "", type: "unknown" };
    let s = String(raw).trim();
    let type = "unknown";

    if (LABEL_PHONE_OR_FAX_RE.test(s)) {
        type = "phone_or_fax";
        s = s.replace(LABEL_PHONE_OR_FAX_RE, " ").trim();
    } else if (LABEL_FAX_ONLY_RE.test(s)) {
        type = "fax";
        s = s.replace(LABEL_FAX_ONLY_RE, " ").trim();
    } else if (LABEL_PHONE_RE.test(s)) {
        type = "phone";
        s = s.replace(LABEL_PHONE_RE, " ").trim();
    }

    // Drop trailing colon / punctuation left over.
    s = s.replace(/^\s*[:;,.\-–—]+\s*/, "").trim();
    return { value: s, type };
}

function stripNonDigits(s) {
    return String(s || "").replace(/\D/g, "");
}

// Format 10-digit national subscriber with RU conventions: (XXX) XXX-XX-XX.
// Valid codes within +7 shared country space (Russia + Kazakhstan):
//   2xx-5xx, 7xx-9xx — Russian regions, Kazakhstan, mobile, toll-free.
//   Invalid: 0xx, 1xx, 6xx.
function formatRu10(d10) {
    if (d10.length !== 10) return null;
    if (/^[016]/.test(d10)) return null;
    return `+7 (${d10.slice(0, 3)}) ${d10.slice(3, 6)}-${d10.slice(6, 8)}-${d10.slice(8, 10)}`;
}

// Normalize bare digit string (7/10/11 digits) → canonical +7 form or null.
export function normalizeBareDigits(raw) {
    const digits = stripNonDigits(raw);
    if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
        return formatRu10(digits.slice(1));
    }
    if (digits.length === 10) {
        return formatRu10(digits);
    }
    return null;
}

// Handles "+7", "8", bare 10 digits → canonical "+7 (XXX) XXX-XX-XX".
// Returns null for any sequence that cannot be expressed as a RU number.
export function canonicalToPlus7(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // Non-RU intl (not +7) → leave untouched (caller decides).
    if (/^\+(?!7)\d/.test(s)) return null;

    const digits = stripNonDigits(s);
    if (!digits) return null;

    // Strip leading 7/8 (RU prefix) to get 10-digit subscriber.
    let subscriber = digits;
    if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
        subscriber = digits.slice(1);
    }
    if (subscriber.length !== 10) return null;

    return formatRu10(subscriber);
}

// Mobile (RU): 10-digit subscriber starting with "9".
// Landline: anything else with valid area code (3xx-8xx).
export function classifyMobileLandline(canonical) {
    if (!canonical) return "unknown";
    const s = String(canonical);
    // Take first digit after country code.
    // Match e.g. "+7 (964) ..." or "+7 (3812) ..."
    const m = s.match(/\+7\D*(\d)/);
    if (!m) {
        // Non-+7 → just guess by first digit after + then country-code block.
        // Safer: say unknown.
        return "unknown";
    }
    return m[1] === "9" ? "mobile" : "landline";
}

// Country guess from canonical (or raw +XX prefix).
const COUNTRY_PREFIX = [
    // Order by length DESC so "+375" matches before "+37".
    { code: "375", country: "BY" },
    { code: "380", country: "UA" },
    { code: "374", country: "AM" },
    { code: "371", country: "LV" },
    { code: "372", country: "EE" },
    { code: "370", country: "LT" },
    { code: "373", country: "MD" },
    { code: "995", country: "GE" },
    { code: "996", country: "KG" },
    { code: "998", country: "UZ" },
    { code: "992", country: "TJ" },
    { code: "993", country: "TM" },
    { code: "994", country: "AZ" },
    { code: "77",  country: "KZ" },   // +7 7xx → Kazakhstan (best-effort)
    { code: "49",  country: "DE" },
    { code: "39",  country: "IT" },
    { code: "33",  country: "FR" },
    { code: "44",  country: "GB" },
    { code: "34",  country: "ES" },
    { code: "48",  country: "PL" },
    { code: "86",  country: "CN" },
    { code: "81",  country: "JP" },
    { code: "82",  country: "KR" },
    { code: "91",  country: "IN" },
    { code: "90",  country: "TR" },
    { code: "1",   country: "US" },
    { code: "7",   country: "RU" },
];

export function classifyCountry(canonical) {
    if (!canonical) return "unknown";
    const s = String(canonical).replace(/\s/g, "");
    const m = s.match(/^\+(\d{1,3})/);
    if (!m) return "unknown";
    const digits = stripNonDigits(s);
    for (const { code, country } of COUNTRY_PREFIX) {
        if (digits.startsWith(code)) return country;
    }
    return "unknown";
}

// Normalize arbitrary intl phone — e.g. "+375 29 123-45-67" → compact
// "+375 29 123-45-67" (no re-format — we just trim/space-collapse).
export function normalizeIntl(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!/^\+/.test(s)) return null;
    // Collapse consecutive spaces / weird separators.
    return s
        .replace(/[().\u00A0]+/g, " ")
        .replace(/-+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}
