// company-filters.js — negative predicates for company rejection.

const GENERIC_PROVIDERS = new Set([
    "gmail",
    "gmai",
    "googlemail",
    "google",
    "yandex",
    "ya",
    "yahoo",
    "mail",
    "bk",
    "list",
    "inbox",
    "hotmail",
    "outlook",
    "live",
    "msn",
    "icloud",
    "me",
    "aol",
    "rambler",
    "foxmail",
    "qq",
    "163",
    "sina",
    "zoho",
    "proton",
    "protonmail",
    "gmx",
    "web",
    "tutanota",
    "fastmail",
    "t-online",
    "att",
    "comcast",
    "verizon",
    "ukr",
    "i",
    "me",
]);

const GENERIC_PROVIDER_DOMAINS = new Set([
    "gmail.com",
    "yandex.ru",
    "yandex.com",
    "ya.ru",
    "mail.ru",
    "bk.ru",
    "list.ru",
    "inbox.ru",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "me.com",
    "rambler.ru",
    "foxmail.com",
    "qq.com",
    "proton.me",
    "protonmail.com",
    "gmx.com",
    "gmx.de",
    "web.de",
    "googlemail.com",
    "aol.com",
    "ukr.net",
    "i.ua",
]);

const COMPANY_LEGAL_MARKER_RE = /(?:^|[\s"'«»(\[.,])(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|НКО|ИП|НПФ|ТК|ТД|ТПК|НПП|НПО|ПКФ|ФГБУ|ФГАОУ|ФГБОУ)(?:[\s"'«»).,\]]|$)/i;
const COMPANY_LEGAL_LAT_RE = /(?:^|[\s"'«»(\[.,])(?:LLC|Ltd|Limited|Inc|Incorporated|Corp|Corporation|Company|Co|GmbH|AG|SA|SARL|BV|NV|OOO|JSC|PLC|KG|OHG|SpA|Srl|Pty)(?:[\s"'«»).,\]]|$)/i;

// Person-like: 2-3 Title-case Cyrillic/Latin words WITHOUT any company marker.
// Single-token is ambiguous (Alексей vs Tatenergo) — handled via FIRST_NAMES below.
const PERSON_LIKE_CYR_RE = /^[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}$/;
const PERSON_LIKE_LAT_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/;

// Curated common Russian first names — single-token disambiguator.
// A single-token value matching these is treated as person-like.
const RU_FIRST_NAMES = new Set([
    "Алексей", "Александр", "Андрей", "Антон", "Аббос", "Артём", "Артем",
    "Борис", "Валерий", "Василий", "Виктор", "Владимир", "Владислав",
    "Вячеслав", "Геннадий", "Георгий", "Григорий", "Денис", "Дмитрий",
    "Евгений", "Егор", "Иван", "Игорь", "Илья", "Константин", "Леонид",
    "Максим", "Михаил", "Николай", "Олег", "Павел", "Пётр", "Петр",
    "Роман", "Сергей", "Станислав", "Степан", "Юрий", "Ярослав",
    "Анна", "Алёна", "Алена", "Анастасия", "Валентина", "Вера", "Виктория",
    "Галина", "Дарья", "Евгения", "Екатерина", "Елена", "Елизавета",
    "Ирина", "Ксения", "Лариса", "Людмила", "Марина", "Мария", "Надежда",
    "Наталья", "Нина", "Оксана", "Ольга", "Полина", "Светлана", "София",
    "Татьяна", "Юлия",
]);

// Department stems.
const DEPT_STEMS = [
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

const ROLE_WORDS = [
    "менеджер",
    "директор",
    "руководитель",
    "начальник",
    "инженер",
    "специалист",
    "бухгалтер",
    "секретарь",
    "оператор",
    "консультант",
    "технолог",
    "закупщик",
    "снабженец",
    "manager",
    "director",
    "engineer",
    "specialist",
    "supervisor",
    "accountant",
    "secretary",
    "operator",
    "consultant",
    "procurement",
    "buyer",
    "purchaser",
    "coordinator",
    "assistant",
    "head",
    "chief",
    "owner",
];

// Requisite markers that indicate overcapture (company + tail garbage).
// JS `\b` does not work at Cyrillic text boundaries → use explicit non-letter lookarounds.
const WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])";
const WE = "(?:[^A-Za-zА-Яа-яЁё0-9_]|$)";
const REQUISITE_MARKERS = [
    new RegExp(`${WB}ИНН\\s*[:\\s]?\\d`, "i"),
    new RegExp(`${WB}КПП\\s*[:\\s]?\\d`, "i"),
    new RegExp(`${WB}ОГРН\\s*[:\\s]?\\d`, "i"),
    new RegExp(`${WB}ОКПО${WE}`, "i"),
    new RegExp(`${WB}дата\\s+регистрации${WE}`, "i"),
    new RegExp(`${WB}организационно-?правовая\\s+форма${WE}`, "i"),
    new RegExp(`${WB}действующ\\w*\\s+на\\s+основании${WE}`, "i"),
    new RegExp(`${WB}на\\s+основании\\s+устава`, "i"),
    new RegExp(`${WB}общество\\s+с\\s+ограниченной\\s+ответственност`, "i"),
    new RegExp(`${WB}г\\.\\s*[А-ЯЁ]`),
    new RegExp(`${WB}город\\s+[А-ЯЁ]`, "i"),
    new RegExp(`${WB}ул\\.\\s+[А-ЯЁ]`, "i"),
    new RegExp(`${WB}адрес${WE}`, "i"),
    new RegExp(`${WB}юридический\\s+адрес${WE}`, "i"),
    new RegExp(`${WB}(?:р\\/с|к\\/с|БИК)${WE}`),
];

function safeString(v) {
    if (v == null) return "";
    return String(v).trim();
}

export function isGenericProvider(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    if (GENERIC_PROVIDER_DOMAINS.has(s)) return true;
    // Strip .tld suffix and check core label.
    const core = s.replace(/\.(?:com|ru|net|org|io|biz|info|de|cn|by|kz|ua)$/i, "");
    if (GENERIC_PROVIDERS.has(core)) return true;
    if (GENERIC_PROVIDERS.has(s)) return true;
    return false;
}

export function isPersonLikeCompany(value) {
    const s = safeString(value);
    if (!s) return false;
    // Has company marker → not a person-like false positive.
    if (COMPANY_LEGAL_MARKER_RE.test(s) || COMPANY_LEGAL_LAT_RE.test(s)) return false;
    // 2-3 Title-Case words (Cyr or Lat) — clearly person-like.
    if (PERSON_LIKE_CYR_RE.test(s)) return true;
    if (PERSON_LIKE_LAT_RE.test(s)) return true;
    // Single-token disambiguation: only flag as person if it's a known Russian first name.
    // "Tatenergo" / "Hhr" (single Latin token) — NOT person-like (handled by isDomainLabelOnly).
    if (RU_FIRST_NAMES.has(s)) return true;
    return false;
}

export function isDepartmentCompany(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    for (const stem of DEPT_STEMS) {
        const re = new RegExp(`(?:^|[^a-zа-яё])${stem}[a-zа-яё]{0,6}(?:[^a-zа-яё]|$)`, "i");
        if (re.test(s)) return true;
    }
    return false;
}

export function isRoleCompany(value) {
    const s = safeString(value).toLowerCase();
    if (!s) return false;
    const cleaned = s.replace(/[.,;:!?()"'«»]/g, " ").replace(/\s+/g, " ").trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    // If any first token is a role word → role-prefixed string.
    if (ROLE_WORDS.includes(tokens[0])) return true;
    // If all tokens are roles → pure role.
    if (tokens.every((t) => ROLE_WORDS.includes(t))) return true;
    // English "X Specialist/Manager" or "Sales Manager" two-word role.
    if (tokens.length === 2) {
        if (ROLE_WORDS.includes(tokens[0]) || ROLE_WORDS.includes(tokens[1])) {
            // only reject if both are role/English corporate nouns — skip false positive like "ООО Manager"
            const hasLegal = COMPANY_LEGAL_MARKER_RE.test(value) || COMPANY_LEGAL_LAT_RE.test(value);
            if (!hasLegal) return true;
        }
    }
    return false;
}

export function isOvercaptureBlob(value) {
    const s = safeString(value);
    if (!s) return false;
    if (s.length < 15) return false;
    let hits = 0;
    for (const re of REQUISITE_MARKERS) {
        if (re.test(s)) {
            hits += 1;
            if (hits >= 1) return true;
        }
    }
    return false;
}

// "Tatenergo" / "Hhr" / "Rdegroup" — single token, no legal marker, looks like
// a domain-derived label.
export function isDomainLabelOnly(value) {
    const s = safeString(value);
    if (!s) return false;
    if (COMPANY_LEGAL_MARKER_RE.test(s) || COMPANY_LEGAL_LAT_RE.test(s)) return false;
    // Cyrillic multi-word "Татэнерго" would be fine — single token lat/cyr with no context.
    const tokens = s.split(/[\s\-]+/).filter(Boolean);
    if (tokens.length !== 1) return false;
    const t = tokens[0];
    // Must be a reasonably long token (3-20 chars).
    if (t.length < 3 || t.length > 25) return false;
    // Mostly lowercase after first letter → domain-derived title-case.
    if (/^[A-ZА-ЯЁ][a-zа-яё]{2,}$/.test(t)) return true;
    return false;
}

export function isBadCompany(value) {
    const s = safeString(value);
    if (!s) return true;
    if (isGenericProvider(s)) return true;
    if (isPersonLikeCompany(s)) return true;
    if (isDepartmentCompany(s)) return true;
    if (isRoleCompany(s)) return true;
    // Overcapture blob is "bad" as-is, but can be cleaned — handled downstream.
    if (isOvercaptureBlob(s)) return true;
    // Email address as company.
    if (/@/.test(s)) return true;
    // Letters count too low.
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (letters < 2) return true;
    return false;
}
