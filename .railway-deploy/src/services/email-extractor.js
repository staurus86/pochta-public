// email-extractor.js — Phase 9 facade.
// Normalizes "От"/fromEmail into a structured email entity with:
//   primary, displayName, localPart, domain,
//   type (person/role/system/noreply), domainType (public/corporate/platform),
//   source, confidence, needsReview, deduplicated,
//   canDefinePerson, canDefineCompany,
//   rawCandidates[], rejected[]

import {
    classifyLocalPart,
    classifyDomain,
    canUseAsTruthSource,
} from "./email-filters.js";

import {
    parseSenderHeader,
    normalizeEmail,
    splitLocalDomain,
    extractEmailsFromText,
} from "./email-normalizer.js";

// Source → base confidence.
const SOURCE_CONFIDENCE = {
    sender_header: 0.9,
    body: 0.5,
    signature: 0.6,
};

function scoreConfidence({ type, domainType, source }) {
    let conf = SOURCE_CONFIDENCE[source] ?? 0.5;

    // Domain adjustments first.
    if (domainType === "public_provider") {
        conf -= 0.05;
    } else if (domainType === "unknown") {
        conf -= 0.15;
    }

    // Type caps last — system/noreply/role must not be restored by domain boost.
    if (type === "system_email" || type === "noreply_email") {
        conf = Math.min(conf, 0.35);
    } else if (type === "role_mailbox") {
        conf = Math.min(conf, 0.7);
    }

    if (conf < 0) conf = 0;
    if (conf > 1) conf = 1;
    return Math.round(conf * 100) / 100;
}

function emptyResult() {
    return {
        primary: null,
        displayName: "",
        localPart: "",
        domain: "",
        type: "unknown",
        domainType: "unknown",
        source: null,
        confidence: 0,
        needsReview: true,
        deduplicated: false,
        canDefinePerson: false,
        canDefineCompany: false,
        rawCandidates: [],
        rejected: [],
    };
}

// Main facade.
// Input: { rawFrom, fromEmail, fromName, body, signature }
// Any of the inputs may be missing; we use the highest-priority signal.
export function extractEmail(input = {}) {
    const rawFrom = String(input.rawFrom ?? input.fromEmail ?? "").trim();
    const body = String(input.body ?? "");
    const signature = String(input.signature ?? "");

    const rawCandidates = [];
    const rejected = [];

    // Primary cascade: sender_header → body → signature.
    let picked = null;

    // 1) Sender header.
    if (rawFrom) {
        rawCandidates.push({ raw: rawFrom, source: "sender_header" });
        const parsed = parseSenderHeader(rawFrom);
        if (parsed.email) {
            // If deduplicated, don't restore displayName from fromName
            // (fromName may contain the same email repeated).
            let display = parsed.displayName;
            if (!display && !parsed.deduplicated) {
                const fromNameClean = String(input.fromName ?? "").trim();
                // Only use fromName if it doesn't carry the same email.
                if (fromNameClean && fromNameClean.toLowerCase() !== parsed.email
                    && !fromNameClean.toLowerCase().includes(parsed.email)) {
                    display = fromNameClean;
                }
            }
            picked = {
                email: parsed.email,
                displayName: display,
                deduplicated: parsed.deduplicated,
                source: "sender_header",
            };
        } else {
            // Try bare fromEmail separately if header unparseable.
            const fallbackNorm = normalizeEmail(input.fromEmail);
            if (fallbackNorm) {
                picked = {
                    email: fallbackNorm,
                    displayName: String(input.fromName ?? "").trim(),
                    deduplicated: false,
                    source: "sender_header",
                };
            } else {
                rejected.push({ raw: rawFrom, reason: "invalid_header_format" });
            }
        }
    }

    // 2) Body fallback.
    if (!picked && body) {
        const emails = extractEmailsFromText(body);
        if (emails.length > 0) {
            rawCandidates.push({ raw: emails[0], source: "body" });
            picked = {
                email: emails[0],
                displayName: "",
                deduplicated: false,
                source: "body",
            };
        }
    }

    // 3) Signature fallback.
    if (!picked && signature) {
        const emails = extractEmailsFromText(signature);
        if (emails.length > 0) {
            rawCandidates.push({ raw: emails[0], source: "signature" });
            picked = {
                email: emails[0],
                displayName: "",
                deduplicated: false,
                source: "signature",
            };
        }
    }

    if (!picked) {
        const out = emptyResult();
        out.rawCandidates = rawCandidates;
        out.rejected = rejected;
        return out;
    }

    // Classify picked candidate.
    const { local, domain } = splitLocalDomain(picked.email);
    const type = classifyLocalPart(local);
    const domainType = classifyDomain(domain);

    const canDefinePerson = canUseAsTruthSource({ type, domainType }, "person");
    const canDefineCompany = canUseAsTruthSource({ type, domainType }, "company");

    const confidence = scoreConfidence({ type, domainType, source: picked.source });
    const needsReview =
        confidence < 0.6
        || type === "system_email"
        || type === "noreply_email";

    return {
        primary: picked.email,
        displayName: picked.displayName,
        localPart: local,
        domain,
        type,
        domainType,
        source: picked.source,
        confidence,
        needsReview,
        deduplicated: picked.deduplicated,
        canDefinePerson,
        canDefineCompany,
        rawCandidates,
        rejected,
    };
}
