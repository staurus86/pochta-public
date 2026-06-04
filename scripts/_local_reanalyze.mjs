// Local full-corpus reanalysis with the NEW pipeline code.
// Loads a prod message dump, re-runs analyzeEmail on every message, and reports
// OLD (stored analysis) vs NEW aggregate metrics + regression flags.
//
// Attachment bytes are NOT on disk locally for most messages, so attachment-derived
// positions cannot reproduce. We therefore report two cohorts:
//   - NO-ATTACHMENT cohort  → faithful before/after
//   - HAS-ATTACHMENT cohort → degraded locally (flagged, not counted as regression)
// Run with PYTHONIOENCODING=utf-8 so the xlsx Python path matches prod.
import fs from "node:fs";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const DUMP = process.argv[2] || "data/prod-messages-2026-04-19-postJ-r4.json";
const project = { id: "project-4-klvrt-mail", name: "project-4-klvrt-mail", brands: [] };

const realArticles = (lead) => (lead?.lineItems || []).filter(
    (i) => i && i.article && !String(i.article).toUpperCase().startsWith("DESC:")
).length;
const hasBrandCoverage = (lead) => (lead?.lineItems || []).some((i) => i && i.brand);
const hasQtyCoverage = (lead) => (lead?.lineItems || []).some((i) => i && i.quantity != null);

function main() {
    const d = JSON.parse(fs.readFileSync(DUMP, "utf8"));
    const msgs = Array.isArray(d) ? d : (d.messages || d.recentMessages || []);
    console.log(`Reanalyzing ${msgs.length} messages from ${DUMP}\n`);

    let crashes = 0;
    const crashKeys = [];
    const noAtt = { n: 0, posOldSum: 0, posNewSum: 0, brandOld: 0, brandNew: 0, qtyOld: 0, qtyNew: 0, posUp: 0, posDown: 0, posSame: 0 };
    const hasAtt = { n: 0 };
    const bigDrops = []; // no-attachment messages where positions fell a lot (regression candidates)

    for (const m of msgs) {
        const attFiles = m.attachmentFiles || m.attachments || [];
        const hasAttachment = Array.isArray(attFiles) && attFiles.length > 0;
        const body = (m.analysis && m.analysis.rawInput && m.analysis.rawInput.body) || m.bodyPreview || "";
        let res;
        try {
            res = analyzeEmail(project, {
                subject: m.subject || "",
                body,
                fromEmail: m.from || m.fromEmail || "",
                fromName: m.fromName || "",
                attachmentFiles: attFiles,
                messageKey: m.messageKey || m.id || "",
                cc: m.cc || [],
                toRecipients: m.toRecipients || [],
            });
        } catch (e) {
            crashes++; if (crashKeys.length < 15) crashKeys.push(`${(m.messageKey || "").slice(0, 10)}: ${e.message}`);
            continue;
        }
        const oldLead = (m.analysis && m.analysis.lead) || {};
        const newLead = res.lead || {};
        const posOld = realArticles(oldLead), posNew = realArticles(newLead);

        if (hasAttachment) { hasAtt.n++; continue; } // degraded locally, skip metrics

        noAtt.n++;
        noAtt.posOldSum += posOld; noAtt.posNewSum += posNew;
        if (hasBrandCoverage(oldLead)) noAtt.brandOld++; if (hasBrandCoverage(newLead)) noAtt.brandNew++;
        if (hasQtyCoverage(oldLead)) noAtt.qtyOld++; if (hasQtyCoverage(newLead)) noAtt.qtyNew++;
        if (posNew > posOld) noAtt.posUp++; else if (posNew < posOld) noAtt.posDown++; else noAtt.posSame++;
        if (posOld - posNew >= 3 && bigDrops.length < 20) bigDrops.push({ k: (m.messageKey || "").slice(0, 10), posOld, posNew, from: String(m.from || "").slice(0, 30) });
    }

    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "—";
    console.log("=== CRASHES ===");
    console.log(`${crashes} / ${msgs.length}`);
    crashKeys.forEach((c) => console.log("  " + c));

    console.log("\n=== NO-ATTACHMENT cohort (faithful before/after) ===");
    console.log(`messages: ${noAtt.n}`);
    console.log(`positions total:   OLD ${noAtt.posOldSum}  →  NEW ${noAtt.posNewSum}`);
    console.log(`brand coverage:    OLD ${pct(noAtt.brandOld, noAtt.n)}  →  NEW ${pct(noAtt.brandNew, noAtt.n)}`);
    console.log(`qty coverage:      OLD ${pct(noAtt.qtyOld, noAtt.n)}  →  NEW ${pct(noAtt.qtyNew, noAtt.n)}`);
    console.log(`positions per msg: OLD ${(noAtt.posOldSum / noAtt.n).toFixed(2)}  →  NEW ${(noAtt.posNewSum / noAtt.n).toFixed(2)}`);
    console.log(`position change:    ↑${noAtt.posUp}  ↓${noAtt.posDown}  =${noAtt.posSame}`);

    console.log("\n=== HAS-ATTACHMENT cohort (degraded locally — attachment bytes absent) ===");
    console.log(`messages: ${hasAtt.n} (excluded from before/after — would need attachment bytes)`);

    console.log("\n=== Position DROPS >=3 (no-attachment regression candidates) ===");
    if (bigDrops.length === 0) console.log("  none");
    bigDrops.forEach((b) => console.log(`  ${b.k}  ${b.posOld}→${b.posNew}  ${b.from}`));
}
main();
