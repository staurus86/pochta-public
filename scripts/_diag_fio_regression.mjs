// Regression: run validateSenderFields over every Клиент fullName, diff before/after.
// The digit guard must ONLY change digit-containing names; clean names untouched.
import fs from "node:fs";
import { validateSenderFields } from "../src/services/email-analyzer.js";

const raw = JSON.parse(fs.readFileSync("data/prod-messages-research18.json", "utf8"));
const client = raw.filter((m) => ((m.analysis || {}).classification || {}).label === "Клиент");

let changed = 0, killed = 0, recovered = 0, clientNamed = 0;
const noDigitChanged = [];
for (const m of client) {
    const orig = ((m.analysis || {}).sender || {}).fullName;
    if (!orig || orig === "Не определено") continue;
    clientNamed++;
    const s = { fullName: orig };
    validateSenderFields(s);
    if (s.fullName === orig) continue;
    changed++;
    if (s.fullName === null) killed++;
    else recovered++;
    if (!/\d/.test(orig)) noDigitChanged.push(`${JSON.stringify(orig)} -> ${JSON.stringify(s.fullName)}`);
    if (changed <= 40) console.log(`${JSON.stringify(orig)}  ->  ${JSON.stringify(s.fullName)}`);
}
console.log(`\nКлиент с именем: ${clientNamed}`);
console.log(`changed: ${changed} (killed→null: ${killed}, recovered: ${recovered})`);
console.log(`\n!! changed WITHOUT digits (potential regression): ${noDigitChanged.length}`);
for (const x of noDigitChanged) console.log("   ", x);
