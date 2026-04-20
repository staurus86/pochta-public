// position-extractor.js — facade for Должность extraction.
// Priority: form_fields > signature > body > sender_display.
// Returns { primary, alt, department, source, confidence, needsReview,
//           rawCandidates[], rejected[] }.

import {
    isBadPosition,
    isCompanyInRole,
    isPersonInRole,
    isDepartmentOnly,
    isContactGarbage,
    isFullSignatureBlob,
    hasRoleWord,
    hasRoleNoun,
    hasDepartmentStem,
} from "./position-filters.js";
import {
    normalizePosition,
    splitBilingualRole,
    separateDepartmentFromRole,
    stripPersonTail,
    stripCompanyTail,
    stripContactTail,
} from "./position-normalizer.js";

const LABEL_RE = /(?:должность|position|title|job\s*title|должн\.|role)\s*[:\-–—]\s*([^\n]{2,160})/i;

const POSITION_SIGNATURE_PATTERN = /(?:^|\n)\s*((?:начальник|заместитель(?:\s+начальника?)?|главный\s+(?:инженер|технолог|бухгалтер|специалист|механик|энергетик)|зав\.\s*(?:отделом|кафедрой|лабораторией|складом)|заведующ(?:ий|ая)\s+\S+|руководитель(?:\s+(?:отдела|направления|группы|проекта|службы))?|ведущий\s+(?:инженер|специалист|менеджер)|генеральный\s+директор|коммерческий\s+директор|технический\s+директор|финансовый\s+директор|исполнительный\s+директор|директор(?:\s+по\s+\S+)?|менеджер(?:\s+по\s+\S+)?|инженер(?:\s+по\s+\S+)?|специалист(?:\s+по\s+\S+)?|закупщик|снабженец|логист|бухгалтер|юрист|экономист|маркетолог|оператор|консультант|технолог|координатор|аналитик|эксперт|помощник|ассистент|secretary|administrator|coordinator)[^\n]{0,100})/im;

const GREETING_RE = /^(?:с\s+уважением|best\s+regards|kind\s+regards|regards|благодарю|спасибо|sincerely|thanks|thank\s+you)[,.\s]*/i;

const ROLE_LINE_RE = /^(?:[А-ЯЁA-Z][^\n]{2,100})$/;

function safeString(v) {
    if (v == null) return "";
    return String(v).trim();
}

function scoreCandidate(candidate) {
    if (!candidate || !candidate.value) return 0;
    const { value, source } = candidate;
    const sourceBase = {
        form: 0.95,
        signature: 0.9,
        body: 0.8,
        sender: 0.6,
    }[source] || 0.5;
    let bonus = 0;
    if (hasRoleWord(value)) bonus += 0.05;
    if (hasDepartmentStem(value) && hasRoleWord(value)) bonus += 0.03;
    if (value.length >= 4 && value.length <= 60) bonus += 0.02;
    if (value.length > 80) bonus -= 0.1;
    if (isCompanyInRole(value)) bonus -= 0.3;
    if (isPersonInRole(value) && !hasRoleWord(value)) bonus -= 0.3;
    return Math.max(0, Math.min(1, sourceBase + bonus));
}

function cleanCandidate(raw) {
    if (raw == null) return "";
    let s = String(raw).trim();
    if (!s) return "";
    // Cut at newline — candidates are single lines.
    s = s.split(/\n/)[0].trim();
    // Strip leading greeting residue ("с уважением, юрист" → "юрист").
    s = s.replace(GREETING_RE, "").trim();
    // Normalize trailing punctuation.
    s = s.replace(/[,;.]\s*$/, "").trim();
    return s;
}

