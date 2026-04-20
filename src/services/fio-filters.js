// fio-filters.js — negative predicates for person-name rejection.
// Reject anything that is NOT a person: company, email, alias, role-only,
// corporate uppercase label, department.

const COMPANY_MARKERS = [
    "ООО",
    "ОАО",
    "АО",
    "ЗАО",
    "ПАО",
    "ФГУП",
    "МУП",
    "ГУП",
    "НКО",
    "ИП",
    "НПФ",
    "ТК",
    "ТД",
    "ТПК",
    "НПП",
    "НПО",
    "ПКФ",
    "ФГБУ",
    "ФГАОУ",
    "ФГБОУ",
];

// Latin company suffixes — anchored as separate tokens (case-insensitive).
const COMPANY_SUFFIXES_LAT = [
    "LLC",
    "Ltd",
    "Limited",
    "Inc",
    "Incorporated",
    "Corp",
    "Corporation",
    "Company",
    "Co",
    "GmbH",
    "AG",
    "SA",
    "SARL",
    "BV",
    "NV",
    "OOO",
    "JSC",
    "PLC",
    "KG",
    "OHG",
    "SpA",
    "Srl",
    "Pty",
];

const COMPANY_MARKER_RE = new RegExp(
    `(?:^|[\\s"'«»(\\[.,])(?:${COMPANY_MARKERS.join("|")})(?:[\\s"'«»).,\\]]|$)`,
    "i"
);

const COMPANY_SUFFIX_LAT_RE = new RegExp(
    `(?:^|[\\s"'«»(\\[.,])(?:${COMPANY_SUFFIXES_LAT.join("|")})(?:[\\s"'«»).,\\]]|$)`,
    "i"
);

// Aliases — typical no-name mailbox labels.
const ALIAS_SET = new Set([
    "buh",
    "buhgalter",
    "buhgalteriya",
    "snab",
    "snabgenie",
    "snabzhenie",
    "support",
    "info",
    "sales",
    "sale",
    "procurement",
    "purchase",
    "purchasing",
    "admin",
    "administrator",
    "office",
    "zakup",
    "zakupki",
    "zakupka",
    "reception",
    "secretary",
    "sekretar",
    "manager",
    "tender",
    "tenders",
    "marketing",
    "service",
    "orders",
    "order",
    "hr",
    "pto",
    "ogm",
    "oms",
    "robot",
    "noreply",
    "no-reply",
    "mail",
    "mailer",
    "webmaster",
    "postmaster",
    "bitrix",
    "crm",
    "bot",
    "online",
    "ru",
    "com",
]);

// Role nouns standalone — base concrete job titles.
const ROLE_NOUN_SET = new Set([
    "менеджер",
    "менеджеры",
    "директор",
    "ген.директор",
    "гендиректор",
    "руководитель",
    "начальник",
    "заместитель",
    "инженер",
    "специалист",
    "мастер",
    "механик",
    "бухгалтер",
    "секретарь",
    "оператор",
    "консультант",
    "технолог",
    "кладовщик",
    "снабженец",
    "закупщик",
    "монтажник",
    "координатор",
    "помощник",
    "ассистент",
    "логист",
    "энергетик",
    "экономист",
    "юрист",
    "администратор",
    "аналитик",
    "manager",
    "director",
    "engineer",
    "specialist",
    "supervisor",
    "accountant",
    "secretary",
    "operator",
    "consultant",
    "owner",
    "founder",
    "procurement",
    "buyer",
    "purchaser",
    "coordinator",
    "analyst",
    "chief",
    "head",
    "lead",
    "ceo",
    "cto",
    "coo",
    "cfo",
    "president",
    "vp",
]);

