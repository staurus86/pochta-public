// phone-filters.js — negative predicates for Phone rejection.
// Goal: separate real phone sequences from requisite numbers (INN, OGRN, KPP,
// bank accounts, postal codes), articles, dates, and short/local risk cases.

function stripNonDigits(s) {
    return String(s || "").replace(/\D/g, "");
}

function hasPlusPrefix(raw) {
    return /^\s*\+/.test(String(raw || ""));
}

// Phone-style formatting: parens around area code, or groups of digits joined
// by dashes, or a leading "8" with spaces/dashes. Requisite numbers are
// printed as a continuous digit string (or with only plain spaces).
function hasPhoneStyleFormatting(raw) {
    const s = String(raw || "");
    if (/[()]/.test(s)) return true;
    if (/\d-\d/.test(s)) return true;   // dash between digits
    if (/^\s*\+/.test(s)) return true;  // leading +
    return false;
}

// INN: 10 digits (legal entity) or 12 digits (natural person), bare number.
// 11 digits cannot be INN.
export function isInnLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    if (hasPhoneStyleFormatting(raw)) return false;
    const digits = stripNonDigits(raw);
    return digits.length === 10 || digits.length === 12;
}

// OGRN: 13 digits; OGRNIP: 15 digits.
export function isOgrnLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    if (hasPhoneStyleFormatting(raw)) return false;
    const digits = stripNonDigits(raw);
    return digits.length === 13 || digits.length === 15;
}

// KPP: 9 digits, usually XXXX01001 pattern.
export function isKppLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    if (hasPhoneStyleFormatting(raw)) return false;
    const digits = stripNonDigits(raw);
    return digits.length === 9;
}

// Bank account: 20 digits.
export function isBankAccountLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    if (hasPhoneStyleFormatting(raw)) return false;
    const digits = stripNonDigits(raw);
    return digits.length === 20;
}

// BIK: 9 digits starting with 04 (RF banks). Treat same as KPP collision —
// we already reject 9-digit bare numbers.
export function isBikLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    const digits = stripNonDigits(raw);
    return digits.length === 9 && /^04/.test(digits);
}

// RF postal code: bare 6 digits.
export function isPostalCodeLike(raw) {
    if (hasPlusPrefix(raw)) return false;
    const s = String(raw || "").trim();
    // Only a pure 6-digit block — not part of a phone.
    return /^\d{6}$/.test(s);
}

// Article-like: mixed alphanumeric with dashes (e.g., "6ES7 214-1AG40-0XB0")
// or purely latin-digit token of 4+ chars containing at least one letter.
export function isArticleLike(raw) {
    const s = String(raw || "").trim();
    if (/[A-Za-zА-Яа-я]/.test(s) && /\d/.test(s)) return true;
    return false;
}

// Date-like: dd.mm.yyyy or yyyy-mm-dd or dd/mm/yyyy.
export function isDateLike(raw) {
    const s = String(raw || "").trim();
    if (/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(s)) return true;
    if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(s)) return true;
    return false;
}

// Risky short: less than 7 digits total → too short to be routable.
export function isRiskyShort(raw) {
    const digits = stripNonDigits(raw);
    return digits.length > 0 && digits.length < 7;
}

// Valid phone digit count: 7..15 inclusive (E.164 upper bound).
export function isPhoneDigitCountValid(raw) {
    const digits = stripNonDigits(raw);
    return digits.length >= 7 && digits.length <= 15;
}

// Local-only: 10 digits without country code, not starting with mobile prefix.
export function isLocalOnly(raw) {
    if (hasPlusPrefix(raw)) return false;
    const digits = stripNonDigits(raw);
    // 7-digit bare subscriber, no area code.
    return digits.length === 7;
}

// Composite rejection reason (null if valid candidate).
export function classifyRejectionReason(raw) {
    if (!raw) return "empty";
    if (isDateLike(raw)) return "date_like";
    if (isPostalCodeLike(raw)) return "postal_code";
    if (isBankAccountLike(raw)) return "bank_account";
    if (isOgrnLike(raw)) return "ogrn_like";
    if (isInnLike(raw)) return "inn_like";
    if (isKppLike(raw)) return "kpp_like";
    if (isArticleLike(raw) && !/^\+?\d[\d\s().\-+]+$/.test(raw)) return "article_like";
    if (!isPhoneDigitCountValid(raw)) return "digit_count_invalid";
    if (isRiskyShort(raw)) return "too_short";
    return null;
}
