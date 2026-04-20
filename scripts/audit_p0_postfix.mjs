// Post-fix P0 audit simulator.
// Loads prod JSON, reapplies NEW filters/normalizers to articles/titles/brands,
// reports delta vs baseline (how many bucket entries would be eliminated).
import fs from "node:fs";
import path from "node:path";
import { rejectArticleCandidate } from "../src/services/article-filters.js";
import { dedupeCaseInsensitive } from "../src/services/article-normalizer.js";
import { normalizeProductName } from "../src/services/product-name-normalizer.js";
import { isBadProductName } from "../src/services/product-name-filters.js";

const PROD = process.argv[2] || "C:/Opencode-test/pochta/data/prod-messages-local-postAudit2.json";
const OUT = process.argv[3] || "C:/Opencode-test/pochta/.planning/phases/01-detection-fixes/P0_POSTFIX.json";

const raw = JSON.parse(fs.readFileSync(PROD, "utf-8"));
const msgs = Array.isArray(raw) ? raw : raw.messages || [];
const clients = msgs.filter(m => m?.analysis?.classification?.label === "Клиент");

// --- audit-buckets heuristics (mirror scripts/audit_p0.py) ---
const YEAR_RE = /^(19|20)\d{2}$/;
const PHONE_LIKE_RE = /^\+?[78]?[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}$/;
const INN_LIKE_RE = /^\d{10}$|^\d{12}$/;
const DATE_LIKE_RE = /^\d{2}[./-]\d{2}[./-]\d{2,4}$/;
const DIGIT_ONLY_RE = /^\d+$/;
const DECIMAL_NUM_RE = /^\d{1,3}[.,]\d+$/;
const GOST_RE = /^ГОСТ[\s-]?\d/i;
const SHORT_CYR_RE = /^[А-ЯЁа-яё]{1,3}$/;
const HTML_TAG_RE = /<[^>]+>/;
const CSS_RE = /\bfont-(?:family|size|weight|style)\b|\bcolor\s*:|mso-|\b(?:Arial|Helvetica|Calibri|Times\s+New\s+Roman)\b/i;
const EMAIL_FRAG_RE = /[\w.+\-]+@[\w.\-]+/;
const URL_RE = /https?:\/\/|www\./i;
const PAGE_NOISE_RE = /^(page|mailto|e-?mail|WordSection|mso|span|div|class|style|table|tr|td)\b/i;
const OFFICE_NUM_RE = /^(?:оф|каб|комн|этаж)\b/i;
const ADDRESS_RE = /\b(?:стр|д|дом|пер|пр-т|просп|ш|ул|наб|кв|оф|корп|к)\.?\s*\d/i;
const QUOTE_MARKER_TITLE_RE = /^(?:>\s*|---+\s*(?:Original|Forwarded))/i;
const CAP_LIST_RE = /Бренды|бренды,\s+по\s+которым/;

function bucketArticle(a) {
    const s = String(a).trim();
    if (!s) return null;
    if (YEAR_RE.test(s)) return "A1_year_as_article";
    if (PHONE_LIKE_RE.test(s) || (DIGIT_ONLY_RE.test(s) && s.length === 11)) return "A2_phone_as_article";
    if (INN_LIKE_RE.test(s)) return "A3_inn_as_article";
    if (DATE_LIKE_RE.test(s)) return "A4_date_as_article";
    if (DIGIT_ONLY_RE.test(s) && s.length <= 3) return "A5_tiny_digit_article";
    if (DECIMAL_NUM_RE.test(s)) return "A6_decimal_as_article";
    if (GOST_RE.test(s)) return "A7_gost_as_article";
    if (SHORT_CYR_RE.test(s)) return "A8_short_cyr_article";
    if (HTML_TAG_RE.test(s) || CSS_RE.test(s)) return "A9_html_css_article";
    if (PAGE_NOISE_RE.test(s) || EMAIL_FRAG_RE.test(s) || URL_RE.test(s)) return "A10_pagemail_article";
    if (OFFICE_NUM_RE.test(s) || ADDRESS_RE.test(s)) return "A11_address_as_article";
    return null;
}

function bucketTitle(pn) {
    const s = String(pn).trim();
    if (!s) return null;
    if (HTML_TAG_RE.test(s) || CSS_RE.test(s)) return "B1_html_in_title";
    if (EMAIL_FRAG_RE.test(s) || URL_RE.test(s)) return "B2_email_url_in_title";
    if (s.length < 4) return "B3_tiny_title";
    if (/^[A-Z0-9\-./]+$/.test(s) && s.length < 25) return "B4_looks_like_article_only";
    if (QUOTE_MARKER_TITLE_RE.test(s)) return "B5_quoted_marker_title";
    if (CAP_LIST_RE.test(s)) return "B6_capability_list_title";
    if (s.length > 300) return "B7_blob_title";
    return null;
}

// --- counters ---
const baseline = {};
const postfix = {};
const deltas = [];

function bump(store, key) { store[key] = (store[key] || 0) + 1; }

