// Detailed diagnosis of the 10 unsent ready_for_crm messages flagged no_company_and_inn.
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const BASE = "https://pochta-production.up.railway.app";
const PW = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const KEYS = ["78b33363", "37924d44", "0bc5d396", "d5c4c81a", "fe3b4f0b", "a228e112", "f487ebba", "1fb2845f", "dffa54eb", "6a5eac7f"];

async function api(path, token) {
    for (let i = 0; i < 4; i++) {
        try { const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) }); return r.ok ? await r.json() : null; }
        catch { await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
    }
    return null;
}

const token = (await (await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: PW }) })).json()).token;

// resolve full keys from the project-4 list
const list = (await api(`/api/projects/project-4-klvrt-mail/messages`, token)).messages || [];
const byPrefix = {};
for (const m of list) { const k = m.messageKey || m.id || ""; for (const p of KEYS) if (k.startsWith(p)) byPrefix[p] = k; }

for (const p of KEYS) {
    const full = byPrefix[p];
    if (!full) { console.log(`\n### ${p}: not found in list`); continue; }
    const d = await api(`/api/projects/project-4-klvrt-mail/messages/${encodeURIComponent(full)}`, token);
    const m = d && (d.message || d);
    if (!m) { console.log(`\n### ${p}: detail fetch failed`); continue; }
    const s = (m.analysis && m.analysis.sender) || {};
    const body = (m.analysis && m.analysis.rawInput && m.analysis.rawInput.body) || m.body || m.bodyPreview || "";
    const atts = (m.attachmentFiles || []).map((a) => a.filename);
    const aa = (m.analysis && m.analysis.attachmentAnalysis && m.analysis.attachmentAnalysis.files) || [];
    const reqFiles = aa.filter((f) => f.category === "requisites" || /реквизит|карточк/i.test(f.filename || ""));
    console.log(`\n### ${p}  from: ${String(m.from || "").slice(0, 55)}`);
    console.log(`  subject: ${JSON.stringify((m.subject || "").slice(0, 70))}`);
    console.log(`  sender → company:${JSON.stringify(s.companyName)} inn:${JSON.stringify(s.inn)} fio:${JSON.stringify(s.fullName)} phone:${JSON.stringify(s.mobilePhone || s.cityPhone)}`);
    console.log(`  sender.sources: ${JSON.stringify(s.sources || {})}`);
    console.log(`  attachments: ${atts.join(", ") || "none"}`);
    if (reqFiles.length) console.log(`  REQUISITES files: ${reqFiles.map((f) => `${f.filename}[${f.status} inn=${(f.detectedInn || []).length}]`).join(", ")}`);
    // tail of body = signature/requisites zone
    console.log(`  body tail: ${JSON.stringify(body.slice(-280).replace(/\s+/g, " "))}`);
}
