// Body structure reconstructor — rebuilds order positions from email bodies where
// the original table/list structure was flattened by HTML→text conversion.
//
// Three high-precision shapes (from n8n manager feedback, 52 commented emails):
//   vertical_table  — "name\n\nqty\n\nunit[\n\ncode]" repeating groups
//   collapsed_table — "Наименование Ед. изм. Кол-во 1 <name> ШТ 1 2 <name> ШТ 2 ..." blobs
//   numbered_list   — "N) Name (Brand) CODE ... В количестве N штук" segments
//
// Returns { kind, rows } or null when no shape matches confidently. Rows carry
// per-row qty/unit (and article/brandHint when the shape states them explicitly);
// article extraction from row names is left to the caller's noise-aware extractors.

const UNIT_RE = /^(?:шт|штук[аи]?|единиц[аы]?|компл(?:ект(?:ов|а)?)?|к-т|кт|уп(?:ак\w{0,6})?|пар[аы]?|м|кг|г|л|т|п\.?\s?м|метр\w{0,3}|рул\w{0,4}|бух\w{0,4})\.?$/i;
const NUM_RE = /^\d{1,5}(?:[.,]\d{1,3})?$/;
const INT_RE = /^\d{1,3}$/;
const HEADER_RE = /^(?:№|п\/п|поз\.?|наименование(?:\s+(?:товара|изделия|продукции))?|кол-?во|количество|ед\.?\s*изм\.?\w*|единицы?\s+измерения|описание|артикул|примечание|цена|стоимость|сумма)[\s.:]*$/i;
const FOOTNOTE_RE = /^(?:каталог\b|информация\b|стр\.\s*№)/i;
const SIGNOFF_RE = /^(?:с\s+уважением|best\s+regards|with\s+best|--\s*$|—\s*$|__|спасибо\b|заранее\s+благодар|надеюсь\s+на)/i;
const CODE_LINE_RE = /^[A-Za-zА-ЯЁ#(]?[A-Za-zА-ЯЁа-яё0-9][A-Za-zА-ЯЁа-яё0-9\-\/._#)]{4,24}$/;
const NAME_STOP_RE = /(?:https?:\/\/|www\.|@|cid:|^\+?\d[\d\s()-]{6,}$)/i;
const COLLAPSED_HEADER_RE = /(?:№\s+)?Наименование(?:\s+(?:товара|изделия|продукции))?\s+(?:Ед\.?\s*изм\.?\w*\s+)?Кол-?во/i;
const COLLAPSED_ROW_RE = /(\d{1,3})\s+(.{6,220}?)\s+(ШТ|КОМПЛ|К-Т|УП|ПАР|КГ|Л|М)\.?\s+(\d{1,5}(?:[.,]\d{1,3})?)(?=\s+\d{1,3}\s+[А-ЯЁA-Za-z(«"]|\s*$)/giu;
const NUMBERED_ANCHOR_RE = /^[ \t]*(\d{1,2})[.)][ \t]+(?=\S)/;
const NUMBERED_QTY_RE = /в\s+количестве\s+(\d{1,5})\s*(шт|штук[аи]?|компл\w{0,6}|единиц[аы]?|пар[аы]?|м|кг|л)?/i;
const NUMBERED_DASH_QTY_RE = /[—–-]\s*(\d{1,5}(?:[.,]\d{1,2})?)\s*(шт|штук[аи]?|компл\w{0,6}|единиц[аы]?|пар[аы]?)\b/i;
const PAREN_BRAND_CODE_RE = /\(([A-Za-zА-ЯЁ][A-Za-zА-ЯЁа-яё&.\s-]{1,30})\)\s*([A-Za-z0-9][A-Za-z0-9\-\/]{4,24})/;

function stripLightMarkup(line) {
    return line.replace(/^[*_>•·\s]+|[*_\s]+$/g, "").trim();
}

function parseNum(value) {
    const n = parseFloat(String(value).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function isUnitLine(line) {
    return UNIT_RE.test(line);
}

function isNumLine(line) {
    return NUM_RE.test(line);
}

function isCodeLine(line) {
    if (!CODE_LINE_RE.test(line)) return false;
    if (isNumLine(line) || isUnitLine(line)) return false;
    const digits = (line.match(/\d/g) || []).length;
    return digits >= 2;
}

function isNameLine(line) {
    if (line.length < 8) return false;
    if (isNumLine(line) || isUnitLine(line) || HEADER_RE.test(line) || FOOTNOTE_RE.test(line)) return false;
    if (NAME_STOP_RE.test(line)) return false;
    if (!/[A-Za-zА-ЯЁа-яё]{3,}/.test(line)) return false;
    const words = line.split(/\s+/).filter((w) => /[A-Za-zА-ЯЁа-яё]/.test(w));
    return words.length >= 2 || /[A-Za-zА-ЯЁ]+\d|\d+[A-Za-zА-ЯЁ]+/.test(line);
}

// Token that mixes letters and digits (or a long digit run) — an article-ish marker
// used to accept single-row reconstructions.
function nameCarriesArticleToken(name) {
    return /\b(?=[A-Za-z0-9-]{5,})[A-Za-z]*\d[A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*\b/.test(name) || /\d{5,}/.test(name);
}

// ── vertical_table ───────────────────────────────────────────────────────────

function reconstructVerticalTable(body) {
    // Labeled-article blocks ("Арт.: H0019-0008-28" / "шт." / "3") are owned by the
    // line-item extractor's parseArticleQtyBlocks, which keeps the labeled code as the
    // article. Reconstructing over them loses the labels — defer.
    if (/^\s*арт(?:икул)?\.?\s*[:#]/im.test(body)) return null;
    // Sign-off lines are excluded but do NOT stop the scan: in reply chains the
    // client's signature precedes the quoted request that holds the actual table.
    const lines = body.split(/\r?\n/).map(stripLightMarkup).filter(Boolean)
        .filter((line) => !SIGNOFF_RE.test(line));
    if (lines.length < 3) return null;

    // Strip sequential row-index lines (an integer line immediately preceding a name line,
    // values forming an increasing sequence that starts at 1).
    const indexPositions = [];
    let expected = 1;
    for (let i = 0; i < lines.length - 1; i++) {
        if (!INT_RE.test(lines[i])) continue;
        const value = Number(lines[i]);
        if (value !== expected) continue;
        // The row index precedes the name, possibly with header lines between.
        let j = i + 1;
        while (j < lines.length && HEADER_RE.test(lines[j])) j++;
        if (j < lines.length && isNameLine(lines[j])) {
            indexPositions.push(i);
            expected++;
        }
    }
    const useIndexStrip = indexPositions.length >= 2;
    const work = useIndexStrip ? lines.filter((_, i) => !indexPositions.includes(i)) : lines;

    const rows = [];
    for (let i = 0; i < work.length; i++) {
        if (!isNameLine(work[i])) continue;
        const window = [];
        let j = i + 1;
        while (j < work.length && window.length < 6 && !isNameLine(work[j])) {
            window.push(work[j]);
            j++;
        }
        const filtered = window.filter((l) => !HEADER_RE.test(l) && !FOOTNOTE_RE.test(l));
        const unitIdx = filtered.findIndex(isUnitLine);
        let qty = null;
        if (unitIdx >= 0) {
            if (unitIdx > 0 && isNumLine(filtered[unitIdx - 1])) qty = parseNum(filtered[unitIdx - 1]);
            else if (unitIdx + 1 < filtered.length && isNumLine(filtered[unitIdx + 1])) qty = parseNum(filtered[unitIdx + 1]);
        } else {
            const nums = filtered.filter(isNumLine);
            if (nums.length === 1) qty = parseNum(nums[0]);
        }
        if (qty == null) continue;
        const codeLine = filtered.find((l) => isCodeLine(l) && !isNumLine(l) && (unitIdx < 0 || l !== filtered[unitIdx]));
        rows.push({
            descriptionRu: work[i],
            article: codeLine || null,
            quantity: qty,
            unit: unitIdx >= 0 ? filtered[unitIdx].replace(/\.$/, "").toLowerCase() : "шт",
            brandHint: null,
            sourceLine: work[i],
        });
    }

    if (rows.length >= 2) return rows;
    if (rows.length === 1 && nameCarriesArticleToken(rows[0].descriptionRu)) return rows;
    return null;
}

// ── collapsed_table ──────────────────────────────────────────────────────────

function reconstructCollapsedTable(body) {
    for (const line of body.split(/\r?\n/)) {
        if (line.length < 120) continue;
        const headerMatch = line.match(COLLAPSED_HEADER_RE);
        if (!headerMatch) continue;
        const tail = line.slice(headerMatch.index + headerMatch[0].length);
        const rows = [];
        let prevIndex = 0;
        COLLAPSED_ROW_RE.lastIndex = 0;
        for (const m of tail.matchAll(COLLAPSED_ROW_RE)) {
            const index = Number(m[1]);
            if (index !== prevIndex + 1) continue;
            prevIndex = index;
            const qty = parseNum(m[4]);
            if (qty == null) continue;
            rows.push({
                descriptionRu: m[2].trim(),
                article: null,
                quantity: qty,
                unit: m[3].replace(/\.$/, "").toLowerCase(),
                brandHint: null,
                sourceLine: m[2].trim(),
            });
        }
        if (rows.length >= 3) return rows;
    }
    return null;
}

// ── numbered_list ────────────────────────────────────────────────────────────

function reconstructNumberedList(body) {
    const lines = body.split(/\r?\n/);
    const anchors = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(NUMBERED_ANCHOR_RE);
        if (m) anchors.push({ line: i, value: Number(m[1]), offset: m[0].length });
    }
    // Require a sequence 1..n (n >= 3) — sequential anchors, strictly increasing by 1.
    const seq = [];
    for (const a of anchors) {
        if (seq.length === 0 ? a.value === 1 : a.value === seq[seq.length - 1].value + 1) seq.push(a);
    }
    if (seq.length < 3) return null;

    const rows = [];
    let informative = 0;
    for (let k = 0; k < seq.length; k++) {
        const start = seq[k].line;
        const end = k + 1 < seq.length ? seq[k + 1].line : lines.length;
        const segmentLines = [];
        for (let i = start; i < end; i++) {
            const stripped = stripLightMarkup(lines[i]);
            if (i > start && (SIGNOFF_RE.test(stripped) || !stripped)) break;
            segmentLines.push(i === start ? lines[i].slice(seq[k].offset).trim() : stripped);
        }
        const segment = segmentLines.join(" ").replace(/\s+/g, " ").trim();
        if (!segment) return null;

        const qtyMatch = segment.match(NUMBERED_QTY_RE) || segment.match(NUMBERED_DASH_QTY_RE);
        const brandCode = segment.match(PAREN_BRAND_CODE_RE);
        const article = brandCode && /\d/.test(brandCode[2]) ? brandCode[2] : null;
        if (qtyMatch || article) informative++;
        rows.push({
            descriptionRu: segment.replace(NUMBERED_QTY_RE, "").replace(/\s+/g, " ").replace(/[\s.,]+$/, "").trim(),
            article,
            quantity: qtyMatch ? parseNum(qtyMatch[1]) : null,
            unit: qtyMatch && qtyMatch[2] ? qtyMatch[2].toLowerCase() : "шт",
            brandHint: brandCode ? brandCode[1].trim() : null,
            sourceLine: segment.slice(0, 200),
        });
    }

    // Fire only when the list states quantities or explicit (Brand) CODE articles —
    // plain numbered enumerations are already handled by the line-item extractor.
    if (informative >= Math.max(2, Math.ceil(rows.length * 0.6))) return rows;
    return null;
}

// ── paired_rows ──────────────────────────────────────────────────────────────
// Word .doc tables flattened to "short name\nfull spec" line pairs that share the
// first word ("Щетка для очистки..." → "Щетка 32143-48 М8х5 ... Артикул 36392").
// One row per pair; the longer spec line is the description.

const PAIR_STOP_RE = /^(?:from|sent|subject|to|кому|тема|дата|дополнительные\s+требования)\b/i;
const PAIR_ARTICLE_HINT_RE = /(?:артикул|арт\.?\s)|[A-Za-zА-ЯЁ]*\d[A-Za-zА-ЯЁ0-9./-]{2,}/i;

function reconstructPairedRows(body) {
    const lines = body.split(/\r?\n/).map(stripLightMarkup).filter(Boolean)
        .filter((line) => !SIGNOFF_RE.test(line));
    const rows = [];
    let withArticleHint = 0;
    for (let i = 0; i < lines.length - 1; i++) {
        const a = lines[i];
        const b = lines[i + 1];
        if (a.length < 10 || PAIR_STOP_RE.test(a) || PAIR_STOP_RE.test(b)) continue;
        if (HEADER_RE.test(a) || HEADER_RE.test(b)) continue;
        const firstWordA = (a.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-zа-яё-]+$/i, "");
        const firstWordB = (b.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-zа-яё-]+$/i, "");
        if (firstWordA.length < 5 || firstWordA !== firstWordB) continue;
        if (a === b || b.length < a.length - 12) continue;
        if (!/[A-Za-zА-ЯЁа-яё]{4,}/.test(b)) continue;
        const spec = b.length >= a.length ? b : a;
        // Word style-table residue ("Основной текст Знак", "Заголовок 1") pairs up the
        // same way but never carries an article-like token — emit hinted pairs only.
        if (!PAIR_ARTICLE_HINT_RE.test(spec)) continue;
        withArticleHint++;
        rows.push({
            descriptionRu: spec,
            article: null,
            quantity: null,
            unit: "шт",
            brandHint: null,
            sourceLine: spec,
        });
        i++; // consume the pair
    }
    if (rows.length >= 3) return rows;
    return null;
}

export function reconstructBodyPositions(body) {
    const text = String(body || "");
    if (!text.trim()) return null;

    const collapsed = reconstructCollapsedTable(text);
    if (collapsed) return { kind: "collapsed_table", rows: collapsed };

    const numbered = reconstructNumberedList(text);
    if (numbered) return { kind: "numbered_list", rows: numbered };

    const vertical = reconstructVerticalTable(text);
    if (vertical) return { kind: "vertical_table", rows: vertical };

    const paired = reconstructPairedRows(text);
    if (paired) return { kind: "paired_rows", rows: paired };

    return null;
}