// Role adjectives / modifiers — qualify a role noun but don't stand alone.
const ROLE_ADJECTIVE_SET = new Set([
    "главный",
    "главная",
    "ведущий",
    "ведущая",
    "старший",
    "старшая",
    "младший",
    "младшая",
    "зам",
    "заместитель",
    "генеральный",
    "генеральная",
    "коммерческий",
    "коммерческая",
    "технический",
    "техническая",
    "финансовый",
    "финансовая",
    "исполнительный",
    "исполнительная",
    "научный",
    "научная",
    "ответственный",
    "ответственная",
    "senior",
    "junior",
    "deputy",
    "sales",
    "marketing",
    "finance",
    "technical",
    "commercial",
    "financial",
    "logistics",
    "sourcing",
    "supply",
    "quality",
    "operations",
    "production",
    "maintenance",
    "project",
]);

// Connectors — prepositions and linking words that appear in role compounds
// like "менеджер по закупкам", "head of sales". Skipped during role-only check.
const ROLE_CONNECTOR_SET = new Set([
    "по",
    "для",
    "в",
    "во",
    "на",
    "при",
    "и",
    "of",
    "for",
    "in",
    "at",
    "the",
    "and",
    "&",
]);

const ROLE_SET = new Set([
    ...ROLE_NOUN_SET,
    ...ROLE_ADJECTIVE_SET,
    ...ROLE_CONNECTOR_SET,
]);

// Stem-based — matches any inflection (отдел/отдела/отделом/подразделение/...).
const DEPARTMENT_STEMS = [
    "отдел",
    "подразделени",
    "служб",
    "департамент",
    "бюро",
    "сектор",
    "управлени",
    "department",
    "division",
    "section",
    "bureau",
];

// JS \b doesn't work with Cyrillic → use lookbehind/lookahead for non-letter boundaries.
const DEPARTMENT_ABBREV_RE = /(?:^|[^A-Za-zА-Яа-яЁё])(?:ОГМ|ОГЭ|ОМТС|ОТК|ПСК|ПТО|ОКС|ОИТ|УМТС|ГИП|КБ|РСО)(?:[^A-Za-zА-Яа-яЁё]|$)/;

function safeString(v) {
    if (v == null) return "";
    return String(v).trim();
}

export function isCompanyLike(value) {
    const s = safeString(value);
    if (!s) return false;
    if (COMPANY_MARKER_RE.test(s)) return true;
    if (COMPANY_SUFFIX_LAT_RE.test(s)) return true;
    return false;
}

export function isEmailLike(value) {
    const s = safeString(value);
    if (!s) return false;
    if (s.includes("@")) return true;
    // Domain-only form without @: "siderus.ru"
    if (/^[\w.-]+\.(?:ru|com|by|kz|ua|org|net|io|biz|info)$/i.test(s)) return true;
    return false;
}

export function isAliasLike(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    // Strip common separators/numbers: "Snab.online" → "snab" + "online"; "Снабжение1" → "снабжение"
    const cleaned = s.replace(/[.\-_0-9]+/g, " ").trim();
    const cyrBase = cleaned
        .replace(/снабжение/g, "snab")
        .replace(/бухгалтерия/g, "buh")
        .replace(/бухгалтер/g, "buh")
        .replace(/закупки/g, "zakup")
        .replace(/закупка/g, "zakup")
        .replace(/отдел/g, "office");

    const tokens = cyrBase.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    // Any token must be an alias AND there must be no non-alias content.
    const nonAlias = tokens.filter((t) => !ALIAS_SET.has(t));
    if (tokens.some((t) => ALIAS_SET.has(t)) && nonAlias.length === 0) return true;
    // Single-token case with numeric suffix handled above.
    if (tokens.length === 1 && ALIAS_SET.has(tokens[0])) return true;
    return false;
}

// Name-tail regex: surname+initials ("Жарихин Н.в.") or 2-3 TitleCase words
// anchored at end of string. Detects real names embedded in role-prefixed text.
// Requires either initial-dots ("Н.в.") or ≥3 consecutive TitleCase words to
// avoid matching role-compound TitleCase sequences like "Менеджер По Закупкам".
const NAME_TAIL_IN_STRING_RE =
    /(?:[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁа-яё]?\.?|[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ][а-яё]{2,})\s*[,.]?\s*$/u;
