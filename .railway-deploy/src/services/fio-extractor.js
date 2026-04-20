// fio-extractor.js — facade for person-name extraction.
// Priority cascade: signature > form_fields > body > senderDisplay > email_local.
// Each candidate is filtered (isBadPersonName), composite-split, bilingual-split,
// honorific-stripped, role-tail-stripped, and scored.

import {
    isBadPersonName,
    isCompanyLike,
    isEmailLike,
    isAliasLike,
    isRoleOnly,
    isCorporateUppercase,
    isDepartmentLike,
} from "./fio-filters.js";
import {
    splitCompositeCompanyPerson,
    splitBilingualName,
    stripHonorific,
    stripRoleTail,
    stripRolePrefix,
    normalizePersonName,
} from "./fio-normalizer.js";

// Scan signature block for a clean person-name line.
// Skip: greeting ("С уважением"), company markers, role-only lines, emails, phones.
const GREETING_PREFIX_RE = /^(?:с\s+уважением|best\s+regards|regards|thanks|kind\s+regards|sincerely|truly|yours|wbr|br)[,.!\s]*/i;
const PHONE_LIKE_RE = /^\+?\d[\d\s\-().]{5,}$/;

function cleanSignatureLine(line) {
    let s = String(line || "").trim();
    if (!s) return "";
    s = s.replace(GREETING_PREFIX_RE, "").trim();
    // Strip leading "--" separator.
    s = s.replace(/^-+\s*/, "").trim();
    return s;
}

function extractNameFromSignature(signature) {
    if (!signature) return null;
    const lines = String(signature)
        .split(/\r?\n/)
        .map((l) => cleanSignatureLine(l))
        .filter(Boolean);
    for (const line of lines) {
        if (PHONE_LIKE_RE.test(line)) continue;
        if (isEmailLike(line)) continue;
        if (isCompanyLike(line)) continue;
        if (isRoleOnly(line)) continue;
        if (isAliasLike(line)) continue;
        if (isDepartmentLike(line)) continue;
        // Candidate must have at least one letter and ≤ 6 words.
        const wc = line.split(/\s+/).filter(Boolean).length;
        if (wc === 0 || wc > 6) continue;
        if (!/\p{L}/u.test(line)) continue;
        return line;
    }
    return null;
}

// Extract "Контактное лицо: X" / "Ф.И.О.: X" from body text.
const BODY_NAME_PATTERNS = [
    /(?:контактное\s+лицо|контакт|ответственный|менеджер|заказчик)[:\-–]\s*([^\n,;]{2,80})/i,
    /Ф\.?\s?И\.?\s?О\.?[:\-–]?\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,2})/,
    /(?:contact|attn|name)[:\-–]\s*([A-Za-z][A-Za-z\s.]{2,60})/i,
];

function extractNameFromBody(body) {
    if (!body) return null;
    const text = String(body).slice(0, 8000);
    for (const re of BODY_NAME_PATTERNS) {
        const m = text.match(re);
        if (m && m[1]) {
            const candidate = m[1].trim();
            if (!isBadPersonName(candidate)) return candidate;
        }
    }
    return null;
}

