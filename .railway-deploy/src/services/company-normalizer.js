// company-normalizer.js — cleanup of requisite tails, composite split, legal-form quote normalization.

const COMPANY_LEGAL_RE = /(?:^|[\s"'«»(\[.,])(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|НКО|ИП|ТК|ТД|LLC|Ltd|GmbH|AG|Inc|Corp)(?:[\s"'«»).,\]]|$)/i;

// Requisite tail patterns — anchored to trailing text after a company.
// Applied in order; each matches everything from the marker to end of string.
const REQUISITE_TAIL_PATTERNS = [
    /\s+Дата\s+регистрации\s+предприятия[\s\S]*$/i,
    /\s+Дата\s+регистрации[\s\S]*$/i,
    /\s+Регистрационный\s+номер[\s\S]*$/i,
    /\s+Организационно-?правовая\s+форма[\s\S]*$/i,
    /\s+Общество\s+с\s+ограниченной\s+ответственностью[\s\S]*$/i,
    /\s+Директор\s*\(?\s*действующ[\s\S]*$/i,
    /\s+(?:руководи\w*)[\s\S]*$/i,
    /\s+действующ\w*\s+на\s+основании[\s\S]*$/i,
    /\s+\(?ИНН[\s:]+\d[\s\S]*$/i,
    /\s+КПП[\s:]+\d[\s\S]*$/i,
    /\s+ОГРН[\s:]+\d[\s\S]*$/i,
    /\s+\(?ИНН\s+\d[\s\S]*$/i,
    /\s*,\s*г\.\s*[А-ЯЁ][\s\S]*$/,
    /\s+г\.\s*[А-ЯЁ][а-яё]+[\s\S]*$/,
    /\s+\(г\.\s*[А-ЯЁ][\s\S]*$/,
    /\s+ул\.\s+[А-ЯЁ][\s\S]*$/,
    /\s+адрес[:\s]+[\s\S]*$/i,
    /\s+юридический\s+адрес[\s\S]*$/i,
    /\s+р\/с\s+\d[\s\S]*$/i,
    /\s+к\/с\s+\d[\s\S]*$/i,
    /\s+БИК\s+\d[\s\S]*$/,
];

function trimEdges(s) {
    return String(s || "")
        .replace(/^[\s,;:.!()[\]"'«»\\\/|-]+/g, "")
        .replace(/[\s,;:.!()[\]"'«»\\\/|-]+$/g, "")
        .trim();
}

function collapse(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

export function stripRequisiteTails(value) {
    let s = String(value || "").trim();
    if (!s) return "";
    for (const re of REQUISITE_TAIL_PATTERNS) {
        s = s.replace(re, "");
    }
    s = s.replace(/\s+\(ИНН\s+\d+\)\s*$/i, "");
    s = s.replace(/\s*,\s*$/, "");
    // Strip signature-separator / contact-label tails: "... -- ", "... ---", "... :"
    s = s.replace(/\s+-{2,}\s*.*$/s, "");
    s = s.replace(/\s+[-–—]\s*$/g, "");
    s = collapse(s);
    // Strip trailing unbalanced guillemets / parens.
    s = s.replace(/\s*[(\[]\s*$/g, "");
    s = s.replace(/^\s*["«]\s*/, (m) => m.includes('"') ? '"' : "«");
    return collapse(s);
}

// Split composite string into { company, person }.
// Supports: "Company - Person", "Person - Company", "Person (Company)",
// "Person | Company", "Company | Person".
export function splitCompositeForCompany(value) {
    const s = collapse(String(value || ""));
    if (!s) return { company: null, person: null };

    // 1. Parenthesized: "Person (ООО X)" or "ООО X (Person)".
    const parenMatch = s.match(/^(.*?)\s*[(\[]\s*(.+?)\s*[)\]]\s*$/);
    if (parenMatch) {
        const left = trimEdges(parenMatch[1]);
        const right = trimEdges(parenMatch[2]);
        if (COMPANY_LEGAL_RE.test(right) && !COMPANY_LEGAL_RE.test(left) && left) {
            return { company: right, person: left };
        }
        if (COMPANY_LEGAL_RE.test(left) && !COMPANY_LEGAL_RE.test(right) && right) {
            return { company: left, person: right };
        }
    }

    // 2. Separator-based: " - ", " — ", " \ ", " / ", " | "
    // Skip when quotes are unbalanced — " - " inside a malformed quoted name
    // (e.g. АО "Концерн "Моринсис - Агат") is not a composite separator.
    const dqCount = (s.match(/"/g) || []).length;
    const guillCount = (s.match(/[«»]/g) || []).length;
    if (dqCount % 2 !== 0 || guillCount % 2 !== 0) {
        return { company: null, person: null };
    }
    const SEP_RE = /\s+[-–—\\/|]\s+/;
    if (SEP_RE.test(s)) {
        const parts = s.split(SEP_RE).map(trimEdges).filter(Boolean);
        if (parts.length === 2) {
            const [a, b] = parts;
            const aCompany = COMPANY_LEGAL_RE.test(a);
            const bCompany = COMPANY_LEGAL_RE.test(b);
            if (aCompany && !bCompany) return { company: a, person: b };
            if (!aCompany && bCompany) return { company: b, person: a };
            // Neither has legal marker → decide by capitalization heuristic.
            // 2-3 Title-Case words strongly suggests a person.
            const MULTI_WORD_PERSON_RE = /^[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+){1,2}$/;
            const SINGLE_WORD_RE = /^[А-ЯЁA-Z][а-яёa-z]+$/;
            const aPerson = MULTI_WORD_PERSON_RE.test(a);
            const bPerson = MULTI_WORD_PERSON_RE.test(b);
            if (aPerson && !bPerson) return { company: b, person: a };
            if (!aPerson && bPerson) return { company: a, person: b };
            // Tie-break: multi-word side = person, single-word side = brand/company label.
            if (aPerson && bPerson) {
                const aWords = a.split(/\s+/).length;
                const bWords = b.split(/\s+/).length;
                if (aWords > bWords) return { company: b, person: a };
                if (bWords > aWords) return { company: a, person: b };
            }
            // "Person Name | Brand" — multi-word vs single-word with title-case.
            if (SINGLE_WORD_RE.test(a) && MULTI_WORD_PERSON_RE.test(b)) {
                return { company: a, person: b };
            }
            if (SINGLE_WORD_RE.test(b) && MULTI_WORD_PERSON_RE.test(a)) {
                return { company: b, person: a };
            }
        }
    }

    return { company: null, person: null };
}

// Normalize legal form quotes: ООО "X" / ООО 'X' → ООО «X».
// Conservative: only rewrites when quotes form a clean name boundary —
// closing quote must be at end-of-string or followed by whitespace/punctuation.
// Nested/unbalanced quotes (e.g. АО "Концерн "Моринсис - Агат") are left intact
// because rewriting them loses information.
export function normalizeLegalQuotes(value) {
    let s = String(value || "").trim();
    if (!s) return "";
    // Closing quote followed by word char → nested/unbalanced → skip.
    s = s.replace(
        /(?<=(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|ИП|ТК|ТД|LLC|Ltd|GmbH|Inc|Corp)\s)"([^"]+)"(?=[\s,.;!?)\]]|$)/gi,
        "«$1»"
    );
    s = s.replace(
        /(?<=(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|ИП|ТК|ТД|LLC|Ltd|GmbH|Inc|Corp)\s)'([^']+)'(?=[\s,.;!?)\]]|$)/gi,
        "«$1»"
    );
    return collapse(s);
}

export function normalizeCompanyName(value) {
    if (value == null) return "";
    const s = collapse(String(value));
    if (!s) return "";
    return s;
}
