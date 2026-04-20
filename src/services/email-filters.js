// email-filters.js — Phase 9 Email extractor.
// Classify local-part (person/role/system/noreply/unknown),
// classify domain (public_provider/corporate/platform/unknown),
// source-of-truth rules for cross-field inference.

// Role keywords (presence in local-part → role_mailbox).
// Matched as whole-token or as ASCII substring with separator boundary.
export const ROLE_KEYWORDS = [
    // sales / orders
    "sales", "zakaz", "order", "orders", "trade",
    // info / office / general
    "info", "office", "contact", "contacts", "mail", "admin", "secretary",
    "reception", "hello", "welcome",
    // support
    "support", "help", "service", "servis", "helpdesk",
    // management / purchasing
    "manager", "management", "director", "procurement", "purchase",
    "purchases", "snab", "snabzhenie", "snabgenie", "zakupki",
    // HR / finance
    "hr", "personal", "buh", "buhgalter", "accounting", "finance", "finans",
    // tender / bids
    "tender", "tenders", "bid", "bids",
    // marketing / PR
    "marketing", "pr",
    // departments
    "otdel", "otdel.prodag", "otdel.zakupok", "dispatcher", "logist", "logistics",
    // shipping / warehouse
    "warehouse", "sklad",
];

// System keywords (presence → system_email / noreply_email).
export const SYSTEM_KEYWORDS_NOREPLY = [
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
];

export const SYSTEM_KEYWORDS_DAEMON = [
    "mailer-daemon", "mailerdaemon", "postmaster", "bounce", "bounces",
    "notification", "notifications", "notify", "robot", "bot", "daemon",
    "system", "automailer", "alert", "alerts",
];

// Public provider domains (email cannot define Company).
export const PUBLIC_PROVIDER_DOMAINS = new Set([
    // RU
    "mail.ru", "bk.ru", "list.ru", "inbox.ru", "internet.ru",
    "yandex.ru", "ya.ru", "yandex.com", "yandex.by", "yandex.kz", "yandex.ua",
    "rambler.ru", "lenta.ru", "r0.ru", "ro.ru", "autorambler.ru",
    "km.ru", "pochta.ru",
    // Intl
    "gmail.com", "googlemail.com",
    "hotmail.com", "hotmail.ru", "outlook.com", "outlook.ru", "live.com", "msn.com",
    "yahoo.com", "yahoo.ru", "ymail.com", "rocketmail.com",
    "icloud.com", "me.com", "mac.com",
    "protonmail.com", "proton.me", "pm.me",
    "aol.com", "gmx.com", "gmx.net", "fastmail.com",
    "tutanota.com", "tutanota.de", "tutamail.com",
    "zoho.com", "zohomail.com",
]);

// Platform domains (site builders, marketplaces, ticketing — NOT client company).
export const PLATFORM_DOMAINS = new Set([
    "tilda.ws", "tildacdn.com",
    "wildberries.ru", "wb.ru",
    "ozon.ru",
    "tenderpro.ru",
    "sbis.ru",
    "b2b-center.ru",
    "zakupki.gov.ru",
]);

// Normalize for keyword lookup: lowercase, collapse separators to single char.
function localForMatch(local) {
    return String(local || "").toLowerCase();
}

// Token-style boundary check for ASCII keyword inside mixed local-part.
// Example: "otdel.prodag" → matches "otdel" (boundary = start/dot).
function hasKeyword(local, keyword) {
    const s = localForMatch(local);
    if (!s) return false;
    if (s === keyword) return true;
    // Boundary characters that separate tokens.
    const pattern = new RegExp(
        `(?:^|[^a-z0-9])${escapeRe(keyword)}(?:[^a-z0-9]|$)`,
        "i"
    );
    return pattern.test(s);
}

function escapeRe(s) {
    return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

// Classify local-part → person_email | role_mailbox | system_email | noreply_email | unknown.
export function classifyLocalPart(local) {
    const s = localForMatch(local);
    if (!s) return "unknown";

    // Noreply first (more specific than system).
    for (const kw of SYSTEM_KEYWORDS_NOREPLY) {
        if (hasKeyword(s, kw)) return "noreply_email";
    }
    for (const kw of SYSTEM_KEYWORDS_DAEMON) {
        if (hasKeyword(s, kw)) return "system_email";
    }
    for (const kw of ROLE_KEYWORDS) {
        if (hasKeyword(s, kw)) return "role_mailbox";
    }

    // Otherwise: treat as person_email (default bias toward person —
    // corporate mailbox naming conventions `ivan.petrov`, `a.smirnov`, etc.).
    // Only unknown when string is empty/null (handled above).
    return "person_email";
}

// Classify domain → public_provider | platform | corporate | unknown.
export function classifyDomain(domain) {
    const s = String(domain || "").toLowerCase().trim();
    if (!s) return "unknown";
    if (PUBLIC_PROVIDER_DOMAINS.has(s)) return "public_provider";
    if (PLATFORM_DOMAINS.has(s)) return "platform";
    // Sanity: must have at least one dot and non-space chars → corporate.
    if (!/^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/.test(s)) return "unknown";
    return "corporate";
}

// Source-of-truth rules — may this email define the given field?
// field ∈ "person" | "company"
export function canUseAsTruthSource(classified, field) {
    if (!classified) return false;
    const { type, domainType } = classified;

    // System / noreply → never a source.
    if (type === "system_email" || type === "noreply_email") return false;

    if (field === "person") {
        // Role mailbox → not a person.
        if (type === "role_mailbox") return false;
        // person_email on any domain → can define person (use local-part hint).
        return true;
    }

    if (field === "company") {
        // Public provider → can never be authoritative for Company.
        if (domainType === "public_provider") return false;
        // Platform domain → not a client company.
        if (domainType === "platform") return false;
        // Unknown domain → cannot infer.
        if (domainType === "unknown") return false;
        return true;
    }

    return false;
}

// Export shared keyword table for reuse/tests.
export const SYSTEM_KEYWORDS = [...SYSTEM_KEYWORDS_NOREPLY, ...SYSTEM_KEYWORDS_DAEMON];
