// Diagnostic dump for failing feedback fixtures: comments + body + current order output.
import fs from "node:fs";
import path from "node:path";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const FIX_DIR = "docs/superpowers/fixtures";
const keys = process.argv.slice(2);

for (const k of keys) {
    const file = fs.readdirSync(FIX_DIR).find((f) => f.startsWith(k));
    if (!file) { console.log(`NOT FOUND: ${k}`); continue; }
    const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, file), "utf8"));
    const proj = { id: fx.projectId, name: fx.projectId, brands: [] };
    const res = analyzeEmail(proj, { subject: fx.subject, body: fx.body, attachmentFiles: fx.attachmentFiles, messageKey: fx.messageKey });
    const p = buildSiderusCrmPayload(proj, { ...fx, analysis: res }, "https://x", "T");
    console.log("=".repeat(100));
    console.log(`KEY ${fx.messageKey}`);
    console.log(`COMMENTS: ${fx.comments.join(" || ")}`);
    console.log(`SUBJECT: ${fx.subject}`);
    console.log(`ATTACH: ${(fx.attachmentFiles || []).map((a) => a.filename).join(", ") || "-"}`);
    console.log(`positionsSource=${res.lead.positionsSource || "body"} detectedBrands=${(res.lead.detectedBrands || []).join(",")}`);
    console.log(`ORDER (${p.order_from_mail.length}):`);
    for (const [i, it] of p.order_from_mail.entries()) {
        console.log(`  ${i + 1}. art=${JSON.stringify(it.item_number)} qty=${it.quantity} brand=${JSON.stringify(it.brand)} desc=${JSON.stringify((it.desc || "").slice(0, 90))}`);
    }
    console.log(`BODY (first 2200):`);
    console.log(fx.body.slice(0, 2200));
}
