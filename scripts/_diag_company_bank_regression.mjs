// Regression: run sanitizeCompanyName over every distinct corpus companyName.
// Diff the null-set baseline (stash) vs fix — newly nulled must be only banks.
import fs from "node:fs";
import { sanitizeCompanyName } from "../src/services/email-analyzer.js";

const raw = JSON.parse(fs.readFileSync("data/prod-messages-research18.json", "utf8"));
const client = raw.filter((m) => ((m.analysis || {}).classification || {}).label === "Клиент");
const distinct = new Set();
for (const m of client) {
    const s = (m.analysis || {}).sender || {};
    const c = (s.companyName || s.company || "").trim();
    if (c && c !== "Не определено") distinct.add(c);
}
const nulled = [...distinct].filter((c) => sanitizeCompanyName(c) == null).sort();
console.log(`distinct companyNames: ${distinct.size}`);
console.log(`sanitizeCompanyName → null: ${nulled.length}`);
fs.writeFileSync(process.argv[2] || "data/.co_nulled.json", JSON.stringify(nulled, null, 0));
