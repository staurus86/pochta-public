// Analyze ready_for_crm messages NOT yet sent to n8n, with the improved (deployed) detect.
// Builds the payload that WOULD be sent, self-checks quality. DOES NOT send anything.
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const BASE = "https://pochta-production.up.railway.app";
const PW = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const LIMIT = Number(process.argv[2] || 100);

async function api(path, token) {
    for (let i = 0; i < 4; i++) {
        try {
            const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            if (i === 3) return null;
            await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
        }
    }
    return null;
}

const token = (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: PW }) })).json()).token;

const targets = [];
for (const pid of ["project-3-mailbox-file", "project-4-klvrt-mail"]) {
    const msgs = (await api(`/api/projects/${pid}/messages`, token)).messages || [];
    const unsent = msgs.filter((m) => m.pipelineStatus === "ready_for_crm" && !(m.integrationExports || {})["siderus-crm"]);
    for (const m of unsent) targets.push([pid, m.messageKey || m.id]);
}
const pick = targets.slice(0, LIMIT);
console.log(`Analyzing ${pick.length} unsent ready_for_crm messages (improved detect, NOT sending)...\n`);

const A = { n: 0, withPos: 0, posTotal: 0, posBrand: 0, posQty: 0, withInn: 0, withCompany: 0, withFio: 0, allBrand: 0, allQty: 0 };
const defects = { empty_positions: 0, qty_outlier: 0, desc_broadcast: 0, no_company_and_inn: 0 };
const cleanMsgs = [];
const flagged = [];

for (const [pid, key] of pick) {
    const d = await api(`/api/projects/${pid}/messages/${encodeURIComponent(key)}`, token);
    const m = d && (d.message || d);
    if (!m) continue;
    const p = buildSiderusCrmPayload({ id: pid, name: pid }, m, BASE, "T");
    const o = p.order_from_mail || [];
    A.n++;
    if (o.length) A.withPos++;
    A.posTotal += o.length;
    const b = o.filter((x) => x.brand).length, q = o.filter((x) => x.quantity != null).length;
    A.posBrand += b; A.posQty += q;
    if (o.length && b === o.length) A.allBrand++;
    if (o.length && q === o.length) A.allQty++;
    if (p.inn) A.withInn++;
    if (p.company_name) A.withCompany++;
    if (p.client_name) A.withFio++;

    // self-check defects
    const def = [];
    const hasStructuredAtt = (m.attachmentFiles || []).some((a) => /\.(xlsx|csv|tsv)$/i.test(a.filename || ""));
    if (o.length === 0 && hasStructuredAtt) def.push("empty_positions");
    if (o.some((x) => x.quantity != null && x.quantity > 10000)) def.push("qty_outlier");
    const descCounts = {};
    for (const x of o) if (x.desc) descCounts[x.desc] = (descCounts[x.desc] || 0) + 1;
    if (Math.max(0, ...Object.values(descCounts)) >= 3) def.push("desc_broadcast");
    if (!p.company_name && !p.inn) def.push("no_company_and_inn");
    for (const dd of def) defects[dd] = (defects[dd] || 0) + 1;

    const rec = { key: key.slice(0, 8), pid: pid.includes("4") ? "p4" : "p3", pos: o.length, b, q, inn: !!p.inn, co: !!p.company_name, def };
    if (def.length === 0) cleanMsgs.push(rec); else flagged.push(rec);
}

const pct = (a, c) => c ? `${(100 * a / c).toFixed(1)}%` : "—";
console.log("=== AGGREGATE (improved detect, " + A.n + " unsent messages) ===");
console.log(`with >=1 position:        ${pct(A.withPos, A.n)} (${A.withPos})`);
console.log(`positions total:          ${A.posTotal} (avg ${(A.posTotal / A.n).toFixed(2)}/msg)`);
console.log(`positions with brand:     ${pct(A.posBrand, A.posTotal)}`);
console.log(`positions with qty:       ${pct(A.posQty, A.posTotal)}`);
console.log(`msgs ALL pos have brand:  ${pct(A.allBrand, A.withPos)}`);
console.log(`msgs ALL pos have qty:    ${pct(A.allQty, A.withPos)}`);
console.log(`company_name present:     ${pct(A.withCompany, A.n)}`);
console.log(`INN present:              ${pct(A.withInn, A.n)}`);
console.log(`client_name (ФИО) present:${pct(A.withFio, A.n)}`);
console.log(`\n=== SELF-CHECK DEFECTS ===`);
for (const [k, v] of Object.entries(defects)) console.log(`  ${k}: ${v}`);
console.log(`\nCLEAN (no defect flags): ${cleanMsgs.length}/${A.n} = ${pct(cleanMsgs.length, A.n)}`);
console.log(`FLAGGED: ${flagged.length}`);
console.log(`\n--- flagged detail ---`);
for (const r of flagged) console.log(`  ${r.pid} ${r.key} pos=${r.pos} brand=${r.b} qty=${r.q} inn=${r.inn ? "Y" : "-"} co=${r.co ? "Y" : "-"}  [${r.def.join(",")}]`);
