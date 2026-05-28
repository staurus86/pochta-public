// quantity-extractor.js — facade for quantity extraction.
// Combines filters + normalizer + zone/article context to produce
// { primary, items, rejected, needsReview }.

import {
    isTechnicalSpec,
    isPhoneLike,
    isDateLike,
    isHoursLike,
} from "./quantity-filters.js";
import {
    parseQuantityForm,
    parseInKolve,
    parsePackStructure,
    parseLocaleNumeric,
    normalizeQtyUnit,
} from "./quantity-normalizer.js";

const COUNT_UNITS = new Set(["шт", "компл", "пар", "уп", "бух", "рул", "ед"]);

// Generic number + unit finder inside a line (not anchored).
// NB: JS \b не работает с кириллицей, поэтому завершающий unit boundary — через lookahead.
const INLINE_QTY_RE = /(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|штука|pcs|pc|ea|each|units?|компл(?:ект(?:а|ы|ов)?)?|к-т|пар[аы]?|уп|упак|упаковк[аиу]|упаковок|бух|бухт[аы]?|рул|рулон[аов]?|ед|единиц[аы]?)(?![A-Za-zА-Яа-яЁё0-9])/gi;

// Labeled prefix: "в кол-ве 5", "Количество: 10", "qty 7", "потребность: 3", "объём: 10 шт"
const INLINE_IN_KOLVE_RE = /(?:в\s+)?(?:кол(?:ичеств[оаеу]|-?в[оеау]|\.)?|quantity|qty|потребност[ьи]|объём?|нужно|needed?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|штука|pcs|pc|компл(?:ект(?:а|ы|ов)?)?|к-т|пар[аы]?|уп|упак|рул|бух|ед|единиц[аы]?)?(?![A-Za-zА-Яа-яЁё])/gi;

const PACK_INLINE_RE = /(\d+)\s*(компл(?:ект(?:а|ы|ов)?)?|к-т|уп|упак|упаковк[аиу])\s+по\s+(\d+)\s*(шт|штук[аи]?|pcs|pc|ea|единиц[аы]?)?(?![A-Za-zА-Яа-яЁё])/gi;

// Article-boundary: when a number-hyphen-digit appears, and the prefix looks
// like an article, we split: "9226513-4 шт" → article=9226513, qty=4
// "11TC080-1шт" → article=11TC080, qty=1
function splitArticleBoundary(segment, articles = []) {
    if (!Array.isArray(articles) || articles.length === 0) return null;
    for (const art of articles) {
        if (!art) continue;
        const escaped = String(art).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        // article + [-–—] + number + space? + unit
        const re = new RegExp(
            `${escaped}\\s*[-–—]\\s*(\\d+(?:[.,]\\d+)?)\\s*(шт|штук[аи]?|pcs|pc|компл|к-т|пар[аы]?|уп|рул|бух|ед)`,
            "i"
        );
        const match = segment.match(re);
        if (match) {
            return {
                value: parseFloat(String(match[1]).replace(",", ".")),
                unit: normalizeQtyUnit(match[2]) || "шт",
            };
        }
    }
    return null;
}

function isCountUnit(unit) {
    return COUNT_UNITS.has(normalizeQtyUnit(unit));
}

// Reject candidates where the surrounding context marks them as technical.
// Example: "90 мм" is rejected even though "90" could be a value, because
// its unit is spatial, not count.
function candidateIsRejected(segment) {
    const s = String(segment || "").trim();
    if (!s) return { rejected: true, reason: "empty" };
    if (isPhoneLike(s)) return { rejected: true, reason: "phone" };
    if (isDateLike(s)) return { rejected: true, reason: "date" };
    if (isHoursLike(s)) return { rejected: true, reason: "hours" };
    if (isTechnicalSpec(s)) return { rejected: true, reason: "technical_spec" };
    return { rejected: false };
}

