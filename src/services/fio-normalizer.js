// fio-normalizer.js — composite/bilingual split + role-tail trim + case norm.

import { isCompanyLike, _roleSets } from "./fio-filters.js";

const { ROLE_NOUN_SET, ROLE_ADJECTIVE_SET, ROLE_CONNECTOR_SET } = _roleSets;

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
    "механик",
    "энергетик",
];

// Adjective/connector tokens that can appear BEFORE a role noun in a compound
// role phrase ("Генеральный Директор", "Главный Инженер", "Специалист По Закупкам").
// When we detect a role-noun tail, we extend the cut backward through any
// adjacent adjective/connector tokens.
const ROLE_PREFIX_ADJ = [
    "главный",
    "ведущий",
    "старший",
    "генеральный",
    "коммерческий",
    "исполнительный",
    "технический",
    "финансовый",
    "региональный",
    "senior",
    "lead",
    "chief",
    "general",
];
const ROLE_CONNECTOR = ["по", "для", "в", "на", "при", "of", "for", "in", "at"];

// Role tail: whitespace/comma/semi/slash separator, role noun, then anything
// that isn't a Cyrillic/Latin letter (EOS, punct, dash, digit, whitespace).
// Using `(?![A-Za-zА-Яа-яЁё])` instead of `(?:\s|$)` so "Инженер-Механик" and
// "Инженер +phone" both strip cleanly.
const ROLE_TAIL_RE = new RegExp(
    `[\\s,;/]+(?:${ROLE_TAIL_WORDS.join("|")})(?![A-Za-zА-Яа-яЁё]).*$`,
    "iu"
);

// Backward-extend regex: captures trailing adjective/connector tokens BEFORE
// the role-tail boundary so "Генеральный Директор" and "Специалист По Закупкам"
// are stripped entirely, not just the noun.
const ROLE_TAIL_EXTENDED_RE = new RegExp(
    `[\\s,;/]+(?:(?:${ROLE_PREFIX_ADJ.join("|")}|${ROLE_CONNECTOR.join("|")})[\\s,;/]+)*`
    + `(?:${ROLE_TAIL_WORDS.join("|")})`
    + `(?:[\\s,;/]+(?:${ROLE_PREFIX_ADJ.join("|")}|${ROLE_CONNECTOR.join("|")}|${ROLE_TAIL_WORDS.join("|")}))*`
    + `(?![A-Za-zА-Яа-яЁё]).*$`,
    "iu"
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
    // Try extended (compound) first: "Генеральный Директор", "Специалист По Закупкам".
    // Fall back to plain role tail if the extended pattern didn't match.
    let stripped = s.replace(ROLE_TAIL_EXTENDED_RE, "");
    if (stripped === s) stripped = s.replace(ROLE_TAIL_RE, "");
    return collapseSpaces(stripped || s);
}

// Patterns for name tails at the end of a role-containing string.
// Cyrillic: "Жарихин Н.В." / "Жарихин Н.в." / "Петрова Анна Игоревна" / "Иван Иванов"
// Initials allow lowercase second letter ("Н.в.") — common typo pattern.
const NAME_TAIL_CYR_RE =
    /([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ]\.?\s*[А-ЯЁа-яё]?\.?|\s+[А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ][а-яё]{2,})?))\s*[,.]?\s*$/u;
// Latin: "John Smith" / "John Doe Jr"
const NAME_TAIL_LAT_RE =
    /([A-Z][a-z]{2,}(?:\s+[A-Z]\.?|\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?))\s*[,.]?\s*$/;

// Strip leading role tokens (noun/adjective/connector/object) from
// "Менеджер По Закупкам Жарихин Н.в." so the residual "Жарихин Н.в." can be
// evaluated as a person name.
//
// Two-strategy approach:
//   1. If the string starts with a role noun/adjective AND ends with a name-tail
//      pattern, return the captured name tail.
//   2. Otherwise, if the entire string is role tokens only, return "".
//
// Preserves original if no role prefix is present.
function tailIsRoleOnly(tail) {
    const tokens = String(tail || "")
        .replace(/[.,;:!?()"'«»]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.toLowerCase());
    if (tokens.length === 0) return true;
    return tokens.every((t) =>
        ROLE_NOUN_SET.has(t) ||
        ROLE_ADJECTIVE_SET.has(t) ||
        ROLE_CONNECTOR_SET.has(t));
}

export function stripRolePrefix(value) {
    const s = collapseSpaces(String(value || ""));
    if (!s) return "";
    const firstToken = s
        .split(/\s+/, 1)[0]
        .toLowerCase()
        .replace(/[.,;:!?()"'«»]/g, "");
    const startsWithRole =
        ROLE_NOUN_SET.has(firstToken) || ROLE_ADJECTIVE_SET.has(firstToken);
    if (!startsWithRole) return s;

    // Strategy 1: look for a name-tail at the end of the string.
    // Reject tail if all its tokens are themselves role words (otherwise
    // "Главный Механик" would be captured as its own tail).
    const cyrTail = s.match(NAME_TAIL_CYR_RE);
    if (cyrTail && cyrTail[1] && !tailIsRoleOnly(cyrTail[1])) {
        return cyrTail[1].trim();
    }
    const latTail = s.match(NAME_TAIL_LAT_RE);
    if (latTail && latTail[1] && !tailIsRoleOnly(latTail[1])) {
        return latTail[1].trim();
    }

    // Strategy 2: starts with role noun/adjective AND no name-tail pattern
    // matched. Under NAME_TAIL regex, standalone surname like "Иванов Иван"
    // or "Иванов И.И." would have been caught. If strategy 1 failed here,
    // the string is role-only content — return "" to signal rejection.
    return "";
}

// Normalize a person name: trim, collapse spaces, title-case each word.
export function normalizePersonName(value) {
    const s = collapseSpaces(String(value || ""));
    if (!s) return "";
    const words = s.split(/\s+/).map(titleCaseWord);
    return words.join(" ");
}