function generateCandidatesFromText(text) {
    const out = [];
    if (!text) return out;

    // 1. Label match "Должность: X" / "Position: X"
    const labelMatch = LABEL_RE.exec(text);
    if (labelMatch) {
        out.push({ value: labelMatch[1].trim(), kind: "label" });
    }

    // 2. Signature-pattern role line.
    const sigMatch = POSITION_SIGNATURE_PATTERN.exec(text);
    if (sigMatch) {
        out.push({ value: sigMatch[1].trim(), kind: "signature_pattern" });
    }

    // 3. Greeting-adjacent line (same line after greeting, or next 1-2 lines).
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
        if (!GREETING_RE.test(lines[i])) continue;
        // Same line after greeting.
        const sameLineRest = lines[i].replace(GREETING_RE, "").trim();
        if (sameLineRest && sameLineRest.length >= 2 && sameLineRest.length <= 100
            && !/@/.test(sameLineRest) && hasRoleWord(sameLineRest)) {
            out.push({ value: sameLineRest, kind: "greeting_same" });
        }
        // Next 1-2 lines.
        for (const cand of [lines[i + 1], lines[i + 2]].filter(Boolean)) {
            if (cand.length < 2 || cand.length > 120) continue;
            if (/@/.test(cand) || /^\+?[\d\s()\-]{6,}$/.test(cand)) continue;
            if (!ROLE_LINE_RE.test(cand)) continue;
            // looks like a name (2-3 Title-case words w/o role word) → skip.
            const looksPureName = /^[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?$/.test(cand);
            if (looksPureName && !hasRoleWord(cand)) continue;
            if (hasRoleWord(cand) || /^[A-Z][a-z]/.test(cand)) {
                out.push({ value: cand, kind: "greeting_next" });
            }
        }
    }

    // 4. Stand-alone role line: must (a) start with a role word / Title-case role,
    //    OR (b) contain a role NOUN (engineer / manager / etc. — not just an adjective
    //    like "project"). This prevents narrative sentences ("Please quote for our
    //    project") from being captured via the adjective "project".
    for (const line of lines) {
        if (line.length < 3 || line.length > 120) continue;
        if (!hasRoleWord(line)) continue;
        if (/@/.test(line)) continue;
        if (isContactGarbage(line)) continue;
        if (isDepartmentOnly(line)) continue;
        const firstToken = line.split(/\s+/)[0] || "";
        const firstLower = firstToken.toLowerCase().replace(/[.,;:!?()"'«»]/g, "");
        const startsWithRole = hasRoleWord(firstToken);
        const isLikelySentence = /[.?!]\s/.test(line) || /^[a-zа-ё]/.test(firstToken);
        if (isLikelySentence && !startsWithRole) continue;
        if (!startsWithRole && !hasRoleNoun(line)) continue;
        out.push({ value: line, kind: "role_line" });
    }

    return out;
}

// Main facade.
export function extractPosition(input = {}) {
    const {
        formFields = null,
        signature = "",
        body = "",
        senderDisplay = "",
        personHint = null,
        companyHint = null,
    } = input;

    const rawCandidates = [];
    const rejected = [];
    const accepted = [];
    let department = null;

    const tryCandidate = (rawValue, source, meta = {}) => {
        if (!rawValue) return null;
        let raw = cleanCandidate(rawValue);
        if (!raw) return null;

        rawCandidates.push({ value: raw, source });

        // Bilingual split — primary ru, alt en.
        const bilingual = splitBilingualRole(raw);
        let value = bilingual.ru || raw;
        const alt = bilingual.en || null;

        // Pure contact garbage (whole input is a phone / email / url / address) → reject.
        // Inline phone/email tails are stripped in normalizePosition; this catches
        // inputs like "+7 (495) 123-45-67" where there is nothing else to salvage.
        if (isContactGarbage(value)) {
            rejected.push({ value, source, reason: "contact_garbage" });
            return null;
        }

        // Normalize: strip contact/company/person tails.
        const cleaned = normalizePosition(value);
        if (!cleaned) {
            rejected.push({ value: raw, source, reason: "empty_after_clean" });
            return null;
        }

        // After normalization, reject if residual still looks like a signature blob
        // (would happen if normalize couldn't simplify the input — e.g. multi-line).
        if (isFullSignatureBlob(cleaned)) {
            rejected.push({ value: cleaned, source, reason: "signature_blob" });
            return null;
        }

        // Department-only → emit as department, not position.
        if (isDepartmentOnly(cleaned)) {
            if (!department) department = cleaned;
            rejected.push({ value: cleaned, source, reason: "department_only" });
            return null;
        }

        // Cross-field: personHint / companyHint exact match → reject.
        if (personHint && cleaned.toLowerCase() === String(personHint).toLowerCase()) {
            rejected.push({ value: cleaned, source, reason: "matches_person_hint" });
            return null;
        }
        if (companyHint && cleaned.toLowerCase() === String(companyHint).toLowerCase()) {
            rejected.push({ value: cleaned, source, reason: "matches_company_hint" });
            return null;
        }

        // After normalization, ensure we have a role word (unless the source is form —
        // user-supplied form fields are trusted even without role keyword).
        if (source !== "form" && !hasRoleWord(cleaned)) {
            rejected.push({ value: cleaned, source, reason: "no_role_word" });
            return null;
        }

        if (isBadPosition(cleaned)) {
            rejected.push({ value: cleaned, source, reason: classifyReject(cleaned) });
            return null;
        }

        // Separate department from role for final primary output.
        const sep = separateDepartmentFromRole(cleaned);
        if (sep.department && !department) department = sep.department;

        return {
            value: cleaned,
            source,
            alt,
            confidence: scoreCandidate({ value: cleaned, source }),
            kind: meta.kind || "generic",
        };
    };

    // 1. Form fields.
    if (formFields && typeof formFields === "object") {
        const keys = ["Должность", "Position", "Title", "Job Title", "Role", "position"];
        for (const k of keys) {
            if (formFields[k]) {
                const r = tryCandidate(formFields[k], "form", { kind: "form" });
                if (r) accepted.push(r);
            }
        }
    }

    // 2. Signature.
    if (signature) {
        const cands = generateCandidatesFromText(signature);
        for (const c of cands) {
            const r = tryCandidate(c.value, "signature", { kind: c.kind });
            if (r) accepted.push(r);
        }
    }

    // 3. Body.
    if (body) {
        const cands = generateCandidatesFromText(String(body).slice(0, 12000));
        for (const c of cands) {
            const r = tryCandidate(c.value, "body", { kind: c.kind });
            if (r) accepted.push(r);
        }
    }

    // 4. Sender display (composite-aware).
    if (senderDisplay) {
        const r = tryCandidate(senderDisplay, "sender", { kind: "sender" });
        if (r) accepted.push(r);
    }

    if (accepted.length === 0) {
        return {
            primary: null,
            alt: null,
            department,
            source: null,
            confidence: 0,
            rawCandidates,
            rejected,
            needsReview: true,
        };
    }

    accepted.sort((a, b) => b.confidence - a.confidence);
    const best = accepted[0];
    const alt = best.alt || (accepted.length > 1 ? accepted[1].value : null);
    return {
        primary: best.value,
        alt,
        department,
        source: best.source,
        confidence: best.confidence,
        rawCandidates,
        rejected,
        needsReview: best.confidence < 0.6,
    };
}

function classifyReject(value) {
    if (isContactGarbage(value)) return "contact_garbage";
    if (isCompanyInRole(value) && !hasRoleWord(value)) return "company_only";
    if (isPersonInRole(value) && !hasRoleWord(value)) return "person_only";
    if (isDepartmentOnly(value)) return "department_only";
    return "bad_position";
}
