// Diagnostic: categorize article over-extraction / position inflation sources.
// Offline scan of a prod dump. Evidence-gathering for systematic-debugging Phase 1.
import fs from "node:fs";

const FILE = process.argv[2] || "data/prod-messages-research18.json";
const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
const msgs = Array.isArray(raw) ? raw : raw.messages;
const client = msgs.filter(
    (m) => ((m.analysis || {}).classification || {}).label === "Клиент"
);

const norm = (a) => String(a).replace(/[\s\-.\/]/g, "").toLowerCase();

// per-category: messages affected + example tokens
const cat = {};
function hit(name, msgKey, example) {
    cat[name] ??= { msgs: new Set(), ex: new Map() };
    cat[name].msgs.add(msgKey);
    if (cat[name].ex.size < 12) {
        const c = cat[name].ex.get(example) || 0;
        cat[name].ex.set(example, c + 1);
    }
}

const posDist = [];
let withArt = 0;

for (const m of client) {
    const l = (m.analysis || {}).lead || {};
    const arts = (l.articles || []).map((a) =>
        typeof a === "string" ? a : a && (a.code || a.article || "")
    ).filter(Boolean);
    if (arts.length === 0) continue;
    withArt++;
    const key = m.messageKey || m.id;
    const pos = l.positions || l.totalPositions || arts.length;
    posDist.push(pos);

    // A) intra-message near-duplicate pairs (separator-variant or prefix-extension)
    for (let i = 0; i < arts.length; i++) {
        for (let j = i + 1; j < arts.length; j++) {
            const a = norm(arts[i]), b = norm(arts[j]);
            if (!a || !b) continue;
            if (a === b) hit("A_sepdup_equal", key, `${arts[i]} == ${arts[j]}`);
            else if (a.startsWith(b) || b.startsWith(a)) {
                const shorter = a.length < b.length ? a : b;
                if (shorter.length >= 4) hit("A_prefix_ext", key, `${arts[i]} ~ ${arts[j]}`);
            }
        }
    }

    // B) slash secondary code: X/0..  (trailing /00, /01 etc.)
    for (const a of arts) {
        if (/\/0\d{1,2}$/.test(a)) hit("B_slash_secondary", key, a);
    }

    // C) DESC / numbered-list / cyr-only noise in articles
    for (const a of arts) {
        const s = String(a).trim();
        if (/^DESC[:\s]/i.test(s)) hit("C_desc", key, s);
        else if (/^\d{1,3}[.)]\s/.test(s)) hit("C_numbered", key, s);
        else if (/^[А-Яа-яЁё\s\-.,]+$/.test(s) && !/\d/.test(s)) hit("C_cyr_only", key, s);
    }

    // D) spec-noise shape: 2-4 LAT/CYR letters + space + 2-4 digits (e.g. VMB 800)
    for (const a of arts) {
        const s = String(a).trim();
        if (/^[A-ZА-Я]{2,4}\s\d{2,4}$/.test(s)) hit("D_spec_shape", key, s);
    }

    // E) short numeric-only article (<=3 digits)
    for (const a of arts) {
        if (/^\d{1,3}$/.test(String(a).trim())) hit("E_short_num", key, a);
    }
}

posDist.sort((x, y) => x - y);
const q = (p) => posDist[Math.floor((posDist.length - 1) * p)];
console.log(`FILE ${FILE}`);
console.log(`Клиент=${client.length} withArticles=${withArt}`);
console.log(`positions dist: min=${posDist[0]} p50=${q(0.5)} p90=${q(0.9)} p95=${q(0.95)} p99=${q(0.99)} max=${posDist[posDist.length - 1]}`);
console.log(`multi-position msgs (>1): ${posDist.filter((x) => x > 1).length}`);
console.log("\n=== Categories (ranked by #messages affected) ===");
const rows = Object.entries(cat).map(([n, v]) => [n, v.msgs.size, v.ex]);
rows.sort((a, b) => b[1] - a[1]);
for (const [n, count, ex] of rows) {
    console.log(`\n${n}: ${count} msgs`);
    const exs = [...ex.entries()].slice(0, 8);
    for (const [e, c] of exs) console.log(`    ${c}x  ${e}`);
}
