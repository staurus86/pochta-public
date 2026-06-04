// Aggregate position-quality metrics on the reanalyzed prod corpus.
// Samples ready_for_crm messages, fetches full detail, builds order_from_mail, and
// reports position / brand / qty coverage — the dimensions the manager flagged.
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const BASE = "https://pochta-production.up.railway.app";
const PW = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const SAMPLE_P4 = Number(process.argv[2] || 250);

async function api(path, token) {
    const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
    return r.ok ? r.json() : null;
}

const token = (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: PW }) })).json()).token;

// Even-stride sample of ready_for_crm keys from each project.
const targets = [];
for (const [pid, n] of [["project-3-mailbox-file", 9999], ["project-4-klvrt-mail", SAMPLE_P4]]) {
    const list = (await api(`/api/projects/${pid}/messages`, token)).messages || [];
    const ready = list.filter((m) => m.pipelineStatus === "ready_for_crm");
    const stride = Math.max(1, Math.floor(ready.length / n));
    for (let i = 0; i < ready.length; i += stride) targets.push([pid, ready[i].messageKey || ready[i].id]);
}
console.log(`Sampling ${targets.length} ready_for_crm messages...`);

const agg = { msgs: 0, withPos: 0, posTotal: 0, posWithBrand: 0, posWithQty: 0, msgAllBrand: 0, msgAllQty: 0 };
let done = 0;
for (const [pid, key] of targets) {
    const d = await api(`/api/projects/${pid}/messages/${encodeURIComponent(key)}`, token);
    const m = d && (d.message || d);
    if (!m) continue;
    const o = (buildSiderusCrmPayload({ id: pid, name: pid }, m, BASE, "T").order_from_mail) || [];
    agg.msgs++;
    if (o.length) agg.withPos++;
    agg.posTotal += o.length;
    const b = o.filter((x) => x.brand).length, q = o.filter((x) => x.quantity != null).length;
    agg.posWithBrand += b; agg.posWithQty += q;
    if (o.length && b === o.length) agg.msgAllBrand++;
    if (o.length && q === o.length) agg.msgAllQty++;
    if (++done % 50 === 0) process.stderr.write(`  ${done}/${targets.length}\n`);
}

const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "—";
console.log("\n=== POSITION-QUALITY (reanalyzed prod, ready_for_crm sample) ===");
console.log(`messages sampled:        ${agg.msgs}`);
console.log(`with >=1 position:       ${pct(agg.withPos, agg.msgs)} (${agg.withPos})`);
console.log(`positions total:         ${agg.posTotal}  (avg ${(agg.posTotal / agg.msgs).toFixed(2)}/msg)`);
console.log(`positions with brand:    ${pct(agg.posWithBrand, agg.posTotal)}  (${agg.posWithBrand})`);
console.log(`positions with qty:      ${pct(agg.posWithQty, agg.posTotal)}  (${agg.posWithQty})`);
console.log(`msgs where ALL pos have brand: ${pct(agg.msgAllBrand, agg.withPos)}`);
console.log(`msgs where ALL pos have qty:   ${pct(agg.msgAllQty, agg.withPos)}`);
