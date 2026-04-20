// company-extractor.js — facade for company extraction.
// Priority: form_fields > signature > body > sender_display > email_domain (weak).

import {
    isBadCompany,
    isGenericProvider,
    isPersonLikeCompany,
    isDepartmentCompany,
    isRoleCompany,
    isOvercaptureBlob,
    isDomainLabelOnly,
} from "./company-filters.js";
import {
    stripRequisiteTails,
    splitCompositeForCompany,
    normalizeLegalQuotes,
    normalizeCompanyName,
} from "./company-normalizer.js";

const COMPANY_LEGAL_RE = /(?:^|[\s"'«»(\[.,])(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП|НКО|ИП|ТК|ТД|LLC|Ltd|GmbH|AG|Inc|Corp|Company|Corporation)(?:[\s"'«»).,\]]|$)/i;

// Extract legal-entity candidates (ООО/АО/LLC) from a block of text.
function findLegalEntities(text) {
    if (!text) return [];
    const results = [];
    // JS \w = [A-Za-z0-9_] (no Cyrillic) → inline [А-Яа-яЁё\w\-.\s] for Cyrillic tails.
    const patterns = [
        // Russian legal with nested/malformed quotes: АО "Концерн "Моринсис - Агат"" — captures full line-bound span.
        /(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП)\s+"[^\n]{2,150}"/g,
        // Russian legal with proper quotes: "ООО «X»", 'АО "X"'.
        /(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП)\s+[«][^»]{2,60}[»]/g,
        /(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП)\s+[А-ЯЁA-Z][А-Яа-яЁё\w\-.\s]{1,50}?(?=[,.;!?]|$|\s{2,})/g,
        /(?:ООО|ОАО|АО|ЗАО|ПАО|ФГУП|МУП|ГУП)\s+[А-ЯЁA-Z][А-Яа-яЁё\w\-.]*(?:\s+[А-ЯЁA-Zа-яёa-z][А-Яа-яЁё\w\-.]*){0,5}/g,
        /ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.?\s*[А-ЯЁ]?\.?)?/g,
        /(?:ТК|ТД|НПП|НПО|НПФ|ПКФ)\s+[«"][^»"]{2,60}[»"]/g,
        /(?:ТК|ТД|НПП|НПО|НПФ|ПКФ)\s+[А-ЯЁA-Z][А-Яа-яЁё\w\-.\s]{2,50}/g,
        // Latin legal suffixes
        /[A-Z][\w&\s.\-]{2,60}\s+(?:LLC|Ltd|Limited|Inc|Corp|Corporation|Company|GmbH|AG|SA|BV|NV|JSC|PLC)\b/g,
        /(?:LLC|Ltd|Limited|Inc|Corp|Corporation|Company|GmbH|AG|JSC|PLC)\s+[A-Z][\w&\s.\-]{2,60}/g,
    ];
    for (const p of patterns) {
        const matches = text.match(p);
        if (matches) results.push(...matches);
    }
    // Dedup
    return [...new Set(results.map((m) => m.trim()))];
}

// Extract "Компания: X" / "Company: X" label patterns.
function findLabeledCompany(text) {
    if (!text) return [];
    const out = [];
    const labelRe = /(?:Компания|Организация|Наименование\s+организации|Company|Organization)[:\-–]?\s*([^\n]{2,120})/gi;
    for (const m of text.matchAll(labelRe)) {
        if (m[1]) out.push(m[1].trim());
    }
    return out;
}

// Single-pass cleanup: strip tails → normalize quotes → trim.
function cleanRawCandidate(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    s = stripRequisiteTails(s);
    s = normalizeLegalQuotes(s);
    s = normalizeCompanyName(s);
    return s;
}

function scoreCandidate(candidate) {
    if (!candidate || !candidate.value) return 0;
    const { value, source } = candidate;
    const sourceBase = {
        form: 0.9,
        signature: 0.85,
        body: 0.8,
        sender: 0.7,
        email_domain: 0.35,
    }[source] || 0.5;
    let bonus = 0;
    if (COMPANY_LEGAL_RE.test(value)) bonus += 0.1;
    if (/[«»"]/.test(value)) bonus += 0.05;
    if (value.length >= 5 && value.length <= 80) bonus += 0.02;
    if (value.length > 120) bonus -= 0.1;
    if (isDomainLabelOnly(value)) bonus -= 0.2;
    if (/\d{4,}/.test(value)) bonus -= 0.1;
    return Math.max(0, Math.min(1, sourceBase + bonus));
}

// Domain → company label: take second-level token, title-case.
function domainToLabel(domain) {
    if (!domain) return null;
    const d = String(domain).toLowerCase();
    if (isGenericProvider(d)) return null;
    const clean = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const parts = clean.split(".").filter(Boolean);
    if (parts.length < 2) return null;
    const label = parts[parts.length - 2];
    if (!label || label.length < 3) return null;
    if (isGenericProvider(label)) return null;
    return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public facade
// ─────────────────────────────────────────────────────────────────────────────
export function extractCompany(input = {}) {
    const {
        formFields = null,
        signature = "",
        body = "",
        senderDisplay = "",
        emailDomain = "",
        personHint = null,
    } = input;

    const rawCandidates = [];
    const rejected = [];

    const tryCandidate = (rawValue, source, opts = {}) => {
        if (!rawValue) return null;
        const raw = String(rawValue).trim();
        if (!raw) return null;

        // Attempt composite split first: extract company from "Person - ООО X" etc.
        const composite = splitCompositeForCompany(raw);
        let value = raw;
        let extractedPerson = null;
        if (composite.company) {
            value = composite.company;
            extractedPerson = composite.person;
        }

        const cleaned = cleanRawCandidate(value);
        if (!cleaned) {
            rejected.push({ value: raw, source, reason: "empty_after_clean" });
            return null;
        }

        rawCandidates.push({ value: cleaned, source });

        // Cross-field: if cleaned == personHint → reject.
        if (personHint && cleaned.toLowerCase() === String(personHint).toLowerCase()) {
            rejected.push({ value: cleaned, source, reason: "matches_person_hint" });
            return null;
        }

        if (isBadCompany(cleaned)) {
            rejected.push({ value: cleaned, source, reason: classifyReject(cleaned) });
            return null;
        }
        // Domain-only label for non-domain source → reject (it's a naked brand fragment).
        if (source !== "email_domain" && isDomainLabelOnly(cleaned)) {
            rejected.push({ value: cleaned, source, reason: "domain_label_only" });
            return null;
        }
        return {
            value: cleaned,
            source,
            personHint: extractedPerson,
            confidence: scoreCandidate({ value: cleaned, source }),
        };
    };

    const accepted = [];

    // 1. Form fields
    if (formFields && typeof formFields === "object") {
        const companyKeys = ["Компания", "Организация", "Company", "Наименование организации", "company"];
        for (const k of companyKeys) {
            if (formFields[k]) {
                const r = tryCandidate(formFields[k], "form");
                if (r) accepted.push(r);
            }
        }
    }

    // 2. Signature: legal entities + labeled.
    if (signature) {
        const legals = findLegalEntities(signature);
        for (const entity of legals) {
            const r = tryCandidate(entity, "signature");
            if (r) accepted.push(r);
        }
        const labeled = findLabeledCompany(signature);
        for (const lbl of labeled) {
            const r = tryCandidate(lbl, "signature");
            if (r) accepted.push(r);
        }
    }

    // 3. Body: legal entities + labeled.
    if (body) {
        const bodyText = String(body).slice(0, 12000);
        const legals = findLegalEntities(bodyText);
        for (const entity of legals) {
            const r = tryCandidate(entity, "body");
            if (r) accepted.push(r);
        }
        const labeled = findLabeledCompany(bodyText);
        for (const lbl of labeled) {
            const r = tryCandidate(lbl, "body");
            if (r) accepted.push(r);
        }
    }

    // 4. Sender display (composite-aware).
    if (senderDisplay) {
        const r = tryCandidate(senderDisplay, "sender");
        if (r) accepted.push(r);
    }

    // 5. Email domain (weak fallback).
    if (emailDomain) {
        if (isGenericProvider(emailDomain)) {
            rejected.push({ value: emailDomain, source: "email_domain", reason: "generic_provider" });
        } else {
            const label = domainToLabel(emailDomain);
            if (label && !isBadCompany(label)) {
                const r = tryCandidate(label, "email_domain");
                if (r) accepted.push(r);
            }
        }
    }

    if (accepted.length === 0) {
        return {
            primary: null,
            alt: null,
            source: null,
            personHint: null,
            confidence: 0,
            rawCandidates,
            rejected,
            needsReview: true,
        };
    }

    // Pick the highest-scoring.
    accepted.sort((a, b) => b.confidence - a.confidence);
    const best = accepted[0];
    return {
        primary: best.value,
        alt: accepted.length > 1 ? accepted[1].value : null,
        source: best.source,
        personHint: best.personHint || null,
        confidence: best.confidence,
        rawCandidates,
        rejected,
        needsReview: best.confidence < 0.6,
    };
}

function classifyReject(value) {
    if (isGenericProvider(value)) return "generic_provider";
    if (isPersonLikeCompany(value)) return "person_like";
    if (isDepartmentCompany(value)) return "department";
    if (isRoleCompany(value)) return "role";
    if (isOvercaptureBlob(value)) return "overcapture";
    if (/@/.test(value)) return "email";
    return "bad_company";
}
