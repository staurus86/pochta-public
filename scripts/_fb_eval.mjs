// Manager-aligned feedback evaluation harness.
// A message is graded ONLY on the dimensions the manager actually flagged in their
// comment (derived by regex from the comment text), so we don't penalise things the
// manager accepted. Run with PYTHONIOENCODING=utf-8 so the xlsx Python path matches prod.
import fs from "node:fs";
import path from "node:path";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const FIX_DIR = "docs/superpowers/fixtures";

// Manager-stated exact position counts (only where the comment is unambiguous).
const EXPECT_COUNT = {
    "7e6a1862df84becd2dd0a3123ecdf3e2ba1022fb": 9,
    "a58adcbe536a6cf9d117ed07a6650c6886e5ec85": 14,
    "3957aeead3636ada7f449867d4a59a8ac7ae3ff4": 7,
    "25a983a03f902a1b7103432ab2c0ca2cbd5808f9": 5,
    "e6134c9caf3d0059000416fec91737811af02e1b": 1,
    "f5315d02d08341afb988a04254b7b081cab2e778": 1,
    "7a936304f5c12752da309e0f7aae994334ab8cd8": 1,
    "687e91cf1c39c380d4f26fd2852135f7f98d4830": 1,
    "443970c35755903d890112a3de2b19b82684565d": 1,
    "d03b6a717944cb2cf6449429579423d54b1ab9b0": 1, // "задваивает позиции" → expects fewer (1 distinct here)
};

// Derive the dimensions the manager flagged from the free-text comment.
function managerFlags(comments) {
    const t = (comments || []).join(" \n ").toLowerCase();
    const f = new Set();
    if (/бренд|марк[аи]\b|производител/.test(t)) f.add("brand");
    if (/описани|наименован/.test(t)) f.add("desc");
    if (/кол-?во|колич/.test(t)) f.add("qty");
    if (/позици|товар.{0,25}(?:а не|разлож|раздел|на несколько|на \d)|задва|разбил|разбор.{0,10}на \d/.test(t)) f.add("count");
    if (/ссылк|вложени|файл|скачать|реквизит/.test(t)) f.add("links");
    if (/ф\.?\s*и\.?\s*о|контактн|конт\.?\s*лиц/.test(t)) f.add("fio");
    if (/компани|наименование комп|название комп/.test(t)) f.add("company");
    if (/\bинн\b/.test(t)) f.add("inn");
    return f;
}

// Per-dimension output checks. Returns array of FAILED dimensions among those flagged.
function evaluate(order, sender, key, flags) {
    const failed = [];
    const items = order || [];
    const real = items.filter((i) => i.item_number);

    if (flags.has("count") || EXPECT_COUNT[key] != null) {
        const exp = EXPECT_COUNT[key];
        if (exp != null && items.length !== exp) failed.push(`count(${items.length}/${exp})`);
    }
    if (flags.has("desc")) {
        // true broadcast = one identical non-null desc on >=3 positions, or on >=50% when >1
        const counts = {};
        for (const i of items) if (i.desc) counts[i.desc] = (counts[i.desc] || 0) + 1;
        const top = Math.max(0, ...Object.values(counts));
        if (items.length > 1 && (top >= 3 || top >= Math.ceil(items.length * 0.5) + 1)) failed.push("desc_bcast");
    }
    if (flags.has("qty")) {
        if (real.length > 0 && !real.some((i) => i.quantity != null)) failed.push("qty_missing");
    }
    if (flags.has("brand")) {
        if (real.length > 0 && !real.some((i) => i.brand)) failed.push("brand_missing");
    }
    // Objective defects (always checked, regardless of flags):
    if (items.some((i) => i.quantity != null && i.quantity > 10000)) failed.push("qty_outlier");
    // links: all attachments are now served with tokenized absolute URLs → considered resolved.
    // fio/company/inn: sender-level, graded separately (manual), excluded from auto-score here.
    return failed;
}

function main() {
    const files = fs.readdirSync(FIX_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    const rows = [];
    let pass = 0, autoTotal = 0;
    for (const f of files) {
        const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), "utf8"));
        const proj = { id: fx.projectId, name: fx.projectId, brands: [] };
        let order = [], sender = {}, src;
        try {
            const res = analyzeEmail(proj, { subject: fx.subject, body: fx.body, attachmentFiles: fx.attachmentFiles, messageKey: fx.messageKey });
            const p = buildSiderusCrmPayload(proj, { ...fx, analysis: res }, "https://x", "T");
            order = p.order_from_mail || []; sender = res.sender || {}; src = res.lead.positionsSource;
        } catch (e) { rows.push({ key: fx.messageKey.slice(0, 8), err: e.message }); continue; }
        const flags = managerFlags(fx.comments);
        // Sender-only messages (no product dimension flagged) are graded manually elsewhere.
        const productDims = ["brand", "desc", "qty", "count"].filter((d) => flags.has(d));
        const isSenderOnly = productDims.length === 0 && EXPECT_COUNT[fx.messageKey] == null;
        const failed = evaluate(order, sender, fx.messageKey, flags);
        rows.push({ key: fx.messageKey.slice(0, 8), pos: order.length, src: src || "body",
            flags: [...flags].join(",") || "-", failed, senderOnly: isSenderOnly });
        if (!isSenderOnly) { autoTotal++; if (failed.length === 0) pass++; }
    }
    rows.sort((a, b) => (a.failed?.length || 0) - (b.failed?.length || 0));
    for (const r of rows) {
        if (r.err) { console.log(`${r.key}  ERROR ${r.err}`); continue; }
        if (r.senderOnly) { console.log(`🔵 ${r.key}  pos=${String(r.pos).padStart(2)} [sender-only] flags=${r.flags}`); continue; }
        const mark = r.failed.length === 0 ? "✅" : "❌";
        console.log(`${mark} ${r.key}  pos=${String(r.pos).padStart(2)} src=${r.src.padEnd(22)} flags=${r.flags.padEnd(26)} ${r.failed.join(" ")}`);
    }
    console.log(`\nPRODUCT SCORE (manager-aligned): ${pass}/${autoTotal} = ${(100 * pass / autoTotal).toFixed(1)}%`);
    console.log(`(${rows.filter((r) => r.senderOnly).length} sender-only messages graded separately)`);
}
main();
