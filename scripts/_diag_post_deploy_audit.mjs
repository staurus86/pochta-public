// Post-deploy audit: measure residual noise per class across fresh prod data (post-reanalysis).
import fs from "node:fs";

const dumps = ["data/.fresh_p4.json", "data/.fresh_p3.json"];
let client = [];
for (const f of dumps) {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    const msgs = d.messages || d;
    client = client.concat(msgs.filter((m) => ((m.analysis || {}).classification || {}).label === "Клиент"));
}

const FILEEXT = /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|bmp|tiff?|webp|heic|svg|zip|rar|7z|eml|msg)$/i;
const BANK = /(?:^|[^А-Яа-яЁёA-Za-z])(?:Альфа-?Банк|Сбербанк|ВТБ|Тинькофф|Газпромбанк|Райффайзен|Росбанк|Промсвязьбанк|Совкомбанк)(?![А-Яа-яЁёA-Za-z])/i;
const ROLE_TAIL = /\s(?:директор|заместител|президент|руководител|менеджер|начальник|бухгалтер|снабжен)[а-яё]*\s+[А-ЯЁ][а-яё]+/i;
const REG_TAIL = /\s(?:зарегистрир|сокращ[а-яё]+\s+наименов|полное\s+наименов|наименование\s+организ)/i;
const LATIN_ROLE = /\b(?:manager|director|engineer|procurement|purchasing)\b/i;
const NESTED_Q = /«[^»]*«|»»/;
const SLASH0 = /\/0\d{1,2}$/;

const counts = {};
const ex = {};
function hit(c, key, sample) { counts[c] = (counts[c] || 0) + 1; (ex[c] ||= []).length < 6 && ex[c].push(sample); }

let withArt = 0, withCo = 0, withFio = 0;
for (const m of client) {
    const s = (m.analysis || {}).sender || {};
    const l = (m.analysis || {}).lead || {};
    const arts = (l.articles || []).map((a) => typeof a === "string" ? a : a && a.code).filter(Boolean);
    const co = (s.companyName || "").trim();
    const fio = (s.fullName || "").trim();
    if (arts.length) withArt++;
    if (co && co !== "Не определено") withCo++;
    if (fio && !/^не\s*определено$/i.test(fio)) withFio++;

    for (const a of arts) if (FILEEXT.test(String(a))) hit("article_filename", m, a);
    for (const a of arts) if (SLASH0.test(String(a))) hit("article_slash0", m, a);
    if (co && co !== "Не определено") {
        if (BANK.test(co)) hit("company_bank", m, co);
        if (ROLE_TAIL.test(co)) hit("company_role_tail", m, co);
        if (REG_TAIL.test(co)) hit("company_reg_tail", m, co);
        if (LATIN_ROLE.test(co)) hit("company_latin_role", m, co);
        if (NESTED_Q.test(co)) hit("company_nested_quotes", m, co);
        if (co.length > 60) hit("company_too_long", m, co);
    }
    if (fio && !/^не\s*определено$/i.test(fio)) {
        if (/\d/.test(fio)) hit("fio_digits", m, fio);
        if (/[*`]|``/.test(fio)) hit("fio_markdown", m, fio);
        if (/\b(ооо|оао|зао|пао)\b/i.test(fio)) hit("fio_company_word", m, fio);
    }
}

console.log(`Клиент: ${client.length} | withArticles: ${withArt} | withCompany: ${withCo} | withFio: ${withFio}\n`);
const baseline = { article_filename: 34, company_bank: 20, fio_digits: 36, company_role_tail: 2, company_reg_tail: 7 };
console.log("CLASS                       | NOW | was(pre-fix) | examples");
console.log("-".repeat(90));
const order = ["article_filename","company_bank","fio_digits","company_role_tail","company_reg_tail",
    "article_slash0","company_latin_role","company_nested_quotes","company_too_long","fio_markdown","fio_company_word"];
for (const c of order) {
    const n = counts[c] || 0;
    const was = baseline[c] != null ? String(baseline[c]) : "—";
    const exs = (ex[c] || []).slice(0, 2).map((m) => JSON.stringify((((m.analysis||{}).sender||{}).companyName || ((m.analysis||{}).sender||{}).fullName || (((m.analysis||{}).lead||{}).articles||[])[0] || "").toString().slice(0, 40)));
    console.log(`${c.padEnd(27)} | ${String(n).padStart(3)} | ${was.padStart(12)} | ${exs.join(", ")}`);
}