const NAME_TAIL_IN_STRING_LAT_RE =
    /(?:[A-Z][a-z]{2,}\s+[A-Z]\.|[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\s*[,.]?\s*$/;

export function isRoleOnly(value) {
    const s = safeString(value);
    if (!s) return false;
    const lower = s.toLowerCase();
    const cleaned = lower.replace(/[.,;:!?]/g, " ").replace(/\s+/g, " ").trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    const hasRoleNoun = tokens.some((t) => ROLE_NOUN_SET.has(t));
    if (!hasRoleNoun) return false;

    // Strategy 1: every token is a recognized role word.
    if (tokens.every((t) => ROLE_SET.has(t))) return true;

    // Strategy 2: role-compound with unrecognized object token(s)
    // ("менеджер по закупкам", "инженер по оборудованию"). Accept as role-only
    // when the string contains NO proper name-tail pattern.
    const firstToken = tokens[0];
    const startsWithRole =
        ROLE_NOUN_SET.has(firstToken) || ROLE_ADJECTIVE_SET.has(firstToken);
    if (!startsWithRole) return false;
    // If the string contains a clear name pattern (surname+initials or two
    // Title-case words preceded by ≥1 lowercase tokens), it's NOT role-only.
    if (NAME_TAIL_IN_STRING_RE.test(s)) return false;
    if (NAME_TAIL_IN_STRING_LAT_RE.test(s)) return false;
    return true;
}

export function isCorporateUppercase(value) {
    const s = safeString(value);
    if (!s) return false;
    // Company markers always count as corporate (ООО БВС, LLC Semicon).
    if (COMPANY_MARKER_RE.test(s)) return true;
    if (COMPANY_SUFFIX_LAT_RE.test(s)) return true;
    // Uppercase corporate domains: ESTP.RU, SITE.COM.
    if (/^[A-ZА-ЯЁ]+\.[A-ZА-ЯЁ]{2,}(?:\.[A-ZА-ЯЁ]{2,})?$/.test(s)) return true;
    // "ALL UPPERCASE" corporate blocks with ≥2 words AND total length ≥6 AND no lowercase.
    if (/^[A-ZА-ЯЁ0-9\s.\-&]+$/.test(s)) {
        const words = s.split(/\s+/).filter(Boolean);
        const letters = s.replace(/[^A-ZА-ЯЁ]/g, "");
        if (words.length >= 2 && letters.length >= 6) return true;
    }
    return false;
}

export function isDepartmentLike(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    for (const stem of DEPARTMENT_STEMS) {
        // Stem-based: leading start-or-non-letter, stem followed by any letters (inflection).
        const re = new RegExp(`(?:^|[^a-zа-яё])${stem}[a-zа-яё]{0,6}(?:[^a-zа-яё]|$)`, "i");
        if (re.test(s)) return true;
    }
    if (DEPARTMENT_ABBREV_RE.test(value)) return true;
    // Role-word followed by department stem (e.g. "начальник отдела закупок")
    const roleStems = ["начальник", "руководител", "head", "chief"];
    for (const rs of roleStems) {
        const re = new RegExp(`(?:^|[^a-zа-яё])${rs}[a-zа-яё]{0,6}\\s+[a-zа-яё]{3,}`, "i");
        if (re.test(s)) return true;
    }
    return false;
}

export const _roleSets = {
    ROLE_NOUN_SET,
    ROLE_ADJECTIVE_SET,
    ROLE_CONNECTOR_SET,
    ROLE_SET,
};

export function isBadPersonName(value) {
    const s = safeString(value);
    if (!s) return true;
    if (isCompanyLike(s)) return true;
    if (isEmailLike(s)) return true;
    if (isAliasLike(s)) return true;
    if (isRoleOnly(s)) return true;
    if (isCorporateUppercase(s)) return true;
    if (isDepartmentLike(s)) return true;
    // Non-letter-dominated strings: numbers, punctuation only.
    const letterCount = (s.match(/\p{L}/gu) || []).length;
    if (letterCount < 2) return true;
    return false;
}
