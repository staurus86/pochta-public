/**
 * Select the NEXT top-10 best-quality ready_for_crm messages (excluding the 10
 * already sent to n8n on 2026-05-20), verify data + attachment links, send to n8n.
 *
 * Excludes yesterday's batch by INN (memory table) AND by reproduced top-10
 * messageKeys (robust against re-analysis score drift).
 *
 * Attachment download_url uses the static ATTACHMENT_API_TOKEN (never expires),
 * so managers can open files at any time.
 *
 * Usage:
 *   node scripts/_select_and_send_next_10.mjs            # dry-run (default, no send)
 *   node scripts/_select_and_send_next_10.mjs --send     # actually POST 10 to n8n
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const PROD_URL       = "https://pochta-production.up.railway.app";
const N8N_URL        = "https://test-n8n.siderus.online/webhook/pochta_service";
const N8N_AUTH       = "Oo`8Vh6W<7Olkx4@N'M";
const ADMIN_PASSWORD = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
// Static attachment token (Railway ATTACHMENT_API_TOKEN) — never expires.
const ATTACHMENT_TOKEN = "fd3d37534b3f64147b70e0e7bf6a622852fa720eeafb36410190f95cbb0dd7bf";
const SEND           = process.argv.includes("--send");
const PROJECTS       = ["project-3-mailbox-file", "project-4-klvrt-mail"];
const TOP_N          = 10;
const FETCH_CANDIDATES = 170; // fetch extra: yesterday's 10 + quality/contamination rejects + today's 10

// The 10 letters sent to n8n on 2026-05-20 (РМКСИБ — 2 letters, one INN).
// Authoritative list from memory; exclusion is by INN (stable, filter-independent).
const YESTERDAY_BATCH = [
    { inn: "7714905135", name: "ООО «1П Технолоджиз»" },
    { inn: "3808118560", name: "ООО «ЭН+ ТОРГОВЫЙ ДОМ»" },
    { inn: "3908018946", name: "АО «КМТП»" },
    { inn: "6608001915", name: "МУП Екатеринбурга" },
    { inn: "7720518494", name: "ПАО «МОЭК»" },
    { inn: "3811475473", name: "ООО «РМКСИБ» (2 письма)" },
    { inn: "6454105277", name: "ООО «Реновация»" },
    { inn: "9729090560", name: "ООО «Техсервис-МП»" },
    { inn: "7816141030", name: "ООО «СКС»" },
];
// Письма с недоступными вложениями (HTTP 404 на проде) — менеджер не откроет файл.
// Исключаем по ИНН, чтобы скрипт добрал следующего качественного кандидата.
const BROKEN_ATTACHMENT_INN = [
    "7715719854", // АО «НИКИМТ-Атомстрой» — «Лист записи ЕГРЮЛ АО НИКИМТ.pdf» → 404
];
const EXCLUDE_INN = new Set([
    ...YESTERDAY_BATCH.map((x) => x.inn),
    ...BROKEN_ATTACHMENT_INN,
]);

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

// ─── scoring ─────────────────────────────────────────────────────────────────
function scoreSlim(msg) {
    const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {}, cl = a.classification || {};
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
    if (/\b(компания|сервис|tech|group|market|store)\b/i.test(s.fullName || "")) score -= 2;
    return score;
}

function scoreFull(msg) {
    const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {}, cl = a.classification || {};
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

// Quality filters — returns array of rejection reasons (empty = passes).
// `contaminatedNames` — Set of lowercased ФИО that appear across >=2 different INNs
// in the pool (template/signature contamination — not a real client name).
function qualityReasons(payload, contaminatedNames) {
    const reasons = [];
    const clientName = payload.client_name || "";
    if (/^Не Определено$/i.test(clientName)) reasons.push("ФИО=Не Определено");
    if (/телефон|phone|тел[.\s]/i.test(clientName)) reasons.push(`ФИО содержит 'телефон': ${clientName.slice(0,50)}`);
    if (/\d{4,}/.test(clientName)) reasons.push(`ФИО содержит цифровой код/телефон: ${clientName.slice(0,50)}`);
    if (/[*:;]/.test(clientName)) reasons.push(`ФИО содержит мусорный символ: ${clientName.slice(0,50)}`);
    // NB: \b не работает с кириллицей в JS-regex — используем подстроки.
    if (/(подпись|компания|уважением|от кого|кому)/i.test(clientName)) reasons.push(`ФИО содержит служебное слово: ${clientName.slice(0,50)}`);
    if (/(regards|sincerely|wishes)/i.test(clientName)) reasons.push(`ФИО = sign-off из подписи: ${clientName.slice(0,50)}`);
    if (clientName.trim() && !/^[А-Яа-яЁёA-Za-z]/.test(clientName.trim())) reasons.push(`ФИО начинается не с буквы: ${clientName.slice(0,50)}`);
    if (/(время|msk|utc)/i.test(clientName)) reasons.push(`ФИО = техническая строка (время/таймзона): ${clientName.slice(0,50)}`);
    if (contaminatedNames && contaminatedNames.has(clientName.trim().toLowerCase())) {
        reasons.push(`ФИО встречается у нескольких компаний (контаминация шаблона): ${clientName.slice(0,50)}`);
    }

    const compName = payload.company_name || "";
    if (compName.length > 80) reasons.push(`company_name слишком длинная (${compName.length} ch)`);
    if (/наименование|учредит|устав|реквизит/i.test(compName)) reasons.push("company_name = текст карточки реквизитов");
    if (/^ответственностью\b/i.test(compName)) reasons.push(`company_name = обрезанное ООО: ${compName}`);
    if (/[*]/.test(compName)) reasons.push(`company_name содержит '*': ${compName.slice(0,50)}`);
    if (/юридическ/i.test(compName)) reasons.push(`company_name содержит обрывок 'юридический': ${compName.slice(0,50)}`);
    if (compName.trim() && !/^[А-ЯЁA-Z«"„]/.test(compName.trim())) reasons.push(`company_name не похоже на название компании: ${compName.slice(0,50)}`);
    if (/\d+\s*шт\b|штук/i.test(compName)) reasons.push(`company_name содержит количество (шт): ${compName.slice(0,50)}`);
    if (/(^|\s)ФИО(\s|$)/.test(compName)) reasons.push(`company_name содержит обрывок 'ФИО': ${compName.slice(0,50)}`);

    const position = payload.position || "";
    if (/[*]|уважением/i.test(position)) reasons.push(`position = мусор из подписи: ${position.slice(0,40)}`);

    if (/spam|\[probable/i.test(payload.subject_email || "")) reasons.push("тема помечена как spam");

    const items = payload.order_from_mail || [];
    if (items.length < 2) reasons.push(`order_items слишком мало (${items.length})`);
    const noisy = items.filter((it) => {
        const n = String(it.item_number || "");
        const d = String(it.desc || "");
        return /^\d{4}-\d{2}-\d{2}/.test(n)        // дата как артикул
            || /\d+[-T]\d+T\d/.test(n)             // фрагмент timestamp
            || /whatsapp|tidbit/i.test(n)          // мусорные токены
            || /utf-?8/i.test(n)                   // артефакт шрифта/кодировки из PDF
            || /emailstyle|mso-/i.test(n)          // CSS-классы из HTML-письма
            || /^\d+$/.test(n)                     // чистое число — внутр. номер позиции, не артикул
            || /^(PN|DN)\s*\d/i.test(n)            // типоразмер PN/DN, не артикул
            || /^(S\d{3}|R?St\d{2})/i.test(n)      // марка стали, не артикул
            || /iccprofile|photoshop/i.test(d);    // метаданные изображения
    }).length;
    if (items.length > 0 && noisy / items.length > 0.25) {
        reasons.push(`order_items >25% шум (${noisy}/${items.length})`);
    }

    if (!payload.company_name && !payload.inn) reasons.push("нет company_name и INN");
    return reasons;
}

// Walk the full-scored list, build payloads, apply quality filters + exclusion.
// Returns up to `limit` selected candidates.
function selectTopN(sorted, projects, limit, opts) {
    const { excludeInn, contaminatedNames } = opts || {};
    const selected = [];
    for (const { msg, pid } of sorted) {
        if (selected.length >= limit) break;
        const payload = buildSiderusCrmPayload(projects[pid], msg, PROD_URL, ATTACHMENT_TOKEN);
        if (qualityReasons(payload, contaminatedNames).length > 0) continue;
        const inn = String(payload.inn || "");
        if (excludeInn && inn && excludeInn.has(inn)) continue;
        selected.push({ msg, pid, payload });
    }
    return selected;
}

// Build set of ФИО that appear across >=2 distinct INNs in the pool — these are
// template/signature contamination (e.g. a SIDERUS-side name in forwarded mail),
// not real client names.
function findContaminatedNames(full) {
    const nameToInns = new Map();
    for (const { msg } of full) {
        const s = msg.analysis?.sender || {};
        const name = String(s.fullName || "").trim().toLowerCase();
        const inn = String(s.inn || "");
        if (!name || !inn) continue;
        if (!nameToInns.has(name)) nameToInns.set(name, new Set());
        nameToInns.get(name).add(inn);
    }
    const bad = new Set();
    for (const [name, inns] of nameToInns) {
        if (inns.size >= 2) bad.add(name);
    }
    return bad;
}

// ─── preview printer ─────────────────────────────────────────────────────────
function printMsg(n, msg, pid, payload) {
    const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {}, cl = a.classification || {};
    const brands = (l.detectedBrands || []).map(b => (typeof b === "string" ? b : b.name || b.brand || "?"));

    console.log(`\n${"─".repeat(72)}`);
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

    console.log(`   → n8n payload:`);
    console.log(`       company_name: ${payload.company_name || "—"}`);
    console.log(`       inn:          ${payload.inn || "—"}`);
    console.log(`       client_name:  ${payload.client_name || "—"}`);
    console.log(`       phone_number: ${payload.phone_number || "—"}`);
    console.log(`       position:     ${payload.position || "—"}`);
    console.log(`       order_items:  ${payload.order_from_mail.length}`);
    for (const it of (payload.order_from_mail || []).slice(0, 6)) {
        console.log(`         • ${it.item_number || "?"}  [${it.brand || "—"}]  qty=${it.quantity ?? "—"}  ${(it.desc||"").slice(0,40)}`);
    }
    if (payload.order_from_mail.length > 6) console.log(`         ... и ещё ${payload.order_from_mail.length - 6}`);
    console.log(`       attachments:  ${payload.attachments.length}`);
    for (const at of payload.attachments) {
        const hasToken = /[?&]token=/.test(at.download_url || "");
        console.log(`         • ${at.filename}  ${hasToken ? "[токен ✓]" : "[НЕТ ТОКЕНА ✗]"}`);
        console.log(`           ${at.download_url}`);
    }

    const warns = [];
    if (!fioOk(msg))  warns.push("⚠ ФИО не определено");
    if (!compOk(msg)) warns.push("⚠ нет компании");
    if (artCount(msg) === 0) warns.push("⚠ нет артикулов");
    for (const at of payload.attachments) {
        if (!/^https:\/\/.+[?&]token=/.test(at.download_url || "")) {
            warns.push(`⚠ вложение без абсолютной ссылки/токена: ${at.filename}`);
        }
    }
    console.log(warns.length ? `   ПРЕДУПРЕЖДЕНИЯ: ${warns.join(" | ")}` : `   ✅ Все ключевые поля заполнены`);
    return warns.length;
}

// HTTP-check that an attachment URL actually opens (200).
async function checkAttachmentUrl(downloadUrl) {
    try {
        const r = await fetch(downloadUrl, { method: "GET", signal: AbortSignal.timeout(30_000) });
        // drain body so the socket frees up
        await r.arrayBuffer().catch(() => {});
        return r.status;
    } catch (err) {
        return `ERR ${err.message}`;
    }
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Режим: ${SEND ? "ОТПРАВКА (--send)" : "DRY-RUN (без отправки)"}`);
    console.log("Auth...");
    const token = await login();

    // 1. Collect all ready_for_crm
    const allCandidates = [];
    for (const pid of PROJECTS) {
        console.log(`Loading ${pid}...`);
        const d = await apiFetch(`/api/projects/${pid}/messages`, token);
        // Only messages NEVER sent to n8n before (no siderus-crm export record) —
        // covers all past batches and the May bulk send, robust to scoring drift.
        const msgs = (d.messages || []).filter(m => m.pipelineStatus === "ready_for_crm"
            && !(m.integrationExports && m.integrationExports["siderus-crm"]));
        console.log(`  ${msgs.length} ready_for_crm не отправлявшихся в n8n`);
        for (const m of msgs) allCandidates.push({ msg: m, pid });
    }
    console.log(`Всего кандидатов: ${allCandidates.length}`);

    // 2. Slim score → take top FETCH_CANDIDATES
    allCandidates.sort((a, b) => scoreSlim(b.msg) - scoreSlim(a.msg));
    const topSlim = allCandidates.slice(0, FETCH_CANDIDATES);

    // 3. Fetch full data
    console.log(`\nЗагружаю полные данные для ${topSlim.length} кандидатов...`);
    const full = [];
    for (let i = 0; i < topSlim.length; i++) {
        const { msg, pid } = topSlim[i];
        const mid = msg.messageKey || msg.id || "";
        try {
            const d = await apiFetch(`/api/projects/${pid}/messages/${encodeURIComponent(mid)}`, token);
            full.push({ msg: d.message || msg, pid });
        } catch {
            full.push({ msg, pid });
        }
        if ((i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${topSlim.length}\n`);
    }

    // 4. Project configs
    const projects = {};
    for (const pid of PROJECTS) {
        const d = await apiFetch(`/api/projects/${pid}`, token);
        projects[pid] = d.project || d;
    }

    // 5. Full re-score
    full.sort((a, b) => scoreFull(b.msg) - scoreFull(a.msg));

    // 6a. Yesterday's batch — authoritative list (from memory), excluded by INN.
    console.log(`\n${"=".repeat(72)}`);
    console.log(`ВЧЕРАШНИЙ BATCH (2026-05-20) — ИСКЛЮЧАЕТСЯ по ИНН`);
    console.log(`${"=".repeat(72)}`);
    YESTERDAY_BATCH.forEach((x, i) => {
        console.log(`  ${String(i+1).padStart(2)}. ${x.name.padEnd(40)} ИНН=${x.inn}`);
    });

    // 6b. Detect template-contaminated ФИО across the candidate pool.
    const contaminatedNames = findContaminatedNames(full);
    if (contaminatedNames.size > 0) {
        console.log(`\nКонтаминированные ФИО (встречаются у >=2 компаний): ${[...contaminatedNames].join(" | ")}`);
    }

    // 6c. Today's batch: exclude yesterday by INN + drop contaminated names.
    const today = selectTopN(full, projects, TOP_N, { excludeInn: EXCLUDE_INN, contaminatedNames });

    console.log(`\n${"=".repeat(72)}`);
    console.log(`СЕГОДНЯШНИЙ BATCH — ${today.length} НОВЫХ писем для n8n`);
    console.log(`${"=".repeat(72)}`);

    let totalWarns = 0;
    for (let i = 0; i < today.length; i++) {
        totalWarns += printMsg(i + 1, today[i].msg, today[i].pid, today[i].payload);
    }

    // 7. Verify attachment URLs actually open (HTTP 200)
    console.log(`\n${"=".repeat(72)}`);
    console.log(`ПРОВЕРКА ССЫЛОК НА ВЛОЖЕНИЯ (HTTP GET с токеном)`);
    console.log(`${"=".repeat(72)}`);
    let attTotal = 0, attOk = 0;
    for (let i = 0; i < today.length; i++) {
        for (const at of today[i].payload.attachments) {
            attTotal++;
            const status = await checkAttachmentUrl(at.download_url);
            const ok = status === 200;
            if (ok) attOk++;
            console.log(`  #${i+1} ${ok ? "✅" : "❌"} ${String(status).padEnd(10)} ${at.filename}`);
        }
    }
    console.log(attTotal === 0
        ? "  (ни у одного из 10 писем нет вложений-документов)"
        : `  Итого вложений: ${attOk}/${attTotal} открываются (HTTP 200)`);

    console.log(`\n${"=".repeat(72)}`);
    console.log(`ИТОГ: ${today.length} писем к отправке, предупреждений: ${totalWarns}, вложения ${attOk}/${attTotal} OK`);
    console.log(`${"=".repeat(72)}\n`);

    // ─── Hard guards before any send ─────────────────────────────────────────
    if (!SEND) {
        console.log("[DRY-RUN] Отправка не выполнялась. Запустите с --send для отправки.");
        return;
    }
    if (today.length !== TOP_N) {
        console.error(`ABORT: отобрано ${today.length} писем, ожидалось ровно ${TOP_N}. Отправка отменена.`);
        process.exit(1);
    }
    if (attTotal > 0 && attOk < attTotal) {
        console.error(`ABORT: ${attTotal - attOk} ссылок на вложения не открываются. Отправка отменена.`);
        process.exit(1);
    }

    // 8. Send — hard-capped at TOP_N
    console.log("Отправка в n8n...\n");
    const toSend = today.slice(0, TOP_N);
    let sent = 0, failed = 0;
    for (const { msg, payload } of toSend) {
        if (sent >= TOP_N) break;
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
            console.log(`  ✓ [${sent}/${toSend.length}] ${key}... → ${payload.company_name || payload.inn}`);
            await new Promise(res => setTimeout(res, 400));
        } catch (err) {
            failed++;
            console.log(`  ✗ ${key}: ${err.message}`);
        }
    }

    console.log(`\nГотово. Отправлено: ${sent}, Ошибок: ${failed}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
