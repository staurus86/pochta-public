/**
 * Select top-10 best-quality ready_for_crm messages, verify manually, send to n8n.
 * Steps:
 *   1. Fetch ALL messages via /messages (slim)
 *   2. Score ready_for_crm candidates
 *   3. Fetch top-30 individually (full data with lineItems)
 *   4. Re-score on full data, pick top-10
 *   5. Print detailed preview of each
 *   6. Send to n8n (unless --dry-run)
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const PROD_URL       = "https://pochta-production.up.railway.app";
const N8N_URL        = "https://test-n8n.siderus.online/webhook/pochta_service";
const N8N_AUTH       = "Oo`8Vh6W<7Olkx4@N'M";
const ADMIN_PASSWORD = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const DRY_RUN        = process.argv.includes("--dry-run");
const PROJECTS       = ["project-3-mailbox-file", "project-4-klvrt-mail"];
const TOP_N          = 10;
const FETCH_CANDIDATES = 55; // fetch more to allow filtering

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, token) {
    const r = await fetch(PROD_URL + path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
}

async function login() {
    const r = await fetch(PROD_URL + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: "admin", password: ADMIN_PASSWORD }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error("Login failed");
    return (await r.json()).token;
}

// ─── scoring (slim) ──────────────────────────────────────────────────────────
function scoreSlim(msg) {
    const a  = msg.analysis || {};
    const s  = a.sender || {};
    const l  = a.lead   || {};
    const cl = a.classification || {};
    let score = 0;
    if (s.inn)         score += 5;
    if (s.companyName) score += 4;
    if (s.fullName && !/^Не Определено$/i.test(s.fullName)) score += 3;
    if (s.mobilePhone || s.cityPhone) score += 2;
    if (s.position)    score += 1;
    const arts = (l.articles || []).length;
    if (arts > 0)      score += 3;
    score += Math.min(arts, 10) * 0.4;
    if ((l.detectedBrands || []).length > 0) score += 2;
    score += Number(cl.confidence || l.confidence || 0);
    // Penalize suspicious FIO
    if (/\b(компания|сервис|tech|group|market|store)\b/i.test(s.fullName || "")) score -= 2;
    return score;
}

// ─── scoring (full — uses lineItems) ─────────────────────────────────────────
function scoreFull(msg) {
    const a  = msg.analysis || {};
    const s  = a.sender || {};
    const l  = a.lead   || {};
    const cl = a.classification || {};
    let score = 0;
    if (s.inn)         score += 5;
    if (s.companyName) score += 4;
    if (s.fullName && !/^Не Определено$/i.test(s.fullName)) score += 3;
    if (s.mobilePhone || s.cityPhone) score += 2;
    if (s.position)    score += 1;
    const lineItems = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:"));
    const arts      = lineItems.length || (l.articles || []).length;
    if (arts > 0)      score += 4;
    score += Math.min(arts, 10) * 0.5;
    if ((l.detectedBrands || []).length > 0) score += 2;
    // bonus: brand on articles
    if (lineItems.some(i => i.brand)) score += 2;
    score += Number(cl.confidence || l.confidence || 0);
    if (/^Не Определено$/i.test(s.fullName || "")) score -= 3;
    if (/\b(компания|сервис|tech|group|market|store)\b/i.test(s.fullName || "")) score -= 2;
    return score;
}

function fioOk(msg)  { const n = msg.analysis?.sender?.fullName; return n && !/^Не Определено$/i.test(n); }
function compOk(msg) { return !!(msg.analysis?.sender?.companyName); }
function artCount(msg) {
    const l = msg.analysis?.lead || {};
    const li = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:"));
    return li.length || (l.articles || []).length;
}

// ─── preview printer ─────────────────────────────────────────────────────────
function printMsg(n, msg, pid, payload) {
    const a = msg.analysis || {};
    const s = a.sender || {};
    const l = a.lead   || {};
    const cl = a.classification || {};
    const lineItems = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:"));
    const arts = lineItems.length ? lineItems : (l.articles || []).map(c => ({ article: c }));
    const brands = (l.detectedBrands || []).map(b => (typeof b === "string" ? b : b.name || b.brand || "?"));

    console.log(`\n${"─".repeat(70)}`);
    console.log(`#${n} | ${msg.subject || "(no subject)"}`);
    console.log(`   От:          ${msg.from || "?"}`);
    console.log(`   Ящик:        ${msg.mailbox || "?"} [${pid}]`);
    console.log(`   Статус:      ${msg.pipelineStatus} | label=${cl.label || "?"} conf=${(Number(cl.confidence||0)).toFixed(2)}`);
    console.log(`   ФИО:         ${s.fullName || "—"} (source: ${s.fullNameSource || "?"})`);
    console.log(`   Компания:    ${s.companyName || "—"} (source: ${s.companyNameSource || "?"})`);
    console.log(`   ИНН:         ${s.inn || "—"}`);
    console.log(`   Телефон:     ${s.mobilePhone || s.cityPhone || "—"} (source: ${s.phoneSource || "?"})`);
    console.log(`   Должность:   ${s.position || "—"} (source: ${s.positionSource || "?"})`);
    console.log(`   Бренды(${brands.length}):   ${brands.slice(0,6).join(", ") || "—"}`);
    console.log(`   Артикулы(${arts.length}):`);
    for (const it of arts.slice(0, 8)) {
        const brand = it.brand || "—";
        const desc  = it.descriptionRu || it.description || it.desc || "";
        const qty   = it.quantity != null ? ` x${it.quantity}` : "";
        console.log(`     • ${it.article || it.code || it}${qty}  [${brand}]  ${desc.slice(0,50)}`);
    }
    if (arts.length > 8) console.log(`     ... и ещё ${arts.length - 8}`);

    // n8n payload preview
    console.log(`   → n8n payload:`);
    console.log(`       company_name: ${payload.company_name || "—"}`);
    console.log(`       inn:          ${payload.inn || "—"}`);
    console.log(`       client_name:  ${payload.client_name || "—"}`);
    console.log(`       phone_number: ${payload.phone_number || "—"}`);
    console.log(`       order_items:  ${payload.order_from_mail.length}`);
    for (const it of (payload.order_from_mail || []).slice(0, 5)) {
        console.log(`         • ${it.item_number || "?"}  [${it.brand || "—"}]  qty=${it.quantity ?? "—"}`);
    }

    // Flag problems
    const warns = [];
    if (!fioOk(msg))  warns.push("⚠ ФИО не определено");
    if (!compOk(msg)) warns.push("⚠ нет компании");
    if (artCount(msg) === 0) warns.push("⚠ нет артикулов");
    if (!payload.company_name && !payload.inn) warns.push("⚠ нет компании И ИНН в payload");
    if (warns.length) {
        console.log(`   ПРЕДУПРЕЖДЕНИЯ: ${warns.join(" | ")}`);
    } else {
        console.log(`   ✅ Все ключевые поля заполнены`);
    }
    return warns.length;
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log("Auth...");
    const token = await login();

    // 1. Collect all ready_for_crm via /messages endpoint
    const allCandidates = [];
    for (const pid of PROJECTS) {
        console.log(`Loading ${pid}...`);
        const d = await apiFetch(`/api/projects/${pid}/messages`, token);
        const msgs = (d.messages || []).filter(m => m.pipelineStatus === "ready_for_crm");
        console.log(`  ${msgs.length} ready_for_crm`);
        for (const m of msgs) allCandidates.push({ msg: m, pid });
    }
    console.log(`Total candidates: ${allCandidates.length}`);

    // 2. Sort by slim score, take top FETCH_CANDIDATES
    allCandidates.sort((a, b) => scoreSlim(b.msg) - scoreSlim(a.msg));
    const top30 = allCandidates.slice(0, FETCH_CANDIDATES);

    // 3. Fetch full data for each
    console.log(`\nFetching full data for top ${top30.length} candidates...`);
    const full = [];
    for (let i = 0; i < top30.length; i++) {
        const { msg, pid } = top30[i];
        const mid = msg.messageKey || msg.id || "";
        try {
            const d = await apiFetch(`/api/projects/${pid}/messages/${encodeURIComponent(mid)}`, token);
            full.push({ msg: d.message || msg, pid });
        } catch {
            full.push({ msg, pid });
        }
        if ((i+1) % 10 === 0) process.stdout.write(`  ${i+1}/${top30.length}\n`);
    }

    // 4. Fetch project configs (needed for buildSiderusCrmPayload)
    const projects = {};
    for (const pid of PROJECTS) {
        const d = await apiFetch(`/api/projects/${pid}`, token);
        projects[pid] = d.project || d;
    }

    // 5. Re-score on full data, sort, take TOP_N
    full.sort((a, b) => scoreFull(b.msg) - scoreFull(a.msg));

    // Build payloads and filter out those with no useful data or quality issues
    const selected = [];
    const rejected = [];
    for (const { msg, pid } of full) {
        if (selected.length >= TOP_N) break;
        const project = projects[pid];
        const payload = buildSiderusCrmPayload(project, msg, PROD_URL, token);
        const sender = msg.analysis?.sender || {};

        // Hard disqualifiers
        const rejReasons = [];

        // client_name looks like a phone number or junk (not a real name)
        const clientName = payload.client_name || "";
        if (/^Не Определено$/i.test(clientName)) rejReasons.push("ФИО=Не Определено");
        if (/телефон|phone|тел[.\s]/i.test(clientName)) rejReasons.push(`ФИО содержит 'телефон': ${clientName.slice(0,50)}`);
        if (/\d{4,}/.test(clientName) && !/[а-яёa-z]/i.test(clientName)) rejReasons.push(`ФИО выглядит как номер: ${clientName.slice(0,50)}`);

        // company_name too long (> 80 chars) likely grabbed requisites card text
        const compName = payload.company_name || "";
        if (compName.length > 80) rejReasons.push(`company_name слишком длинная (${compName.length} ch): ${compName.slice(0,60)}...`);
        if (/наименование|учредит|устав|реквизит/i.test(compName)) rejReasons.push("company_name содержит текст карточки реквизитов");

        // company_name is truncated garbage (e.g. "ответственностью Предприятие")
        if (/^ответственностью\b/i.test(compName)) rejReasons.push(`company_name = обрезанное ООО: ${compName}`);

        // order_items < 2 after noise filtering — nearly empty payload
        if (payload.order_from_mail.length < 2) rejReasons.push(`order_items слишком мало (${payload.order_from_mail.length})`);

        // Must have at least company or inn
        if (!payload.company_name && !payload.inn) rejReasons.push("нет company_name и INN");

        if (rejReasons.length > 0) {
            rejected.push({ msg, pid, reasons: rejReasons });
            continue;
        }
        selected.push({ msg, pid, project, payload });
    }

    if (rejected.length > 0) {
        console.log(`\nRejected ${rejected.length} candidates:`);
        for (const r of rejected) {
            console.log(`  ✗ ${(r.msg.subject||"").slice(0,50)} → ${r.reasons.join(" | ")}`);
        }
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`SELECTED ${selected.length} LETTERS FOR n8n — MANUAL REVIEW`);
    console.log(`${"=".repeat(70)}`);

    let totalWarns = 0;
    for (let i = 0; i < selected.length; i++) {
        const { msg, pid, payload } = selected[i];
        const warns = printMsg(i + 1, msg, pid, payload);
        totalWarns += warns;
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`Summary: ${selected.length} letters, total warnings: ${totalWarns}`);
    console.log(`${DRY_RUN ? "[DRY RUN — not sending]" : "Sending to n8n..."}`);
    console.log(`${"=".repeat(70)}\n`);

    if (DRY_RUN || selected.length === 0) return;

    // 6. Send
    let sent = 0, failed = 0;
    for (const { msg, pid, payload } of selected) {
        const key = (msg.messageKey || msg.id || "?").slice(0, 16);
        try {
            const r = await fetch(N8N_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: N8N_AUTH },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15_000),
            });
            if (!r.ok) {
                const t = await r.text().catch(() => "");
                throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`);
            }
            sent++;
            console.log(`  ✓ [${sent}/${selected.length}] ${key}... → ${payload.company_name || payload.inn}`);
            await new Promise(r => setTimeout(r, 400));
        } catch (err) {
            failed++;
            console.log(`  ✗ ${key}: ${err.message}`);
        }
    }

    console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
