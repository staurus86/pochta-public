// article-extractor.js — facade tying together zoning, filters, normalizer.
// Produces: { articles, rawCandidates, rejectedCandidates, strictMode, confidence }.
//
// Flow:
//   1. splitZones(email) → subject / current / attachment / signature / quoted
//   2. preprocessForExtraction(zoneText) — collapse WR- 2510 → WR-2510, translit cyr lookalikes
//   3. generateCandidates(zone, text):
//        - LABEL_RES (numeric + alnum-with-label) → tokenize internally
//        - SKU_LIKE_RE / SKU_MULTIBLOCK_RE / SKU_DOTTED_RE / SKU_DIGIT_START_RE
//        - BROAD_TOKEN_RE (for noise detection — only digit/colon tokens)
//   4. scoreCandidate(candidate) — zone priority + label proximity + repetition
//   5. rejectArticleCandidate(token, ctx)
//   6. normalizeArticleCode + stripDescriptorTail + stripBrandPrefix
//   7. dedupeCaseInsensitive
//   8. Safety guard: strict mode when >12 candidates & >30% noise

import { splitZones, ZONES, ZONE_PRIORITY } from "./email-zoning.js";
import { rejectArticleCandidate } from "./article-filters.js";
import {
    normalizeArticleCode,
    stripDescriptorTail,
    stripBrandPrefix,
    dedupeCaseInsensitive,
    preprocessForExtraction,
    trimTechSpecTail,
} from "./article-normalizer.js";

// --- patterns -------------------------------------------------------

