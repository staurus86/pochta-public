// fio-normalizer.js — composite/bilingual split + role-tail trim + case norm.

import { isCompanyLike } from "./fio-filters.js";

const HONORIFIC_PREFIX_RE = /^\s*(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Prof\.?|г-жа|г-н|госпожа|господин)\b[\s.]*/i;
// Trailing honorific: "(Mrs)" / "Mr." / ", Mrs" etc.
const HONORIFIC_TAIL_RE = /[\s,(]+(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?|Prof\.?)\s*\)?\s*$/i;

const ROLE_TAIL_WORDS = [
    "manager",
    "director",
    "engineer",
    "specialist",
    "supervisor",
    "consultant",
    "accountant",
    "secretary",
    "operator",
    "owner",
    "founder",
    "buyer",
    "purchaser",
    "coordinator",
    "assistant",
    "менеджер",
    "директор",
    "инженер",
    "специалист",
    "руководитель",
    "начальник",
    "бухгалтер",
    "секретарь",
    "оператор",
    "консультант",
    "технолог",
    "снабженец",
    "закупщик",
];

const ROLE_TAIL_RE = new RegExp(
    `[\\s,;/]+(?:${ROLE_TAIL_WORDS.join("|")})(?:\\s|$).*$`,
    "i"
);

const CYR_WORD_RE = /[А-ЯЁа-яё]/;
const LAT_WORD_RE = /[A-Za-z]/;

function trimPunct(s) {
    return String(s || "")
        .replace(/[\s,;:.!?"'«»()[\]\\/]+$/g, "")
        .replace(/^[\s,;:.!?"'«»()[\]\\/]+/g, "")
        .trim();
}

function collapseSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function titleCaseWord(word) {
    if (!word) return word;
    const hasLower = /[a-zа-яё]/.test(word);
    const hasUpper = /[A-ZА-ЯЁ]/.test(word);
    // If word has a hyphen (Mary-Anne) — title-case each segment.
    if (word.includes("-")) {
        return word
            .split("-")
            .map((p) => titleCaseWord(p))
            .join("-");
    }
    // All-caps → title. All-lower → title. Mixed (Ivan) → keep.
    if (hasLower && hasUpper) return word;
    const first = word.charAt(0).toUpperCase();
    const rest = word.slice(1).toLowerCase();
    return first + rest;
}

// Split "ИП Безрукова ЕВ - Елена" (or "Елена - ИП ...", or "Person (Company)")
// into { person, company }. If no company marker found — person = input, company = null.
export function splitCompositeCompanyPerson(value) {
    const s = collapseSpaces(String(value || ""));
    if (!s) return { person: "", company: null };

    // 1. Parenthesized company: "Елена Ананьева (ООО Тест)"
    const parenMatch = s.match(/^(.*?)\s*[(\[]\s*(.+?)\s*[)\]]\s*$/);
    if (parenMatch) {
        const left = trimPunct(parenMatch[1]);
        const right = trimPunct(parenMatch[2]);
        if (isCompanyLike(right) && !isCompanyLike(left) && left) {
            return { person: left, company: right };
        }
        if (isCompanyLike(left) && !isCompanyLike(right) && right) {
            return { person: right, company: left };
        }
    }

    // 2. Separator-based: " - ", " — ", " \ ", " / "
    const SEP_RE = /\s+[-–—\\/|]\s+/;
    if (SEP_RE.test(s)) {
        const parts = s.split(SEP_RE).map((p) => trimPunct(p)).filter(Boolean);
        if (parts.length === 2) {
            const [a, b] = parts;
            const aCompany = isCompanyLike(a);
            const bCompany = isCompanyLike(b);
            if (aCompany && !bCompany) return { person: b, company: a };
            if (!aCompany && bCompany) return { person: a, company: b };
        }
    }

    // 3. No composite pattern.
    return { person: s, company: null };
}

// Split bilingual name "Александр/Aleksandr" or "Александр \ Aleksandr".
// Returns { primary, alt } — Cyrillic preferred as primary if present.
export function splitBilingualName(value) {
    const s = collapseSpaces(String(value || ""));
    if (!s) return { primary: "", alt: null };

    // Do NOT split on company-separator patterns (handled elsewhere).
    // Pattern: two halves separated by / or \, with one mostly Cyrillic, other mostly Latin.
    const SEP_RE = /\s*[\/\\]\s*/;
    if (!SEP_RE.test(s)) return { primary: s, alt: null };

    const parts = s.split(SEP_RE).map((p) => trimPunct(p)).filter(Boolean);
    if (parts.length !== 2) return { primary: s, alt: null };

    const [a, b] = parts;
    const aCyr = CYR_WORD_RE.test(a);
    const bCyr = CYR_WORD_RE.test(b);
    const aLat = LAT_WORD_RE.test(a);
    const bLat = LAT_WORD_RE.test(b);

    if (aCyr && !aLat && bLat && !bCyr) return { primary: a, alt: b };
    if (bCyr && !bLat && aLat && !aCyr) return { primary: b, alt: a };
    // Both mixed or same script — not a bilingual pair, keep original.
    return { primary: s, alt: null };
}

export function stripHonorific(value) {
    let s = String(value || "").trim();
    if (!s) return "";
    // Leading: "Mr. John Smith"
    s = s.replace(HONORIFIC_PREFIX_RE, "");
    // Trailing: "Guzel (Mrs)" / "John Mr."
    s = s.replace(HONORIFIC_TAIL_RE, "");
    return collapseSpaces(s);
}

export function stripRoleTail(value) {
    let s = String(value || "").trim();
    if (!s) return "";
    const stripped = s.replace(ROLE_TAIL_RE, "");
    return collapseSpaces(stripped || s);
}

// Normalize a person name: trim, collapse spaces, title-case each word.
export function normalizePersonName(value) {
    const s = collapseSpaces(String(value || ""));
    if (!s) return "";
    const words = s.split(/\s+/).map(titleCaseWord);
    return words.join(" ");
}