function extractFromLine(line, options) {
    const articles = options.articles || [];
    const accepted = [];
    const rejected = [];
    let workLine = line;

    // 0. Article-boundary priority
    const boundary = splitArticleBoundary(line, articles);
    if (boundary) {
        accepted.push({ ...boundary, source: "article_boundary", sourceLine: line });
    }

    // 1. Locale-aware "1,000 шт" (en-locale thousand) — DETECT FIRST and mask
    //    from workLine so INLINE_QTY_RE doesn't re-capture "1,000" as "1".
    const localeMatch = workLine.match(/(\d{1,3}(?:,\d{3})+)\s*(шт|штук[аи]?|pcs|pc|компл|к-т|пар[аы]?|уп|ед|единиц[аы]?)/i);
    if (localeMatch) {
        const parsed = parseLocaleNumeric(localeMatch[0]);
        if (parsed && parsed.ambiguous) {
            accepted.push({
                value: parsed.value,
                unit: parsed.unit,
                ambiguous: true,
                source: "locale",
                sourceLine: line,
            });
            workLine = workLine.replace(localeMatch[0], " ");
        }
    }

    // 2. Pack structure "3 компл. по 4 шт"
    let packFound = false;
    for (const m of workLine.matchAll(PACK_INLINE_RE)) {
        const pack = parsePackStructure(m[0]);
        if (pack) {
            accepted.push({
                value: pack.packCount,
                unit: pack.packUnit,
                itemCount: pack.itemCount,
                itemUnit: pack.itemUnit,
                totalCount: pack.totalCount,
                source: "pack",
                sourceLine: line,
            });
            packFound = true;
        }
    }

    // 3. Labeled "в кол-ве N" / "Количество: N"
    for (const m of workLine.matchAll(INLINE_IN_KOLVE_RE)) {
        const parsed = parseInKolve(m[0]);
        if (parsed) {
            accepted.push({
                value: parsed.value,
                unit: parsed.unit,
                source: "labeled",
                sourceLine: line,
            });
        }
    }

    // 4. Generic inline "N шт" / "82ШТ"
    if (!packFound) {
        for (const m of workLine.matchAll(INLINE_QTY_RE)) {
            const value = parseFloat(String(m[1]).replace(",", "."));
            const unit = normalizeQtyUnit(m[2]);
            if (!Number.isFinite(value) || !unit) continue;
            if (value <= 0) continue;
            if (!isCountUnit(unit)) {
                rejected.push({ value, unit, reason: "non_count_unit", sourceLine: line });
                continue;
            }
            if (value > 100000) {
                rejected.push({ value, unit, reason: "outlier", sourceLine: line });
                continue;
            }
            accepted.push({ value, unit, source: "inline", sourceLine: line });
        }
    }

    return { accepted, rejected };
}

function pickPrimary(items) {
    if (items.length === 0) return null;
    // Priority: pack > article_boundary > labeled > inline/multiline_table > locale
    const priority = { pack: 5, article_boundary: 4, labeled: 3, inline: 2, multiline_table: 2, locale: 1 };
    const sorted = [...items].sort((a, b) => {
        const pa = priority[a.source] || 0;
        const pb = priority[b.source] || 0;
        if (pa !== pb) return pb - pa;
        // Tie-break: first in original order
        return 0;
    });
    return sorted[0];
}

// ——————————————————————————————————————————————————————————————
// Public facade
// ——————————————————————————————————————————————————————————————

