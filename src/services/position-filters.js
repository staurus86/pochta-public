// position-filters.js — negative predicates for Должность rejection.
// Goal: isolate role/title tokens from signature garbage (company, person,
// department, contact data, full signature dumps).

// JS `\b` does not behave at Cyrillic boundaries → explicit char-class lookarounds.
const WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])";
const WE = "(?:[^A-Za-zА-Яа-яЁё0-9_]|$)";

const COMPANY_MARKER_RU_RE = new RegExp(
    `${WB}(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|НКО|ИП|НПФ|НПП|НПО|ТК|ТД|ТПК|ПКФ|ГК|ФГБУ|ФГАОУ|ФГБОУ|Филиал)${WE}`,
    "i"
);
const COMPANY_MARKER_LAT_RE = new RegExp(
    `${WB}(?:LLC|Ltd|Limited|Inc|Corp|Corporation|Company|Co\\.|GmbH|AG|SA|SARL|BV|NV|JSC|PLC|KG|SpA|Srl|Pty)${WE}`,
    "i"
);

// 2-3 Title-Case Cyrillic words or Latin words — likely a person name.
const PERSON_RU_2_3_RE = /(?:^|[^А-Яа-яЁё])([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})(?:[^А-Яа-яЁё]|$)/;
const PERSON_LAT_2_3_RE = /(?:^|[^A-Za-z])([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?:[^A-Za-z]|$)/;

// Trailing Cyrillic initials "И. И." / "И.И."
const PERSON_INITIALS_RE = /(?:[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]?\.?)/;

// Role nouns — concrete job titles. Their presence prevents "department-only" classification.
const ROLE_NOUNS_RU = [
    "менеджер", "директор", "руководитель", "начальник", "заместитель",
    "инженер", "специалист", "бухгалтер", "секретарь", "оператор", "консультант",
    "технолог", "закупщик", "снабженец", "логист", "координатор", "помощник",
    "ассистент", "аналитик", "эксперт", "мастер", "механик", "монтажник",
    "заведующий", "заведующая", "советник", "экономист", "юрист", "маркетолог",
    "казначей", "сметчик", "владелец", "учредитель", "собственник",
    "председатель", "президент", "управляющий", "администратор", "куратор",
];

const ROLE_NOUNS_EN = [
    "manager", "director", "engineer", "specialist", "supervisor", "accountant",
    "secretary", "operator", "consultant", "coordinator", "assistant", "head",
    "chief", "owner", "founder", "ceo", "cto", "coo", "cfo", "chro", "cio",
    "president", "vp", "executive", "analyst", "technician", "officer", "clerk",
    "controller", "administrator", "principal", "lead", "buyer", "purchaser",
];

// Role adjectives / modifiers — qualify a noun but don't stand alone as a position.
const ROLE_ADJECTIVES_RU = [
    "главный", "ведущий", "старший", "младший", "зам", "генеральный",
    "коммерческий", "технический", "финансовый", "исполнительный",
];

const ROLE_ADJECTIVES_EN = [
    "senior", "junior", "deputy", "sales", "marketing", "finance", "technical",
    "commercial", "financial", "procurement", "logistics", "sourcing", "supply",
    "quality", "operations", "production", "maintenance", "project",
];

const ROLE_WORDS_RU = [...ROLE_NOUNS_RU, ...ROLE_ADJECTIVES_RU];
const ROLE_WORDS_EN = [...ROLE_NOUNS_EN, ...ROLE_ADJECTIVES_EN];

const DEPT_STEMS = [
    "отдел", "подразделени", "служб", "департамент", "бюро", "сектор",
    "управлени", "дирекци", "цех", "группа",
    "department", "division", "section", "bureau", "unit",
];

const ALL_ROLE_WORDS = new Set([...ROLE_WORDS_RU, ...ROLE_WORDS_EN]);
const ALL_ROLE_NOUNS = new Set([...ROLE_NOUNS_RU, ...ROLE_NOUNS_EN]);

function safeString(v) {
    if (v == null) return "";
    return String(v).trim();
}

function tokenize(s) {
    return s
        .toLowerCase()
        .replace(/[.,;:!?()"'«»\[\]|/\\]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
}

export function hasRoleWord(value) {
    const s = safeString(value);
    if (!s) return false;
    const tokens = tokenize(s);
    for (const t of tokens) {
        if (ALL_ROLE_WORDS.has(t)) return true;
    }
    return false;
}

export function hasRoleNoun(value) {
    const s = safeString(value);
    if (!s) return false;
    const tokens = tokenize(s);
    for (const t of tokens) {
        if (ALL_ROLE_NOUNS.has(t)) return true;
    }
    return false;
}

export function hasDepartmentStem(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    for (const stem of DEPT_STEMS) {
        const re = new RegExp(`(?:^|[^a-zа-яё])${stem}[a-zа-яё]{0,6}(?:[^a-zа-яё]|$)`, "i");
        if (re.test(s)) return true;
    }
    return false;
}

export function isCompanyInRole(value) {
    const s = safeString(value);
    if (!s) return false;
    if (COMPANY_MARKER_RU_RE.test(s)) return true;
    if (COMPANY_MARKER_LAT_RE.test(s)) return true;
    return false;
}

// True when the string contains 2+ consecutive Title-case non-role tokens.
// "Менеджер Иванов Иван" → true (Иванов, Иван).
// "Менеджер по закупкам" → false (no two consecutive non-role Title-case).
export function isPersonInRole(value) {
    const s = safeString(value);
    if (!s) return false;
    if (PERSON_INITIALS_RE.test(s)) return true;
    const tokens = s.replace(/[,;:.!?()"'«»]/g, " ").split(/\s+/).filter(Boolean);

    // Cyrillic run.
    let run = 0;
    for (const tok of tokens) {
        const lower = tok.toLowerCase();
        if (/^[А-ЯЁ][а-яё]+$/.test(tok) && !ALL_ROLE_WORDS.has(lower)) {
            run++;
            if (run >= 2) return true;
        } else {
            run = 0;
        }
    }

    // Latin run.
    run = 0;
    for (const tok of tokens) {
        const lower = tok.toLowerCase();
        if (/^[A-Z][a-z]+$/.test(tok) && !ALL_ROLE_WORDS.has(lower)) {
            run++;
            if (run >= 2) return true;
        } else {
            run = 0;
        }
    }
    return false;
}

export function isDepartmentOnly(value) {
    const s = safeString(value);
    if (!s) return false;
    if (!hasDepartmentStem(s)) return false;
    // If a role NOUN is present, it's "role of department", not department-only.
    // Role adjectives like "procurement"/"sales" alone do NOT disqualify.
    if (hasRoleNoun(s)) return false;
    return true;
}

export function isPhoneLike(value) {
    const s = safeString(value);
    if (!s) return false;
    // Strip phone format symbols, count digits.
    const digits = (s.match(/\d/g) || []).length;
    const nonDigit = s.replace(/\d/g, "").trim();
    // Almost entirely digits/formatting chars.
    if (digits >= 7 && /^[\d\s+()\-.]+$/.test(s)) return true;
    // "Тел: +7 ..." — label + phone.
    if (/^(?:тел|tel|mob|моб|phone|fax|факс|ф\.|т\.|cell)[:.\s]/i.test(s) && digits >= 6) return true;
    return false;
}

export function isAddressLike(value) {
    const s = safeString(value);
    if (!s) return false;
    if (/^\d{6}[,\s]/.test(s)) return true; // postal code prefix
    if (/(?:^|\s)(?:г\.|город|ул\.|улица|пр-?т|проспект|д\.\s*\d|дом\s+\d|корп\.|стр\.|оф\.|офис\s+\d)/i.test(s)) {
        return true;
    }
    return false;
}

export function isContactGarbage(value) {
    const s = safeString(value);
    if (!s) return false;
    if (isPhoneLike(s)) return true;
    // Pure email / URL — whole string is the contact token.
    if (/^\S+@[\w.-]+\.[a-z]{2,}\S*$/i.test(s)) return true;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(s)) return true;
    if (isAddressLike(s)) return true;
    return false;
}

export function isFullSignatureBlob(value) {
    const s = safeString(value);
    if (!s) return false;
    // Multi-line signature dump — at least 2 newlines or >150 chars with phone+email.
    if (/\n/.test(s)) {
        const lines = s.split(/\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 3) return true;
    }
    if (s.length > 150) return true;
    // Long single-line with phone+email → blob.
    const hasPhone = /(?:\+7|\+?\d{2,3}[\s\-(])/.test(s);
    const hasEmail = /@[\w.-]+\./.test(s);
    if (hasPhone && hasEmail) return true;
    return false;
}

export function isBadPosition(value) {
    if (value == null) return true;
    const s = safeString(value);
    if (!s) return true;
    if (s.length < 2) return true;
    if (isContactGarbage(s)) return true;
    if (isPhoneLike(s)) return true;
    // Pure person name without any role word → bad.
    if (!hasRoleWord(s) && isPersonInRole(s)) return true;
    // Pure company without role word → bad.
    if (!hasRoleWord(s) && isCompanyInRole(s)) return true;
    // All-digit / very few letters.
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (letters < 3) return true;
    return false;
}

// Exposed helpers for tests / normalizer.
export const _internals = {
    COMPANY_MARKER_RU_RE,
    COMPANY_MARKER_LAT_RE,
    PERSON_RU_2_3_RE,
    PERSON_LAT_2_3_RE,
    ROLE_WORDS_RU,
    ROLE_WORDS_EN,
    ROLE_NOUNS_RU,
    ROLE_NOUNS_EN,
    DEPT_STEMS,
    ALL_ROLE_WORDS,
    ALL_ROLE_NOUNS,
};
