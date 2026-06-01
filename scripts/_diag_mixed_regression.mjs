import fs from "node:fs";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";
let client = [];
for (const f of ["data/.fresh2_p4.json", "data/.fresh2_p3.json"]) {
    const d = JSON.parse(fs.readFileSync(f)); const m = d.messages || d;
    client = client.concat(m.filter((x) => ((x.analysis || {}).classification || {}).label === "Клиент"));
}
const distinct = new Set();
for (const m of client) for (const a of (((m.analysis || {}).lead || {}).articles || [])) {
    const s = typeof a === "string" ? a : a && a.code; if (s) distinct.add(s);
}
const rejected = [...distinct].filter((a) => isObviousArticleNoise(a)).sort();
console.log(`distinct articles: ${distinct.size} | rejected: ${rejected.length}`);
fs.writeFileSync(process.argv[2], JSON.stringify(rejected, null, 0));
