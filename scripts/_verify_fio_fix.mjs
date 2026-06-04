// Verify the FIO system-phrase fix on the real affected messages: fetch their input
// from prod, re-run analyzeEmail LOCALLY with the new code, compare fio before/after.
import { analyzeEmail } from "../src/services/email-analyzer.js";

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
const list = (await api(`/api/projects/project-4-klvrt-mail/messages`, token)).messages || [];
const byPrefix = {};
for (const m of list) { const k = m.messageKey || m.id || ""; for (const p of KEYS) if (k.startsWith(p)) byPrefix[p] = k; }

const proj = { id: "project-4-klvrt-mail", name: "p4", brands: [] };
for (const p of KEYS) {
    const full = byPrefix[p];
    if (!full) { console.log(`${p}: not found`); continue; }
    const d = await api(`/api/projects/project-4-klvrt-mail/messages/${encodeURIComponent(full)}`, token);
    const m = d && (d.message || d);
    if (!m) { console.log(`${p}: fetch fail`); continue; }
    const oldFio = m.analysis?.sender?.fullName ?? null;
    const body = (m.analysis && m.analysis.rawInput && m.analysis.rawInput.body) || m.body || m.bodyPreview || "";
    const res = analyzeEmail(proj, { subject: m.subject || "", body, fromEmail: m.from || "", fromName: m.fromName || "", attachmentFiles: m.attachmentFiles || [], messageKey: full });
    const newFio = res.sender?.fullName ?? null;
    const changed = String(oldFio) !== String(newFio);
    console.log(`${p}  from=${String(m.from || "").slice(0, 30).padEnd(30)}  OLD fio=${JSON.stringify(oldFio).padEnd(22)} → NEW fio=${JSON.stringify(newFio)}  ${changed ? "✱" : ""}`);
}
