/**
 * Выбрать лучшие 10 писем где ВСЕ ключевые поля заполнены:
 *   ФИО, Компания, ИНН, Телефон, хотя бы 1 артикул, хотя бы 1 бренд.
 * Проверить вложения (HTTP 200), вывести детали, отправить в n8n.
 *
 * Usage:
 *   node scripts/_select_best10_allfields.mjs           # dry-run
 *   node scripts/_select_best10_allfields.mjs --send    # отправить
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const PROD_URL         = "https://pochta-production.up.railway.app";
const N8N_URL          = "https://test-n8n.siderus.online/webhook/pochta_service";
const N8N_AUTH         = "Oo`8Vh6W<7Olkx4@N'M";
const ADMIN_PASSWORD   = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const ATTACHMENT_TOKEN = "fd3d37534b3f64147b70e0e7bf6a622852fa720eeafb36410190f95cbb0dd7bf";
const SEND             = process.argv.includes("--send");
const PROJECTS         = ["project-3-mailbox-file", "project-4-klvrt-mail"];
const TOP_N            = 10;

// ─── helpers ──────────────────────────────────────────────────────────────────
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
async function checkUrl(url) {
    try {
        const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20_000) });
        await r.arrayBuffer().catch(() => {});
        return r.status;
    } catch (e) { return `ERR:${e.message.slice(0,40)}`; }
}

// ─── Требования к письму — ВСЕ поля обязательны ──────────────────────────────
function allFieldsOk(msg) {
    const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {};
    const reasons = [];

    if (!s.fullName || /^Не Определено$/i.test(s.fullName)) reasons.push("нет ФИО");
    if (!s.companyName) reasons.push("нет компании");
    if (!s.inn)         reasons.push("нет ИНН");
    if (!s.mobilePhone && !s.cityPhone) reasons.push("нет телефона");

    const arts = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:")).length
              || (l.articles || []).length;
    if (arts === 0) reasons.push("нет артикулов");

    const brands = (l.detectedBrands || []).length;
    if (brands === 0) reasons.push("нет брендов");

    // Тема помечена как спам
    const subj = String(msg.subject || "");
    if (/\[probable\s*spam\]/i.test(subj)) reasons.push("тема помечена как probable spam");

    return reasons;
}

// ─── Проверки качества fullName до построения payload ─────────────────────────
function fioQualityReasons(fullName) {
    const n = String(fullName || "").trim();
    const reasons = [];
    if (!n || /^Не Определено$/i.test(n)) return ["ФИО пустое"];
    // Начинается со служебного слова
    if (/^(телефон|phone|тел\b|email|e-mail|факс|fax|отправлено|sent\s+from)/i.test(n))
        reasons.push(`ФИО = служебная строка: ${n.slice(0,50)}`);
    // Содержит длинный телефонный номер
    if (/[\d()\s-]{7,}/.test(n) && /\d{5,}/.test(n.replace(/[\s()\-+]/g, "")))
        reasons.push(`ФИО содержит телефонный номер: ${n.slice(0,50)}`);
    // Содержит название юрлица
    if (/\b(ооо|оао|зао|пао|ао|ип|gmbh|ltd|llc|jsc|inc)\b/i.test(n))
        reasons.push(`ФИО содержит юрлицо: ${n.slice(0,50)}`);
    // Только одно слово
    if (n.split(/\s+/).length < 2) reasons.push(`ФИО = одно слово: ${n}`);
    // Содержит цифры (кроме Jr/Sr)
    if (/\d/.test(n)) reasons.push(`ФИО содержит цифры: ${n.slice(0,50)}`);
    // Служебные символы
    if (/[*;@#<>{}[\]]/.test(n)) reasons.push(`ФИО мусорные символы: ${n.slice(0,30)}`);
    return reasons;
}

// Дополнительные проверки качества payload
function payloadQualityReasons(msg, payload) {
    const reasons = [];

    // ── ФИО ──
    const name = payload.client_name || "";
    const fioR = fioQualityReasons(name);
    reasons.push(...fioR);
    if (/regards|sincerely|уважением|подпись/i.test(name)) reasons.push("ФИО = подпись");

    // ── Компания ──
    const comp = payload.company_name || "";
    if (comp.length > 80) reasons.push("company_name слишком длинная");
    if (/наименование|реквизит|^ответственностью/i.test(comp)) reasons.push("company_name = реквизиты");
    if (/[а-яёa-z]\s[а-яёa-z]\s[а-яёa-z]/i.test(comp)) reasons.push(`company_name с пробелами: ${comp.slice(0,50)}`);
    if (/\)\s*\//.test(comp)) reasons.push(`company_name с мусором: ${comp.slice(0,50)}`);
    // Компания оканчивается на оборванное слово (прилагательное без существительного)
    if (/\s+(юридически[ейх]?|физически[ейх]?|частично|временно)$/i.test(comp))
        reasons.push(`company_name с оборванным словом: ${comp.slice(0,60)}`);

    if (!payload.inn && !payload.company_name) reasons.push("нет ИНН и компании");

    // ── Артикулы ──
    const items = payload.order_from_mail || [];
    const noisyItems = items.filter(it => {
        const n = String(it.item_number || "");
        return /^signature_/i.test(n)             // мусор из подписи email
            || /\d{4}-\d{2}-\d{2}T\d/.test(n)    // timestamp как артикул
            || /^FOGRA\d/i.test(n)                // ICC профиль
            || /^photoshop:/i.test(n)             // метаданные изображения
            || /\.pdf$/i.test(n)                  // имя PDF-файла как артикул
            || /\.xlsx?$/i.test(n)                // имя Excel-файла как артикул
            || /^(https?|ftp):\/\//i.test(n);     // URL как артикул
    });
    if (items.length > 0 && noisyItems.length / items.length > 0.15) {
        reasons.push(`>${Math.round(noisyItems.length/items.length*100)}% мусорных артикулов (${noisyItems.map(i=>i.item_number).slice(0,2).join(", ")}...)`);
    }

    // ── Вложения ──
    for (const at of (payload.attachments || [])) {
        if (!/^https:\/\/.+[?&]token=/.test(at.download_url || "")) {
            reasons.push(`вложение без токена: ${at.filename}`);
        }
    }
    return reasons;
}

// Скоринг — чем больше тем лучше
function score(msg) {
    const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {}, cl = a.classification || {};
    let sc = 0;
    if (s.inn)         sc += 8;
    if (s.companyName) sc += 6;
    if (s.fullName && !/^Не Определено$/i.test(s.fullName)) sc += 5;
    if (s.mobilePhone || s.cityPhone) sc += 4;
    if (s.position)    sc += 2;
    const li = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:"));
    const arts = li.length || (l.articles || []).length;
    sc += Math.min(arts, 10) * 1.5;
    sc += Math.min((l.detectedBrands || []).length, 5) * 1.5;
    if (li.some(i => i.quantity > 0)) sc += 3;
    sc += Number(cl.confidence || l.confidence || 0) * 5;
    return sc;
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`Режим: ${SEND ? "ОТПРАВКА (--send)" : "DRY-RUN (без отправки)"}`);
    const token = await login();

    // 1. Загрузка всех ready_for_crm
    const candidates = [];
    for (const pid of PROJECTS) {
        process.stdout.write(`Загружаю ${pid}... `);
        const d = await apiFetch(`/api/projects/${pid}/messages`, token);
        const msgs = (d.messages || []).filter(m => m.pipelineStatus === "ready_for_crm");
        console.log(`${msgs.length} ready_for_crm`);
        for (const m of msgs) candidates.push({ msg: m, pid });
    }
    console.log(`Всего кандидатов: ${candidates.length}`);

    // 2. Slim score — берём топ-200 для полной загрузки
    candidates.sort((a, b) => score(b.msg) - score(a.msg));
    const topSlim = candidates.slice(0, 200);

    // 3. Полная загрузка (с вложениями)
    process.stdout.write(`Загружаю полные данные (${topSlim.length})...`);
    const full = [];
    for (let i = 0; i < topSlim.length; i++) {
        const { msg, pid } = topSlim[i];
        const mid = msg.messageKey || msg.id || "";
        try {
            const d = await apiFetch(`/api/projects/${pid}/messages/${encodeURIComponent(mid)}`, token);
            full.push({ msg: d.message || msg, pid });
        } catch { full.push({ msg, pid }); }
        if ((i + 1) % 40 === 0) process.stdout.write(` ${i + 1}`);
    }
    console.log(" готово");

    // 4. Конфигурации проектов
    const projects = {};
    for (const pid of PROJECTS) {
        const d = await apiFetch(`/api/projects/${pid}`, token);
        projects[pid] = d.project || d;
    }

    // 5. Full re-score
    full.sort((a, b) => score(b.msg) - score(a.msg));

    // 6. Фильтрация — только письма со ВСЕМИ полями
    const selected = [];
    let rejected = 0;
    for (const { msg, pid } of full) {
        if (selected.length >= TOP_N) break;
        const missing = allFieldsOk(msg);
        if (missing.length > 0) { rejected++; continue; }
        const payload = buildSiderusCrmPayload(projects[pid], msg, PROD_URL, ATTACHMENT_TOKEN);
        const pReasons = payloadQualityReasons(msg, payload);
        if (pReasons.length > 0) { rejected++; continue; }
        // Проверяем вложения — пропускаем письмо если есть битые ссылки
        let hasDeadAttachment = false;
        for (const at of payload.attachments) {
            const status = await checkUrl(at.download_url);
            if (status !== 200) { hasDeadAttachment = true; break; }
        }
        if (hasDeadAttachment) { rejected++; continue; }
        selected.push({ msg, pid, payload });
    }
    console.log(`\nОтобрано: ${selected.length} из ${full.length} (отклонено ${rejected} — неполные данные)`);

    if (selected.length < TOP_N) {
        console.log(`⚠ Нашлось только ${selected.length} писем со всеми полями (нужно ${TOP_N}).`);
    }

    // 7. Вывод деталей каждого письма
    console.log(`\n${"═".repeat(72)}`);
    let totalWarns = 0;
    for (let i = 0; i < selected.length; i++) {
        const { msg, pid, payload } = selected[i];
        const a = msg.analysis || {}, s = a.sender || {}, l = a.lead || {}, cl = a.classification || {};
        const brands = (l.detectedBrands || []).map(b => typeof b === "string" ? b : b.name || "?");
        const li = (l.lineItems || []).filter(i => i.article && !i.article.startsWith("DESC:"));

        console.log(`\n#${i + 1} ${msg.subject || "(без темы)"}`);
        console.log(`   От:          ${msg.from || "?"}`);
        console.log(`   Ящик:        ${msg.mailbox || "?"} [${pid}]`);
        console.log(`   Уверенность: ${(Number(cl.confidence || 0)).toFixed(3)}`);
        console.log(`   ─── Контакт ───`);
        console.log(`   ФИО:         ${s.fullName || "—"} [${s.fullNameSource || "?"}]`);
        console.log(`   Компания:    ${s.companyName || "—"} [${s.companyNameSource || "?"}]`);
        console.log(`   ИНН:         ${s.inn || "—"}`);
        console.log(`   Телефон:     ${s.mobilePhone || s.cityPhone || "—"} [${s.phoneSource || "?"}]`);
        console.log(`   Должность:   ${s.position || "—"}`);
        console.log(`   ─── Заявка ───`);
        console.log(`   Бренды:      ${brands.slice(0, 5).join(", ") || "—"}`);
        console.log(`   Артикулов:   ${li.length || (l.articles || []).length}`);
        for (const it of li.slice(0, 5)) {
            console.log(`     • ${String(it.article || "?").padEnd(20)} qty=${String(it.quantity ?? "—").padEnd(5)} ${(it.descriptionRu || it.description || "").slice(0, 40)}`);
        }
        if (li.length > 5) console.log(`     ... и ещё ${li.length - 5}`);
        console.log(`   ─── n8n payload ───`);
        console.log(`   company_name: ${payload.company_name || "—"}`);
        console.log(`   inn:          ${payload.inn || "—"}`);
        console.log(`   client_name:  ${payload.client_name || "—"}`);
        console.log(`   phone:        ${payload.phone_number || "—"}`);
        console.log(`   order_items:  ${payload.order_from_mail.length}`);
        console.log(`   attachments:  ${payload.attachments.length}`);
        for (const at of payload.attachments) {
            const hasToken = /[?&]token=/.test(at.download_url || "");
            console.log(`     • ${at.filename}`);
            console.log(`       ${at.download_url}`);
            if (!hasToken) { console.log("       ⚠ НЕТ ТОКЕНА!"); totalWarns++; }
        }

        if (li.length === 0 && (l.articles || []).length > 0) {
            console.log(`   (нет lineItems — articles: ${(l.articles || []).join(", ")})`);
        }
    }

    // 8. Проверка всех ссылок на вложения
    const allAttachments = selected.flatMap((x, i) =>
        x.payload.attachments.map(at => ({ i: i + 1, at }))
    );
    if (allAttachments.length > 0) {
        console.log(`\n${"═".repeat(72)}`);
        console.log(`ПРОВЕРКА ССЫЛОК (${allAttachments.length} вложений)`);
        let ok = 0;
        for (const { i, at } of allAttachments) {
            const status = await checkUrl(at.download_url);
            const good = status === 200;
            if (good) ok++;
            console.log(`  #${i} ${good ? "✅" : "❌"} ${String(status).padEnd(12)} ${at.filename}`);
            if (!good) totalWarns++;
        }
        console.log(`Итого: ${ok}/${allAttachments.length} открываются`);
    }

    console.log(`\n${"═".repeat(72)}`);
    console.log(`ИТОГ: ${selected.length} писем, предупреждений: ${totalWarns}`);
    console.log(`${"═".repeat(72)}\n`);

    if (!SEND) {
        console.log("[DRY-RUN] Добавьте --send для отправки в n8n.");
        return;
    }
    if (selected.length !== TOP_N) {
        console.error(`ABORT: отобрано ${selected.length} вместо ${TOP_N}. Отправка отменена.`);
        process.exit(1);
    }
    if (totalWarns > 0) {
        console.error(`ABORT: есть предупреждения (${totalWarns}). Исправьте и повторите.`);
        process.exit(1);
    }

    console.log("Отправка в n8n...");
    let sent = 0, failed = 0;
    for (const { msg, payload } of selected) {
        const key = (msg.messageKey || msg.id || "?").slice(0, 16);
        try {
            const r = await fetch(N8N_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: N8N_AUTH },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15_000),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            sent++;
            console.log(`  ✓ [${sent}/${selected.length}] ${key} → ${payload.company_name || payload.inn}`);
            await new Promise(r => setTimeout(r, 400));
        } catch (e) {
            failed++;
            console.log(`  ✗ ${key}: ${e.message}`);
        }
    }
    console.log(`\nГотово: отправлено ${sent}, ошибок ${failed}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
