// Poll n8n feedback GET endpoint until queue is empty.
// Each record is appended to data/.n8n_feedback_2026-06-11.json immediately.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import fs from "node:fs";

const N8N_FEEDBACK = "https://test-n8n.siderus.online/webhook/b0bc08e6-178b-4b7b-a989-b07acd19f90b";
const N8N_AUTH = "Oo`8Vh6W<7Olkx4@N'M";
const OUT = "data/.n8n_feedback_2026-06-11.json";

const records = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const seen = new Set(records.map(r => JSON.stringify([r.message_key, r.comments, r.verification])));

let emptyStreak = 0, dupStreak = 0;
for (let i = 0; i < 300; i++) {
    let res;
    try {
        res = await fetch(N8N_FEEDBACK, {
            headers: { Authorization: N8N_AUTH },
            signal: AbortSignal.timeout(20_000),
        });
    } catch (e) {
        console.log(`#${i} ERR ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
    }
    const text = await res.text();
    if (!res.ok) { console.log(`#${i} HTTP ${res.status}: ${text.slice(0, 120)}`); break; }
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const items = Array.isArray(data) ? data : data ? [data] : [];
    const meaningful = items.filter(r => r && (r.message_key || r.comments));
    if (!meaningful.length) {
        emptyStreak++;
        console.log(`#${i} empty (${text.slice(0, 80) || "no body"})`);
        if (emptyStreak >= 3) break;
        await new Promise(r => setTimeout(r, 1000));
        continue;
    }
    emptyStreak = 0;
    let newCount = 0;
    for (const r of meaningful) {
        const k = JSON.stringify([r.message_key, r.comments, r.verification]);
        if (seen.has(k)) continue;
        seen.add(k);
        records.push(r);
        newCount++;
    }
    fs.writeFileSync(OUT, JSON.stringify(records, null, 2));
    console.log(`#${i} +${newCount} new (total ${records.length}) — ${meaningful.map(r => (r.message_key || "?").slice(0, 8)).join(",")}`);
    if (newCount === 0) { dupStreak++; if (dupStreak >= 5) break; } else dupStreak = 0;
    await new Promise(r => setTimeout(r, 400));
}
console.log(`DONE: ${records.length} records in ${OUT}`);
