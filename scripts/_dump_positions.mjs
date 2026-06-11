// Dump per-message payload positions (article+qty+brand) for the no-attachment cohort.
// Usage: node scripts/_dump_positions.mjs out.json
import fs from "node:fs";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const DUMP = "data/prod-messages-2026-04-19-postJ-r4.json";
const OUT = process.argv[2] || "/tmp/positions.json";
const project = { id: "project-4-klvrt-mail", name: "project-4-klvrt-mail", brands: [] };

const d = JSON.parse(fs.readFileSync(DUMP, "utf8"));
const msgs = Array.isArray(d) ? d : (d.messages || d.recentMessages || []);
const out = {};
for (const m of msgs) {
    const attFiles = m.attachmentFiles || m.attachments || [];
    if (Array.isArray(attFiles) && attFiles.length > 0) continue;
    const body = (m.analysis && m.analysis.rawInput && m.analysis.rawInput.body) || m.bodyPreview || "";
    try {
        const res = analyzeEmail(project, {
            subject: m.subject || "", body,
            fromEmail: m.from || m.fromEmail || "", fromName: m.fromName || "",
            attachmentFiles: [], messageKey: m.messageKey || m.id || "",
        });
        const p = buildSiderusCrmPayload(project, { ...m, analysis: res }, "https://x", "T");
        out[m.messageKey || m.id] = p.order_from_mail.map((r) => ({
            a: r.item_number, q: r.quantity, b: r.brand, d: (r.desc || "").slice(0, 60),
        }));
    } catch (e) {
        out[m.messageKey || m.id] = `ERROR: ${e.message}`;
    }
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`dumped ${Object.keys(out).length} messages to ${OUT}`);