// Email-local → "ivan.petrov" → "Ivan Petrov". Last-resort.
function nameFromEmailLocal(emailLocal) {
    if (!emailLocal) return null;
    const s = String(emailLocal).trim();
    if (!s) return null;
    if (isAliasLike(s)) return null;
    // Reject pure digits or single-char.
    if (/^\d+$/.test(s) || s.length < 3) return null;
    // Split on . _ -
    const parts = s.split(/[._\-]+/).filter(Boolean);
    if (parts.length === 0) return null;
    // All parts must be alpha-ish.
    const allAlpha = parts.every((p) => /^[A-Za-zА-Яа-яЁё]+$/.test(p));
    if (!allAlpha) return null;
    if (parts.length === 1 && parts[0].length < 3) return null;
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

function scoreCandidate(name, source) {
    if (!name) return 0;
    const words = name.split(/\s+/).filter(Boolean);
    const wc = words.length;

    // Source base score.
    const sourceBase = {
        signature: 0.85,
        form: 0.9,
        body: 0.8,
        sender: 0.75,
        email_local: 0.3,
    }[source] || 0.5;

    // Word-count bonus.
    let bonus = 0;
    if (wc >= 2 && wc <= 4) bonus = 0.05;
    else if (wc === 1) bonus = -0.25;
    else if (wc > 4) bonus = -0.1;

    // Cyrillic or Latin proper-name pattern boost.
    const proper = /^[A-ZА-ЯЁ][a-zа-яё]+(\s+[A-ZА-ЯЁ][a-zа-яё]+)*$/.test(name);
    if (proper && wc >= 2) bonus += 0.05;

    let score = Math.max(0, Math.min(1, sourceBase + bonus));
    // Cap email_local: it's a last-resort guess, never high confidence.
    if (source === "email_local") score = Math.min(score, 0.45);
    return score;
}

// Post-process a raw candidate: composite split, bilingual split, honorific, role-tail, normalize.
// Returns { primary, alt, company, role }.
function postProcess(rawCandidate) {
    if (!rawCandidate) return null;
    let value = String(rawCandidate).trim();
    if (!value) return null;

    // 1. Strip honorific.
    value = stripHonorific(value);
    if (!value) return null;

    // 2. Composite split (company vs person).
    const comp = splitCompositeCompanyPerson(value);
    const personCandidate = comp.person || value;
    const company = comp.company || null;

    // 3. Bilingual split.
    const bil = splitBilingualName(personCandidate);

    // 4. Extract role tail before normalizing.
    // JS `\b` does NOT fire at Cyrillic boundaries — use Unicode-safe lookarounds.
    let primary = bil.primary;
    let role = null;
    const roleMatch = primary.match(/[\s,;/]+(manager|director|engineer|specialist|менеджер|директор|инженер|специалист|механик|энергетик|бухгалтер|начальник|руководитель|коммерции|закупкам|продажам|снабжению)(?![A-Za-zА-Яа-яЁё]).*$/iu);
    if (roleMatch) {
        role = roleMatch[1].toLowerCase();
        primary = stripRoleTail(primary);
    }

    // 4b. Strip leading role prefix: "Менеджер По Закупкам Жарихин Н.в." → "Жарихин Н.в."
    const withoutRolePrefix = stripRolePrefix(primary);
    if (withoutRolePrefix && withoutRolePrefix !== primary) {
        // Only accept the strip if remainder still looks like a name (≥1 letter token).
        if (/[A-Za-zА-Яа-яЁё]/.test(withoutRolePrefix)) {
            const wordCount = withoutRolePrefix.split(/\s+/).filter(Boolean).length;
            if (wordCount >= 1) primary = withoutRolePrefix;
        }
    }

    // 5. Normalize.
    primary = normalizePersonName(primary);
    const alt = bil.alt ? normalizePersonName(bil.alt) : null;

    return { primary, alt, company, role };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public facade
// ─────────────────────────────────────────────────────────────────────────────
export function extractPersonName(input = {}) {
    const {
        senderDisplay = "",
        signature = "",
        formFields = null,
        body = "",
        emailLocal = "",
    } = input;

    const rejected = [];
    const evalCandidate = (raw, source) => {
        if (!raw) return null;
        const value = String(raw).trim();
        if (!value) return null;
        if (isBadPersonName(value)) {
            // Composite like "ИП Foo - Елена" is "bad" at the top level but splittable.
            const comp = splitCompositeCompanyPerson(value);
            if (comp.company && comp.person && !isBadPersonName(comp.person)) {
                const pp = postProcess(value);
                if (pp && pp.primary && !isBadPersonName(pp.primary)) {
                    return { ...pp, source };
                }
            }
            rejected.push({ value, source, reason: classifyReject(value) });
            return null;
        }
        const pp = postProcess(value);
        if (!pp || !pp.primary) return null;
        if (isBadPersonName(pp.primary)) {
            rejected.push({ value: pp.primary, source, reason: classifyReject(pp.primary) });
            return null;
        }
        return { ...pp, source };
    };

    // Always evaluate senderDisplay first for rejected-tracking purposes,
    // but use priority cascade (signature > form > body > sender > email_local)
    // when picking the primary.
    const senderEval = senderDisplay ? evalCandidate(senderDisplay, "sender") : null;

    // Form fields priority: "ФИО", "Контактное лицо"
    let result = null;
    if (formFields && typeof formFields === "object") {
        const fioKeys = ["fio", "ФИО", "Ф.И.О.", "Контактное лицо", "contact_person", "name"];
        for (const k of fioKeys) {
            if (formFields[k]) {
                const r = evalCandidate(formFields[k], "form");
                if (r) {
                    result = r;
                    break;
                }
            }
        }
    }

    // Signature priority.
    if (!result && signature) {
        const sigName = extractNameFromSignature(signature);
        if (sigName) {
            const r = evalCandidate(sigName, "signature");
            if (r) result = r;
        }
    }

    // Body "Контактное лицо:"
    if (!result && body) {
        const bodyName = extractNameFromBody(body);
        if (bodyName) {
            const r = evalCandidate(bodyName, "body");
            if (r) result = r;
        }
    }

    // Sender display (already evaluated for rejected-tracking).
    if (!result && senderEval) result = senderEval;

    // Email-local last-resort.
    if (!result && emailLocal) {
        const guess = nameFromEmailLocal(emailLocal);
        if (guess) {
            const r = evalCandidate(guess, "email_local");
            if (r) result = r;
        }
    }

    if (!result) {
        return {
            primary: null,
            alt: null,
            company: null,
            role: null,
            source: null,
            confidence: 0,
            needsReview: true,
            rejected,
        };
    }

    const confidence = scoreCandidate(result.primary, result.source);
    return {
        primary: result.primary,
        alt: result.alt || null,
        company: result.company || null,
        role: result.role || null,
        source: result.source,
        confidence,
        needsReview: confidence < 0.7,
        rejected,
    };
}

function classifyReject(value) {
    if (isCompanyLike(value)) return "company";
    if (isEmailLike(value)) return "email";
    if (isAliasLike(value)) return "alias";
    if (isRoleOnly(value)) return "role";
    if (isCorporateUppercase(value)) return "corporate_uppercase";
    if (isDepartmentLike(value)) return "department";
    return "bad_name";
}