export function extractQuantities(input, options = {}) {
    const articles = options.articles || [];

    // QTY-2: strip bold/italic Outlook markdown markers before parsing
    // Handles: *10****шт.* → 10шт.
    if (typeof input === "string") {
        input = input.replace(/\*+/g, "");
    }

    // 1. Array-of-objects input: passthrough normalize
    if (Array.isArray(input)) {
        const items = [];
        for (const obj of input) {
            if (!obj || typeof obj !== "object") continue;
            const value = Number(obj.quantity ?? obj.value);
            const unit = normalizeQtyUnit(obj.unit) || "шт";
            if (Number.isFinite(value) && value > 0 && isCountUnit(unit)) {
                items.push({ value, unit, source: "object", sourceLine: "" });
            }
        }
        return {
            primary: pickPrimary(items),
            items,
            rejected: [],
            needsReview: false,
        };
    }

    const text = String(input || "");
    if (!text.trim()) {
        return { primary: null, items: [], rejected: [], needsReview: false };
    }

    // 2. Pre-filter: whole-text phone/date/hours check → reject entirely
    // Only apply for short single-line inputs (e.g. a single quantity candidate string).
    // Multi-line email bodies always pass — they are processed line-by-line in step 3.
    const trimmed = text.trim();
    if (!trimmed.includes("\n") && trimmed.length < 120 &&
        (isPhoneLike(trimmed) || isDateLike(trimmed) || isHoursLike(trimmed))) {
        return {
            primary: null,
            items: [],
            rejected: [{ value: null, reason: "phone_or_date", sourceLine: trimmed }],
            needsReview: false,
        };
    }

    // 3. Split into lines / sentences
    const lines = text
        .split(/\r?\n|(?:[.;!?]\s+)/)
        .map((l) => l.trim())
        .filter(Boolean);

    // QTY-1: cross-line pairing for HTML-table-rendered emails
    // HTML table cells produce: description \n\n N \n\n шт
    // The extractor is line-by-line only; this pre-pass pairs unit-only lines
    // with adjacent number-only lines (within 2 raw lines distance, including blank lines).
    // Uses raw lines (before blank filtering) so "100\n\n\n\nшт" (4 lines apart) is NOT matched.
    const _rawLines = text.split(/\r?\n/).map((l) => l.trim());
    const _UNIT_ONLY_RE = /^(шт|ШТ|штук[аи]?|штука|pcs|pc|компл(?:ект(?:а|ы|ов)?)?|к-т|уп|рул|бух|ед)\.?\s*$/i;
    const _NUM_ONLY_RE = /^(\d+(?:[.,]\d+)?)$/;
    const _multilineItems = [];
    for (let _i = 0; _i < _rawLines.length; _i++) {
        if (!_UNIT_ONLY_RE.test(_rawLines[_i])) continue;
        const _unitStr = _rawLines[_i].trim();
        let _paired = false;
        // Search backward up to 2 raw lines
        for (let _d = 1; _d <= 2 && !_paired; _d++) {
            const _j = _i - _d;
            if (_j < 0) continue;
            const _nm = _rawLines[_j].match(_NUM_ONLY_RE);
            if (!_nm) continue;
            const _val = parseFloat(_nm[1].replace(",", "."));
            if (_val > 0 && _val <= 100000) {
                _multilineItems.push({ value: _val, unit: normalizeQtyUnit(_unitStr) || "шт", source: "multiline_table", sourceLine: `${_rawLines[_j]} ${_unitStr}` });
                _paired = true;
            }
        }
        // Search forward up to 2 raw lines (only if not already paired backward)
        for (let _d = 1; _d <= 2 && !_paired; _d++) {
            const _j = _i + _d;
            if (_j >= _rawLines.length) continue;
            const _nm = _rawLines[_j].match(_NUM_ONLY_RE);
            if (!_nm) continue;
            const _val = parseFloat(_nm[1].replace(",", "."));
            if (_val > 0 && _val <= 100000) {
                _multilineItems.push({ value: _val, unit: normalizeQtyUnit(_unitStr) || "шт", source: "multiline_table", sourceLine: `${_unitStr} ${_rawLines[_j]}` });
                _paired = true;
            }
        }
    }

    const accepted = [];
    const rejected = [];

    for (const line of lines) {
        // Whole-line technical spec check (only if line is tight numeric+unit)
        const full = candidateIsRejected(line);
        if (full.rejected && full.reason === "technical_spec") {
            rejected.push({ value: null, reason: full.reason, sourceLine: line });
            // Still try to extract counts from the line (e.g., "DN 65 - 1 шт")
        }

        const { accepted: localAccepted, rejected: localRejected } = extractFromLine(line, { articles });

        // Per-candidate filter: if a candidate's immediate context matches
        // a technical spec (e.g. "2.20 kW" matched as "2.20" inline), skip.
        for (const cand of localAccepted) {
            // Reconstruct local segment around the value to test
            const numStr = String(cand.value).replace(".", "[.,]");
            const re = new RegExp(`\\b${numStr}\\b\\s*(?:мм|mm|см|cm|m\\b|kW|kg|кг|Вт|W|V|В|bar|МПа|Hz|Гц|rpm|об\\/мин|min-?1|°C)`, "i");
            if (re.test(line)) {
                rejected.push({ value: cand.value, unit: cand.unit, reason: "adjacent_technical", sourceLine: line });
                continue;
            }
            accepted.push(cand);
        }

        rejected.push(...localRejected);

        // Mark technical spec rejections into rejected list
        const techTokens = line.match(/\d+(?:[.,]\d+)?\s*(?:мм|mm|см|cm|kW|V|В|bar|МПа|Hz|Гц|rpm|min-?1)/gi);
        if (techTokens) {
            for (const t of techTokens) {
                rejected.push({ value: null, reason: "technical_spec", sourceLine: t });
            }
        }
    }

    // Dedup rejected by stringified (reason + sourceLine)
    const seenReject = new Set();
    const dedupedRejected = [];
    for (const r of rejected) {
        const key = `${r.reason}|${r.sourceLine}|${r.value ?? ""}`;
        if (seenReject.has(key)) continue;
        seenReject.add(key);
        dedupedRejected.push(r);
    }

    accepted.push(..._multilineItems);
    const primary = pickPrimary(accepted);
    const needsReview = accepted.some((c) => c.ambiguous);

    return {
        primary,
        items: accepted,
        rejected: dedupedRejected,
        needsReview,
    };
}
