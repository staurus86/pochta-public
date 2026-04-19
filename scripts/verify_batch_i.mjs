import { readFileSync, writeFileSync } from "node:fs";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";
void detectionKb;

const rows = JSON.parse(readFileSync("data/_baseline_client_rows.json", "utf-8"));
console.log(`Loaded ${rows.length} client rows`);
const project = { mailbox: "inbox@example.com", brands: [], managerPool: { defaultMop: "x", defaultMoz: "y", brandOwners: [] }, knownCompanies: [] };
const results = [];
const t0 = Date.now();
for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowProject = { ...project, mailbox: r.mailbox || project.mailbox };
    try {
        const analysis = analyzeEmail(rowProject, { fromEmail: r.from, fromName: "", subject: r.subject, body: r.body, attachments: "" });
        results.push({ n: r.n, brandsNew: (analysis.detectedBrands || []).join("; "), articlesNew: (analysis.lead?.articles || []).join("; "), labelNew: analysis.classification?.label || "" });
    } catch (e) { results.push({ n: r.n, brandsNew: "", articlesNew: "", labelNew: "ERROR", error: String(e?.message || e).slice(0,200) }); }
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${rows.length}  elapsed ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
writeFileSync("data/verify_i.json", JSON.stringify(results, null, 0), "utf-8");
console.log(`Wrote data/verify_i.json (${results.length} rows) in ${((Date.now()-t0)/1000).toFixed(1)}s`);
