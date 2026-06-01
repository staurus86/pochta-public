// Regression diff: which distinct corpus articles does isObviousArticleNoise reject?
// Run on baseline (stash) and on fix, diff the rejected sets.
import fs from "node:fs";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";

const raw = JSON.parse(fs.readFileSync("data/prod-messages-research18.json", "utf8"));
const client = raw.filter((m) => ((m.analysis || {}).classification || {}).label === "Клиент");
const distinct = new Set();
for (const m of client) {
    const l = (m.analysis || {}).lead || {};
    for (const a of l.articles || []) {
        const s = typeof a === "string" ? a : a && (a.code || "");
        if (s) distinct.add(s);
    }
}
const rejected = [...distinct].filter((a) => isObviousArticleNoise(a)).sort();
console.log(`distinct articles: ${distinct.size}`);
console.log(`rejected by isObviousArticleNoise: ${rejected.length}`);
fs.writeFileSync(process.argv[2] || "data/.fileext_rejected.json", JSON.stringify(rejected, null, 0));
