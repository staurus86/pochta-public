// Collect {messageKey: fullName} over a dump using the CURRENT code. Used to diff
// fio output with vs without the system-phrase fix (run twice, stash fio-filters between).
import fs from "node:fs";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const DUMP = "data/prod-messages-2026-04-19-postJ-r4.json";
const OUT = process.argv[2] || "/tmp/fio_a.json";
const msgs = JSON.parse(fs.readFileSync(DUMP, "utf8")).messages || [];
const proj = { id: "project-4-klvrt-mail", name: "p4", brands: [] };
const out = {};
for (const m of msgs) {
    const body = (m.analysis && m.analysis.rawInput && m.analysis.rawInput.body) || m.bodyPreview || "";
    try {
        const r = analyzeEmail(proj, { subject: m.subject || "", body, fromEmail: m.from || "", fromName: m.fromName || "", attachmentFiles: m.attachmentFiles || [], messageKey: m.messageKey });
        out[m.messageKey || m.id] = (r.sender && r.sender.fullName) ?? null;
    } catch { out[m.messageKey || m.id] = "__ERROR__"; }
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${Object.keys(out).length} fio values → ${OUT}`);