for (const m of clients) {
    const lead = m?.analysis?.lead || {};
    const articles = lead.articles || [];
    const brands = lead.detectedBrands || [];
    const titles = lead.productNamesClean || [];

    // ARTICLES baseline + postfix
    for (const a of articles) {
        const base = bucketArticle(a);
        if (base) bump(baseline, base);
        // Would NEW filter reject it?
        const rejected = rejectArticleCandidate(String(a), { hasLabel: false }).rejected;
        if (base && !rejected) bump(postfix, base);
    }
    // Dedup articles: baseline = how many are duplicates, postfix = after dedupKey normalize
    const seenBase = new Set();
    let baseDup = 0;
    for (const a of articles) {
        const k = String(a).toLowerCase().replace(/[\s\-/]/g, "");
        if (seenBase.has(k)) baseDup++;
        else seenBase.add(k);
    }
    if (baseDup) bump(baseline, "A12_duplicate_articles");
    const deduped = dedupeCaseInsensitive(articles.map(String));
    const postDup = articles.length - deduped.length;
    if (postDup > 0) bump(postfix, "A12_duplicate_articles");

    if (articles.length > 20) bump(baseline, "A13_over_extraction_articles");
    // Postfix: count after rejects + dedup
    const keptArticles = dedupeCaseInsensitive(
        articles.map(String).filter(a => !rejectArticleCandidate(a, { hasLabel: false }).rejected)
    );
    if (keptArticles.length > 20) bump(postfix, "A13_over_extraction_articles");

    // TITLES
    for (const pn of titles) {
        const base = bucketTitle(pn);
        if (base) bump(baseline, base);
        // Post-fix: run through normalizeProductName + isBadProductName
        const cleaned = normalizeProductName(String(pn));
        const bad = isBadProductName(cleaned);
        if (!bad && cleaned) {
            const after = bucketTitle(cleaned);
            if (after) bump(postfix, after);
        }
    }

    // Titles duplicate (lower-cased exact)
    const seenTitle = new Set();
    let tDup = 0;
    for (const pn of titles) {
        const k = String(pn).toLowerCase().trim();
        if (seenTitle.has(k)) tDup++;
        else seenTitle.add(k);
    }
    if (tDup) bump(baseline, "B8_duplicate_titles");
    const cleanedTitles = titles.map(t => normalizeProductName(String(t))).filter(t => t && !isBadProductName(t));
    const dedupT = new Set();
    let pDup = 0;
    for (const pn of cleanedTitles) {
        const k = pn.toLowerCase().trim();
        if (dedupT.has(k)) pDup++;
        else dedupT.add(k);
    }
    if (pDup) bump(postfix, "B8_duplicate_titles");

    if (titles.length > 30) bump(baseline, "B9_over_extraction_titles");
    if (cleanedTitles.length > 30) bump(postfix, "B9_over_extraction_titles");

    // E2 title-is-article (only baseline for context)
    if (articles.length && titles.length) {
        const artSet = new Set(articles.map(String));
        for (const pn of titles) {
            const toks = String(pn).match(/[A-Z0-9][A-Z0-9\-./]{2,}/g) || [];
            const overlap = toks.filter(t => artSet.has(t));
            if (overlap.length && pn.length < 40) { bump(baseline, "E2_title_is_article"); break; }
        }
        // Postfix: after removing rejected articles, recompute
        const survivingArt = new Set(
            articles.map(String).filter(a => !rejectArticleCandidate(a, { hasLabel: false }).rejected)
        );
        for (const pn of cleanedTitles) {
            const toks = pn.match(/[A-Z0-9][A-Z0-9\-./]{2,}/g) || [];
            const overlap = toks.filter(t => survivingArt.has(t));
            if (overlap.length && pn.length < 40) { bump(postfix, "E2_title_is_article"); break; }
        }
    }
}

// --- Report ---
const keys = [
    "A1_year_as_article","A2_phone_as_article","A3_inn_as_article","A4_date_as_article",
    "A5_tiny_digit_article","A6_decimal_as_article","A7_gost_as_article","A8_short_cyr_article",
    "A9_html_css_article","A10_pagemail_article","A11_address_as_article",
    "A12_duplicate_articles","A13_over_extraction_articles",
    "B1_html_in_title","B2_email_url_in_title","B3_tiny_title","B4_looks_like_article_only",
    "B5_quoted_marker_title","B6_capability_list_title","B7_blob_title",
    "B8_duplicate_titles","B9_over_extraction_titles",
    "E2_title_is_article",
];

console.log(`POSTFIX SIMULATION on ${clients.length} Клиент msgs\n`);
console.log(`${"BUCKET".padEnd(32)} ${"BASE".padStart(6)} ${"POST".padStart(6)} ${"DELTA".padStart(7)}`);
console.log("-".repeat(56));
const rows = {};
for (const k of keys) {
    const b = baseline[k] || 0;
    const p = postfix[k] || 0;
    const d = p - b;
    rows[k] = { baseline: b, postfix: p, delta: d };
    const arrow = d < 0 ? `↓${Math.abs(d)}` : d > 0 ? `↑${d}` : "=";
    console.log(`${k.padEnd(32)} ${String(b).padStart(6)} ${String(p).padStart(6)} ${arrow.padStart(7)}`);
}

fs.writeFileSync(OUT, JSON.stringify({ clients: clients.length, rows }, null, 2));
console.log(`\nSaved → ${OUT}`);
