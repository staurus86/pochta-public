// position-normalizer.js — strip tails (company/person/contact), bilingual split,
// department separation.

import { hasRoleWord, _internals } from "./position-filters.js";

const { COMPANY_MARKER_RU_RE, COMPANY_MARKER_LAT_RE, DEPT_STEMS } = _internals;

const WB = "(?:^|[^A-Za-zА-Яа-яЁё0-9_])";

function collapse(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function trimEdges(s) {
    return String(s || "")
        .replace(/^[\s,;:.!()[\]"'«»\\\/|\-–—]+/g, "")
        .replace(/[\s,;:.!()[\]"'«»\\\/|\-–—]+$/g, "")
        .trim();
}

// Remove trailing company marker + everything after.
// "Менеджер ООО Ромашка" → "Менеджер"; leaves input untouched if no marker.
export function stripCompanyTail(value) {
    let s = collapse(String(value || ""));
    if (!s) return "";
    const ruMarker = s.search(/(?:^|\s)(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|НКО|ИП|НПФ|НПП|НПО|ТК|ТД|ТПК|ПКФ|ГК|ФГБУ|ФГАОУ|ФГБОУ|Филиал)(?:\s|[«"'(]|$)/i);
    if (ruMarker > 0) {
        s = s.slice(0, ruMarker).trim();
    }
    const latMarker = s.search(/\s(?:LLC|Ltd|Limited|Inc|Corp|Corporation|Company|GmbH|AG|SA|SARL|BV|NV|JSC|PLC|KG|SpA|Srl|Pty)(?:\s|[.,«"']|$)/i);
    if (latMarker > 0) {
        s = s.slice(0, latMarker).trim();
    }
    return trimEdges(s);
}

// Remove trailing 2-3 Title-case word block (surname+name) + initials.
// "Менеджер Иванов Иван" → "Менеджер".
export function stripPersonTail(value) {
    let s = collapse(String(value || ""));
    if (!s) return "";
    // Initials tail: " Иванов И.И." or " Иванов И. И."
    s = s.replace(/\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]?\.?\s*$/u, "");
    // 2-3 Title-case Cyrillic word tail.
    s = s.replace(/\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}\s*$/u, (match) => {
        // Preserve if the matched tail contains a role word.
        const tail = match.trim();
        if (hasRoleWord(tail)) return match;
        return "";
    });
    // 2-3 Title-case Latin word tail.
    s = s.replace(/\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\s*$/, (match) => {
        const tail = match.trim();
        if (hasRoleWord(tail)) return match;
        return "";
    });
    return trimEdges(s);
}

// Remove trailing phone / email / url.
export function stripContactTail(value) {
    let s = collapse(String(value || ""));
    if (!s) return "";
    // Email tail.
    s = s.replace(/\s+\S+@[\w.-]+\.[a-z]{2,}\S*\s*$/i, "");
    // URL tail.
    s = s.replace(/\s+(?:https?:\/\/|www\.)\S+\s*$/i, "");
    // Phone tail — including "+7 ...", "8-800-...", "Тел: ...".
    s = s.replace(/\s+(?:тел|tel|моб|mob|ф\.|т\.|phone|fax|факс)[:.\s]*[\d+()\s\-]{6,}\s*$/i, "");
    s = s.replace(/\s+[+]?\d[\d\s()\-]{5,}\s*$/, "");
    return trimEdges(s);
}

// Split "Главный инженер | Chief Engineer" → { ru, en }.
// Separators: " | ", " / ", " — ", " - " (only when both halves look like roles).
export function splitBilingualRole(value) {
    const s = collapse(String(value || ""));
    if (!s) return { ru: s, en: null };
    const sepRe = /\s*[|/]\s*/;
    if (sepRe.test(s)) {
        const parts = s.split(sepRe).map((p) => p.trim()).filter(Boolean);
        if (parts.length === 2) {
            const [a, b] = parts;
            const aIsRu = /[А-Яа-яЁё]/.test(a);
            const bIsEn = /^[A-Za-z][A-Za-z\s\-]+$/.test(b);
            if (aIsRu && bIsEn) return { ru: a, en: b };
            const aIsEn = /^[A-Za-z][A-Za-z\s\-]+$/.test(a);
            const bIsRu = /[А-Яа-яЁё]/.test(b);
            if (aIsEn && bIsRu) return { ru: b, en: a };
        }
    }
    return { ru: s, en: null };
}

// Split "Начальник отдела закупок" → { role: "Начальник", department: "отдела закупок" }.
// Split "Менеджер отдела снабжения" → { role: "Менеджер", department: "отдела снабжения" }.
// Plain role without dept → { role, department: null }.
export function separateDepartmentFromRole(value) {
    const s = collapse(String(value || ""));
    if (!s) return { role: s, department: null };

    // Find department stem position.
    let deptIdx = -1;
    for (const stem of DEPT_STEMS) {
        const re = new RegExp(`(?:^|[^a-zа-яё])(${stem}[a-zа-яё]{0,6})(?:[^a-zа-яё]|$)`, "i");
        const m = re.exec(s);
        if (m) {
            deptIdx = m.index + m[0].indexOf(m[1]);
            break;
        }
    }
    if (deptIdx <= 0) return { role: s, department: null };

    const role = trimEdges(s.slice(0, deptIdx));
    const department = trimEdges(s.slice(deptIdx));
    if (!role || !department) return { role: s, department: null };
    return { role, department };
}

// Full cleanup pipeline for a single candidate.
// Does NOT separate department — facade decides whether to emit it separately.
export function normalizePosition(value) {
    if (value == null) return "";
    let s = collapse(String(value));
    if (!s) return "";
    s = stripContactTail(s);
    s = stripCompanyTail(s);
    s = stripPersonTail(s);
    s = trimEdges(s);
    s = collapse(s);
    return s;
}
