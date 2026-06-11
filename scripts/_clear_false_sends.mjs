// Roll back the accidental bulk send: clear the siderus-crm export record on every
// message that has NO manager feedback (n8n GET table). Manager rule: "sent" = has
// feedback; the rest were deleted unreviewed on the n8n side.
// Usage: node scripts/_clear_false_sends.mjs [--apply]   (default: dry-run counts)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import fs from "node:fs";

const BASE = "https://pochta-production.up.railway.app";
const PW = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"];
const APPLY = process.argv.includes("--apply");

const feedback = JSON.parse(fs.readFileSync("data/.n8n_feedback_2026-06-11.json", "utf8"));
const feedbackKeys = new Set(feedback.map((r) => r.message_key).filter(Boolean));
console.log(`Фидбек-ключей (считаются отправленными): ${feedbackKeys.size}`);

const r = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "admin", password: PW }),
});
const token = (await r.json()).token;

for (const pid of PROJECTS) {
    const d = await fetch(`${BASE}/api/projects/${pid}/messages`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000),
    });
    const msgs = (await d.json()).messages || [];
    const sent = msgs.filter((m) => m.integrationExports && m.integrationExports["siderus-crm"]);
    const withFeedback = sent.filter((m) => feedbackKeys.has(m.messageKey || m.id));
    const toClear = sent.filter((m) => !feedbackKeys.has(m.messageKey || m.id)).map((m) => m.messageKey || m.id);
    console.log(`[${pid}] всего=${msgs.length} sent=${sent.length} с фидбеком=${withFeedback.length} к очистке=${toClear.length}`);
    if (!APPLY || !toClear.length) continue;
    const resp = await fetch(`${BASE}/api/projects/${pid}/crm-export-clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ keys: toClear, consumer: "siderus-crm", note: "rollback false bulk send 2026-05-18" }),
        signal: AbortSignal.timeout(300000),
    });
    console.log(`[${pid}] clear → HTTP ${resp.status}:`, await resp.text());
}
console.log(APPLY ? "DONE" : "[DRY-RUN] добавьте --apply для очистки");