// Numeric labels: "Артикул: 152618", "Артикул 34095 34098", "Арт 3610.5533"
// NOTE: use артикул... first, then арт with lookahead to prevent partial "Арт" match in "Артикул"
const LABEL_NUMERIC_RE =
    /(?:^|[\s(\[])(?:артикул(?:[ау]|ом|е|ы|ов|ам|ами|ах)?|арт(?=[\s.:#№]|$))\.?\s*[:#№]?\s*(\d{3,6}(?:\.\d{1,6})?)(?:[ \t]+(\d{3,6}(?:\.\d{1,6})?))?(?:[ \t]+(\d{3,6}(?:\.\d{1,6})?))?/gi;

// Alnum labels: "Part number: DNC-80-PPV-A", "Модель: PEV-W-KL-LED-GH", "Арт R 480316021"
// NOTE: continuation uses [ \t]+ (no newline) to avoid swallowing next line.
// NOTE: артикул... first, then арт with lookahead, to avoid "Арт"+"икул" backtrack bug.
const LABEL_ALNUM_RE =
    /(?:^|[\s(\[])(?:part\s*number|manufacturer\s*part\s*number|mpn|p\/n|pn|артикул(?:[ау]|ом|е|ы|ов|ам|ами|ах)?|арт(?=[\s.:#№]|$)|каталож(?:ный|ного)\s+номер|код\s+товара|модель|model)\.?\s*[:#№]?\s*([A-Za-zА-ЯЁ][A-Za-zА-ЯЁ0-9.\-/]{0,40}(?:[ \t]+[A-Za-z0-9][A-Za-z0-9./\-]{1,15}){0,5})/gi;

// SKU without label: alnum with separator (letter-lead)
const SKU_LIKE_RE = /(?:^|[\s(\[«"'>,;])([A-Z][A-Z0-9]{1,12}(?:[-/.][A-Z0-9]{1,12}){1,6}(?:\+[A-Z0-9]{1,6})?)(?=[\s.,;)\]»"'<—]|$)/gi;

// Multi-block: letter(s) + space + digits (+ optional dash/slash chain + optional alnum continuations)
const SKU_MULTIBLOCK_RE = /(?:^|[\s(\[«"'>,;])([A-Z]{1,3}\s+\d{2,10}(?:[-/]\d{1,10})*(?:\s+[A-Z0-9]{1,10}){0,6})(?=[\s.,;)\]»"'<—]|$)/g;

// Dotted: "3610.5533", "88.1.82.9.02", "413415.003-02"
const SKU_DOTTED_RE = /(?:^|[\s(\[«"'>,;])(\d{2,6}(?:\.\d{1,6}){1,5}(?:[-/]\d{1,6})?)(?=[\s.,;)\]»"'<—]|$)/g;

// Digit-start with separators: "8579/12-506"
const SKU_DIGIT_START_RE = /(?:^|[\s(\[«"'>,;:])(\d{2,6}(?:[/-]\d{1,6}){1,4}[A-Z0-9]{0,6})(?=[\s.,;)\]»"'<—]|$)/g;

// Broad: any alnum token with digit or colon (feeds filter pipeline for noise detection)
const BROAD_TOKEN_RE = /(?:^|[\s(\[«"'>,;])([A-Za-zА-ЯЁ0-9][A-Za-zА-ЯЁ0-9.:_\-/+]{3,50})(?=[\s,;)\]»"'<—]|$)/g;

// --- helpers --------------------------------------------------------

function* iterateMatches(text, regex) {
    if (!text) return;
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
        yield m;
    }
}

function extractLine(text, index) {
    const before = text.lastIndexOf("\n", index - 1);
    const after = text.indexOf("\n", index);
    const start = before === -1 ? 0 : before + 1;
    const end = after === -1 ? text.length : after;
    return text.slice(start, end);
}

// Extract individual SKUs from a label-capture segment (e.g. "R. STAHL 8579/12-506 63A 5P IP66 Ex e")
function extractInnerSKUs(segment, knownBrands = []) {
    if (!segment) return [];
    let s = segment;
    // Strip known brand prefix if present
    for (const brand of knownBrands) {
        const re = new RegExp(`^${String(brand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:.]?\\s*`, "i");
        if (re.test(s)) {
            s = s.replace(re, "").trim();
            break;
        }
    }

    const found = new Set();
    const results = [];
    const patterns = [SKU_LIKE_RE, SKU_MULTIBLOCK_RE, SKU_DIGIT_START_RE, SKU_DOTTED_RE];
    for (const re of patterns) {
        for (const m of iterateMatches(s, re)) {
            const val = m[1].trim().replace(/\s+/g, " ");
            const key = val.toUpperCase();
            if (!found.has(key)) {
                found.add(key);
                results.push(val);
            }
        }
    }
    return results;
}

// --- candidate generation ------------------------------------------

function generateCandidates(zoneName, zoneText, knownBrands = []) {
    const out = [];
    if (!zoneText) return out;

    const pushed = new Set();
    const push = (cand) => {
        const key = `${cand.zone}:${cand.value.toUpperCase()}`;
        if (pushed.has(key)) return;
        pushed.add(key);
        out.push(cand);
    };

    // 1. Numeric labels (digit-only SKUs)
    for (const m of iterateMatches(zoneText, LABEL_NUMERIC_RE)) {
        const line = extractLine(zoneText, m.index);
        for (let i = 1; i < m.length; i++) {
            const value = m[i];
            if (!value) continue;
            push({
                value: value.trim(),
                zone: zoneName,
                hasLabel: true,
                sourceLine: line,
            });
        }
    }

    // 2. Alnum labels: trim tech-spec tail, then tokenize inner segment
    for (const m of iterateMatches(zoneText, LABEL_ALNUM_RE)) {
        const line = extractLine(zoneText, m.index);
        const rawCaptured = m[1];
        if (!rawCaptured) continue;
        const captured = trimTechSpecTail(rawCaptured);
        const inner = extractInnerSKUs(captured, knownBrands);
        if (inner.length > 0) {
            for (const sku of inner) {
                push({
                    value: sku,
                    zone: zoneName,
                    hasLabel: true,
                    sourceLine: line,
                });
            }
        } else {
            // Fallback — keep full capture (trimmed) as candidate
            push({
                value: captured.trim().replace(/\s+/g, " "),
                zone: zoneName,
                hasLabel: true,
                sourceLine: line,
            });
        }
    }

    // 3. Standalone SKU-like patterns (no label)
    const standalonePatterns = [
        { re: SKU_LIKE_RE, kind: "sku" },
        { re: SKU_MULTIBLOCK_RE, kind: "multiblock" },
        { re: SKU_DOTTED_RE, kind: "dotted" },
        { re: SKU_DIGIT_START_RE, kind: "digit-start" },
    ];
    for (const { re, kind } of standalonePatterns) {
        for (const m of iterateMatches(zoneText, re)) {
            const line = extractLine(zoneText, m.index);
            let value = m[1].trim().replace(/\s+/g, " ");
            // Trim tech-spec tail only for multiblock captures (can greedily swallow "10 Bar")
            if (kind === "multiblock") value = trimTechSpecTail(value);
            push({
                value,
                zone: zoneName,
                hasLabel: false,
                sourceLine: line,
            });
        }
    }

    // 4. BROAD tokens (for noise detection — must contain digit or colon)
    for (const m of iterateMatches(zoneText, BROAD_TOKEN_RE)) {
        const tok = m[1];
        if (!/\d/.test(tok) && !/:/.test(tok)) continue;
        const line = extractLine(zoneText, m.index);
        push({
            value: tok.trim(),
            zone: zoneName,
            hasLabel: false,
            sourceLine: line,
            broad: true,
        });
    }

    return out;
}

// Count section numbering siblings in a zone (for isSectionNumbering context)
function countSectionNumbers(zoneText) {
    if (!zoneText) return 0;
    const matches = zoneText.match(/^\s*\d{1,2}(?:\.\d{1,3}){2,4}\s/gm);
    return matches ? matches.length : 0;
}

// --- scoring --------------------------------------------------------

function scoreCandidate(candidate) {
    let score = ZONE_PRIORITY[candidate.zone] || 1;
    if (candidate.hasLabel) score += 3;

    const line = candidate.sourceLine || "";
    if (/\b(?:part\s*number|mpn|p\/n|pn|арт|артикул)\b/i.test(line)) score += 2;
    if (/\b(?:поз\.?|позиция|наименование|qty|кол-?во|шт)\b/i.test(line)) score += 1;

    // Strong formal SKU (letter-number-dashes) bonus
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,}$/i.test(candidate.value)) score += 1;

    // Demote signature/quoted zones
    if (candidate.zone === ZONES.SIGNATURE || candidate.zone === ZONES.QUOTED) score -= 2;

    // Demote broad-only candidates (no structural pattern matched)
    if (candidate.broad) score -= 1;

    return score;
}

// --- main facade ----------------------------------------------------

/**
 * Extract articles from an email.
 * @param {object} email { subject, body, attachmentText }
 * @param {object} options { knownBrands, minScore }
 * @returns {{articles: string[], rawCandidates: object[], rejectedCandidates: object[], strictMode: boolean, confidence: number}}
 */
export function extractArticles(email = {}, options = {}) {
    const knownBrands = Array.isArray(options.knownBrands) ? options.knownBrands : [];
    const minScore = typeof options.minScore === "number" ? options.minScore : 3;

    // 1. Split into zones
    const zones = splitZones(email);

    // 2. Preprocess each zone (WR- 2510 → WR-2510, cyrillic translit)
    const preprocessedZones = {
        [ZONES.SUBJECT]: preprocessForExtraction(zones.subject),
        [ZONES.CURRENT]: preprocessForExtraction(zones.currentMessage),
        [ZONES.ATTACHMENT]: preprocessForExtraction(zones.attachmentText),
        [ZONES.SIGNATURE]: preprocessForExtraction(zones.signature),
        [ZONES.QUOTED]: preprocessForExtraction(zones.quotedThread),
    };

    // 3. Generate candidates per zone
    const rawCandidates = [];
    for (const zoneName of [ZONES.SUBJECT, ZONES.CURRENT, ZONES.ATTACHMENT, ZONES.SIGNATURE, ZONES.QUOTED]) {
        rawCandidates.push(...generateCandidates(zoneName, preprocessedZones[zoneName], knownBrands));
    }

    // 4. Section-numbering context
    const totalSections = countSectionNumbers(
        [preprocessedZones[ZONES.CURRENT], preprocessedZones[ZONES.ATTACHMENT], preprocessedZones[ZONES.QUOTED]].join("\n")
    );

    // 5. Score + filter
    const rejectedCandidates = [];
    const accepted = [];

    for (const cand of rawCandidates) {
        // Strip brand prefix before filter (FESTO:DNC-80-PPV-A → DNC-80-PPV-A)
        const stripped = stripBrandPrefix(cand.value, knownBrands);
        // Normalize
        const normalized = normalizeArticleCode(stripped);
        if (!normalized) {
            rejectedCandidates.push({ value: cand.value, zone: cand.zone, reason: "empty_after_normalize" });
            continue;
        }

        const verdict = rejectArticleCandidate(normalized, {
            hasLabel: cand.hasLabel,
            sourceLine: cand.sourceLine,
            sectionCount: totalSections,
        });
        if (verdict.rejected) {
            rejectedCandidates.push({ value: normalized, zone: cand.zone, reason: verdict.reason });
            continue;
        }

        // Strip descriptor tail (if any leaked into multi-block capture)
        const cleaned = stripDescriptorTail(normalized, cand.sourceLine || "");

        const score = scoreCandidate({ ...cand, value: cleaned });
        accepted.push({ ...cand, value: cleaned, score, normalized: cleaned });
    }

    // 6. Repetition bonus
    const occurrences = new Map();
    for (const a of accepted) {
        const key = a.value.toUpperCase();
        occurrences.set(key, (occurrences.get(key) || 0) + 1);
    }
    for (const a of accepted) {
        const n = occurrences.get(a.value.toUpperCase()) || 0;
        if (n >= 2) a.score += 1;
    }

    // 7. Safety guard: too many candidates + too many rejects → strict mode
    const totalCandidates = rawCandidates.length;
    const rejectRatio = totalCandidates === 0 ? 0 : rejectedCandidates.length / totalCandidates;
    const strictMode = totalCandidates > 12 && rejectRatio > 0.3;
    const effectiveMinScore = strictMode ? Math.max(minScore + 2, 5) : minScore;

    // 8. Score threshold
    const passing = accepted.filter((a) => a.score >= effectiveMinScore);

    // 9. Sort by zone priority then score
    passing.sort((a, b) => {
        const zp = (ZONE_PRIORITY[b.zone] || 0) - (ZONE_PRIORITY[a.zone] || 0);
        return zp !== 0 ? zp : b.score - a.score;
    });

    // 10. Dedup (case-insensitive)
    const articles = dedupeCaseInsensitive(passing.map((a) => a.value));

    return {
        articles,
        rawCandidates: rawCandidates.map((c) => ({ value: c.value, zone: c.zone, hasLabel: c.hasLabel })),
        rejectedCandidates,
        strictMode,
        confidence: strictMode ? 0.6 : 1.0,
    };
}
