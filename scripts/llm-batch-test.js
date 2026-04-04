/**
 * Batch test: run 25 emails through LLM extractor, compare with rules, report gaps.
 * Usage: node scripts/llm-batch-test.js
 */

process.env.LLM_EXTRACT_ENABLED = "true";
process.env.LLM_EXTRACT_API_KEY = "sk-KSy43_KpyxmLVikumeJTNg";
process.env.LLM_EXTRACT_BASE_URL = "https://api.artemox.com/v1";
process.env.LLM_EXTRACT_MODEL = "gpt-4o-mini";
process.env.LLM_EXTRACT_LOG_SUGGESTIONS = "false";

import { analyzeEmail } from "../src/services/email-analyzer.js";
import { llmExtract, buildRulesFoundSummary } from "../src/services/llm-extractor.js";

const project = {
    mailbox: "info@siderus.ru",
    brands: ["ABB", "Schneider Electric", "Phoenix Contact", "Endress & Hauser", "Yokogawa", "Siemens", "WIKA", "Danfoss"],
    managerPool: { defaultMop: "Менеджер", defaultMoz: "МОЗ", brandOwners: [] },
    knownCompanies: []
};

const emails = [
    {
        id: "E01", label: "Пронумерованный список с брендами",
        fromEmail: "zakup@metallurg-spb.ru", fromName: "Сергей Воронов",
        subject: "Запрос КП — приборы КИПиА",
        body: `Добрый день, Сидерус!
Прошу предоставить КП на следующие позиции:
1. Датчик давления Endress+Hauser Cerabar M PMC51 — 5 шт
2. Преобразователь температуры WIKA TR10-B арт. 50097418 — 2 шт
3. Кабель КВВГ 4х2.5 мм² — 100 м
4. Расходомер Yokogawa ADMAG AXF080G-E1AL1N/CH0 — 1 шт
Срочно! Монтаж на следующей неделе.
С уважением, Воронов Сергей Александрович
Главный метролог, ООО "МеталлургСпб"
ИНН: 7801234567, КПП: 780101001
Тел: +7 (812) 555-01-23`
    },
    {
        id: "E02", label: "Простой запрос без явных артикулов",
        fromEmail: "buyer@oilprom.ru", fromName: "Наталья",
        subject: "Нужна цена на ABB",
        body: `Здравствуйте.
Нужна цена на автоматические выключатели ABB серии System pro M compact.
Типономинал: S201-C16 — 20 штук, S201-C25 — 10 штук.
Наталья Егорова, ООО Нефтепром
+7 (495) 777-88-99`
    },
    {
        id: "E03", label: "Спам-рассылка",
        fromEmail: "promo@bestprice.com", fromName: "BestPrice Team",
        subject: "Специальное предложение для вашего бизнеса!",
        body: `Уважаемые партнёры!
Мы рады предложить вам уникальные условия сотрудничества.
Скидки до 50%! Только сегодня! Успейте воспользоваться предложением.
Нажмите здесь для отписки: unsubscribe@bestprice.com`
    },
    {
        id: "E04", label: "Запрос иностранной компании (EN)",
        fromEmail: "procurement@kazchemistry.kz", fromName: "Aibek Dzhaksybekov",
        subject: "Request for quotation - control valves",
        body: `Dear Siderus team,
We kindly request a quotation for the following items:
1. Control valve Fisher 667 actuator, size 3", PN40 — 2 pcs
2. Solenoid valve ASCO 8210G094 — 4 pcs
3. Pressure transmitter Rosemount 3051CD3 — 3 pcs
Please include delivery time to Almaty, Kazakhstan.
Best regards,
Aibek Dzhaksybekov, Chief Engineer
KazChemistry LLP
+7 (727) 234-56-78`
    },
    {
        id: "E05", label: "Автоответ с вложенным оригиналом",
        fromEmail: "noreply@helpdesk.company.ru", fromName: "Helpdesk",
        subject: "Re: Запрос №4521 — Ваша заявка принята",
        body: `Ваша заявка № 4521 зарегистрирована в системе.
Ответ будет дан в течение 1 рабочего дня.
Это автоматическое сообщение, не отвечайте на него.
---Текст вашего обращения---
От: ivan@siderus.ru
Тема: Запрос по датчикам Siemens
Добрый день! Нужны датчики Siemens 7MF4433 — 3 шт.`
    },
    {
        id: "E06", label: "Письмо поставщика с КП",
        fromEmail: "sales@promsnab-msk.ru", fromName: "Менеджер Промснаб",
        subject: "Коммерческое предложение по вашему запросу",
        body: `Добрый день!
В ответ на ваш запрос направляем коммерческое предложение.
Позиция 1: Клапан Danfoss AVTA — 3 500 руб/шт
Позиция 2: Расходомер Krohne OPTIFLUX 4000 арт. F030118K — 85 000 руб/шт
Срок поставки: 4-6 недель.
Менеджер по продажам, ООО Промснаб
тел: +7 (495) 333-22-11`
    },
    {
        id: "E07", label: "Таблица pipe-delimited",
        fromEmail: "snab@factory-ural.ru", fromName: "Олег Захаров",
        subject: "Запрос КП на оборудование",
        body: `Добрый день!
Прошу выставить счёт на следующие позиции:

Артикул            | Наименование                   | Кол-во | Ед.
-------------------|--------------------------------|--------|----
3HAC12345-1        | Блок управления ABB            | 1      | шт
6GK7543-1AX00-0XE0 | Коммуникатор Siemens          | 2      | шт
2CDS271001R0164    | Автомат ABB S201-B16           | 10     | шт

ООО "Уральский завод автоматики", ИНН 6673012345
Захаров Олег, +7 (343) 290-11-22`
    },
    {
        id: "E08", label: "Кириллические артикулы (АИР)",
        fromEmail: "mto@shakhta-north.ru", fromName: "Дмитрий Федотов",
        subject: "Потребность в электродвигателях",
        body: `Добрый день!
Требуется поставка:
- Электродвигатель АИР100S4У3 — 4 шт
- Электродвигатель АИР80В2 — 2 шт
- Кабель ВВГнг 3х6+1х4 — 200 м
Федотов Дмитрий, ООО "Шахта Северная"
ИНН: 4205123456
+7 (3842) 77-33-22`
    },
    {
        id: "E09", label: "Форма с сайта Tilda",
        fromEmail: "noreply@tilda.ws", fromName: "noreply@tilda.ws",
        subject: "Новая заявка с формы обратной связи",
        body: `Request details:
Name: Светлана Федорова
phone: +7 (925) 831-44-12
email: s.fedorova@khim-zavod.ru
company: ООО Химзавод-Урал
comment: Здравствуйте! Нужен клапан Burkert 6013 DN25 PN16, 2 штуки. Срочно!
Request ID: 88234:10234567`
    },
    {
        id: "E10", label: "Без компании — физлицо",
        fromEmail: "vasiliy1980@mail.ru", fromName: "Василий",
        subject: "Цена на Phoenix Contact",
        body: `Сколько стоит Phoenix Contact QUINT-PS/1AC/24DC/10?
Нужно 3 штуки.
Василий, +7 (900) 123-45-67`
    },
    {
        id: "E11", label: "Крупная многопозиционная заявка с реквизитами",
        fromEmail: "zakupki@gazprom-neft-msk.ru", fromName: "Людмила Орехова",
        subject: "Потребность в КИПиА — заявка 2026-04",
        body: `Уважаемые коллеги!
Направляем потребность на II квартал 2026 года.

1. Датчик давления Rosemount 3051TG — 10 шт (давление 0-25 бар)
2. Термосопротивление Метран-274 Pt100 — 15 шт
3. Счётчик газа РГА-1 DN50 — 2 шт
4. Шкаф КИПиА с монтажом — 1 комплект

Реквизиты:
ООО "Газпромнефть-МСК"
ИНН: 7712345678
КПП: 771201001
ОГРН: 1027712345678

Орехова Людмила Ивановна, Начальник отдела МТО
Тел: +7 (495) 987-65-43`
    },
    {
        id: "E12", label: "Запрос без артикула — по параметрам",
        fromEmail: "info@stroymontazh.ru", fromName: "Алексей",
        subject: "Вопрос по приборам учёта",
        body: `Добрый день.
Нам нужен прибор учёта газа на давление 0.1 МПа, расход до 100 м3/ч.
Хотим Флоутек или аналог. Бюджет до 150 тыс. руб.
Алексей Кузнецов, ООО Стройтмонтаж
моб: 8-916-444-55-66`
    },
    {
        id: "E13", label: "Пересланное письмо Fwd с оригинальным запросом",
        fromEmail: "director@siderus.ru", fromName: "Директор Сидерус",
        subject: "Fwd: Срочная заявка от Химпром",
        body: `Коллеги, прошу обработать.

-------- Forwarded Message --------
От: snab@khimprom-kazan.ru
Тема: Срочная заявка

Добрый день!
Срочно нужен датчик уровня VEGAPULS 64 арт. PULS64.CXHWMSX — 1 шт.
Готовы к предоплате 100%.
ООО "Химпром-Казань", ИНН 1655112233
Контакт: Рустам Фазылов, +7 (843) 566-77-88`
    },
    {
        id: "E14", label: "Манометры WIKA с точечными артикулами",
        fromEmail: "mto@neft-spb.ru", fromName: "Антон Смирнов",
        subject: "Манометры WIKA",
        body: `Здравствуйте.
Прошу предоставить КП:
- Манометр WIKA 233.50.063 — 10 шт
- Манометр WIKA 232.50.063 — 5 шт
- Разделитель мембранный WIKA 910.12.500 — 3 шт
Антон, ООО НефтьСПб, +7 (812) 234-56-78`
    },
    {
        id: "E15", label: "Неформальный запрос с опечатками",
        fromEmail: "petya@gmail.com", fromName: "Петя",
        subject: "цена",
        body: `привет
сколько стоит абб S201C16 10штук и есть ли в наличии?
и ещё schneider Easy9 EZ9F56210 тоже 5 штук
пишите на почту или звоните 9161234567`
    },
    {
        id: "E16", label: "10-позиционная заявка КИП (смешанные бренды)",
        fromEmail: "mto@nzk.ru", fromName: "Ирина Горшкова",
        subject: "Запрос 2026/04 — комплектация КИП",
        body: `Добрый день!
Направляю сводную заявку по КИП на апрель 2026:

1. Метран-100 Ду15 — 8 шт
2. Метран-150 Ду25 — 4 шт
3. YOKOGAWA EJA110E — 6 шт, диапазон 0-100 кПа
4. Термопара ТХКА-205 — 12 шт
5. Клапан AUMA SA 07.1 арт. 01271200 — 2 шт
6. Задвижка BELIMO LF120-S — 4 шт
7. Регулятор SAMSON 3241-1 DN25 PN16 — 1 шт
8. Датчик вибрации Hansford HS-100 арт. HS100MA400 — 3 шт
9. Кабель КВВГ-нг 7х1.5 — 500 м
10. Клеммник Phoenix Contact UK 6N — 100 шт

Горшкова Ирина Михайловна, Начальник отдела снабжения
ООО "Нефтехимический завод Казани" ИНН 1655234567
+7 (843) 270-01-02 доб. 114`
    },
    {
        id: "E17", label: "Серийный запрос без конкретных артикулов",
        fromEmail: "buyer@energo.ru", fromName: "Виктор Осипов",
        subject: "Преобразователи частоты ABB",
        body: `Добрый день!
Нужны преобразователи частоты ABB ACS550 мощностью от 2.2 до 15 кВт.
Конкретные артикулы уточним по наличию. Количество — 10-15 штук.
Виктор Осипов, ЭнергоСервис, +7 (499) 222-33-44`
    },
    {
        id: "E18", label: "Казахская компания — BIN вместо ИНН",
        fromEmail: "zakup@astana-oil.kz", fromName: "Жансая Ергалиева",
        subject: "Запрос на оборудование",
        body: `Здравствуйте!
Нам нужны следующие позиции для НПЗ в Атырау:
1. Клапан регулирующий Emerson Fisher D4 DN50 — 3 шт
2. Позиционер Fisher FIELDVUE DVC6200 — 3 шт
3. Датчик давления Rosemount 3051S — 5 шт
Наша компания: ТОО "АстанаОйл"
БИН: 180340012345
Жансая Ергалиева, +7 (701) 234-56-78`
    },
    {
        id: "E19", label: "Рекламация",
        fromEmail: "complaint@factory.ru", fromName: "Технолог",
        subject: "Рекламация по партии S201-C16",
        body: `В партии от 15.03.2026 обнаружены дефектные автоматы ABB S201-C16 (счёт №2345 от 14.03.2026).
Из 50 штук 8 не прошли приёмный контроль.
Прошу произвести замену или возврат средств.
Технический отдел, ООО ТехноМаш, +7 (495) 222-33-44`
    },
    {
        id: "E20", label: "Запрос только с вложением (пустое тело)",
        fromEmail: "purchase@building.ru", fromName: "Отдел закупок",
        subject: "Заявка на оборудование (см. вложение)",
        body: `Добрый день! Заявка во вложении.
С уважением, Отдел закупок ООО СтройКомплекс`
    },
    {
        id: "E21", label: "ИП с ИНН 12 цифр",
        fromEmail: "ip.smirnov@bk.ru", fromName: "ИП Смирнов",
        subject: "Нужен датчик уровня",
        body: `Добрый день.
Мне нужен датчик уровня Rosemount 3300 или аналог для резервуара воды.
Я ИП Смирнов Константин Андреевич, ИНН 504512345678.
Работаю с НДС. Нужен 1 штука срочно.
тел 8 916 999 00 11`
    },
    {
        id: "E22", label: "Vendor offer — китайский поставщик",
        fromEmail: "partner@china-supply.cn", fromName: "Wang Li",
        subject: "Предложение о сотрудничестве — промышленные клапаны",
        body: `Dear manager,
We are a Chinese manufacturer of industrial valves and actuators.
We offer: gate valves, ball valves, butterfly valves at factory prices.
Minimum order: 50 pcs. We are looking for distributors in Russia.
Please contact us for a catalogue.
Wang Li, Sales Manager, +86 138 0013 8000`
    },
    {
        id: "E23", label: "Кабели и провода без артикулов",
        fromEmail: "snab@reactor.ru", fromName: "Павел Зайцев",
        subject: "Провода и кабели — потребность",
        body: `Здравствуйте.
Прошу прайс на:
- ПВ1 сечением 1.5, 2.5, 4, 6, 10 мм² — по 100 м каждого
- ВВГнг 3х2.5 — 200 м
- КВВГ 7х0.75 — 100 м
Дата нужна к 10.04.2026.
Павел Зайцев, ООО Реактор-Снаб, ИНН 6311098765, +7 (846) 211-33-44`
    },
    {
        id: "E24", label: "Re: запрос с номером счёта",
        fromEmail: "zakup@plant-nn.ru", fromName: "Ольга Попова",
        subject: "Re: Счёт №2345 — оплачен, когда отгрузка?",
        body: `Добрый день.
Счёт №2345 от 01.04.2026 оплачен (платёжка во вложении).
Когда сможете отгрузить? Изделия нужны к 10 апреля.
Позиции: Rosemount 3051CD — 2 шт, WIKA 233.50.063 — 5 шт.
Попова Ольга, ООО НН-Завод, ИНН 5260123456, +7 (831) 444-55-66`
    },
    {
        id: "E25", label: "Запрос прайс-листа (без конкретики)",
        fromEmail: "info@new-client.ru", fromName: "Закупщик",
        subject: "Актуальный прайс-лист",
        body: `Добрый день.
Пришлите, пожалуйста, актуальный прайс-лист на ваш ассортимент.
Нас интересует промышленная автоматика в целом.
Заранее спасибо.`
    }
];

const results = [];
let gapsTotal = 0;

for (const email of emails) {
    process.stdout.write(`Прогон ${email.id} [${email.label}]... `);
    const payload = {
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        body: email.body,
        attachments: "",
        messageKey: email.id
    };

    const rulesResult = analyzeEmail(project, payload);
    const rulesFound = buildRulesFoundSummary(rulesResult);

    let llmData = null;
    const t0 = Date.now();
    try {
        llmData = await llmExtract({ subject: email.subject, body: email.body, fromEmail: email.fromEmail, rulesFound });
    } catch (e) {
        process.stdout.write(`ERROR: ${e.message}\n`);
        results.push({ id: email.id, label: email.label, error: e.message });
        continue;
    }
    const ms = Date.now() - t0;

    const gaps = llmData?.detection_gaps || [];
    const rulesArtSet = new Set(rulesFound.articles.map(a => a.toLowerCase()));
    const newArts = (llmData?.articles || []).filter(a => a?.code && !rulesArtSet.has(a.code.toLowerCase()));
    gapsTotal += gaps.length;

    results.push({
        id: email.id, label: email.label, ms,
        classification: rulesResult.classification.label,
        requestType: llmData?.request_type,
        isUrgent: llmData?.is_urgent,
        missing: llmData?.missing_for_processing || [],
        rulesArticles: rulesFound.articles,
        llmArticles: (llmData?.articles || []).map(a => `${a.code}(${a.brand || "?"},${a.quantity || "?"}${a.unit || ""})`),
        newArts: newArts.map(a => `${a.code}(${a.brand || "?"})`),
        rulesBrands: rulesFound.brands,
        llmBrands: llmData?.brands || [],
        nameDiff: rulesFound.sender_name !== llmData?.sender_name ? `rules="${rulesFound.sender_name}" llm="${llmData?.sender_name}"` : null,
        phoneDiff: rulesFound.sender_phone !== llmData?.sender_phone ? `rules="${rulesFound.sender_phone}" llm="${llmData?.sender_phone}"` : null,
        companyDiff: rulesFound.company_name !== llmData?.company_name ? `rules="${rulesFound.company_name}" llm="${llmData?.company_name}"` : null,
        innDiff: rulesFound.inn !== llmData?.inn ? `rules="${rulesFound.inn}" llm="${llmData?.inn}"` : null,
        gaps: gaps.map(g => `[${g.type}] "${g.value}" | ${g.suggestion}`)
    });

    process.stdout.write(`OK ${ms}ms — gaps:${gaps.length} newArts:${newArts.length}\n`);
}

console.log("\n\n============================== ПОЛНЫЙ ОТЧЁТ ==============================\n");
for (const r of results) {
    if (r.error) { console.log(`--- ${r.id}: ${r.label} --- ERROR: ${r.error}\n`); continue; }
    const flags = [];
    if (r.newArts.length) flags.push(`+${r.newArts.length}ARTS`);
    if (r.gaps.length) flags.push(`${r.gaps.length}GAPS`);
    if (r.nameDiff) flags.push("NAME");
    if (r.phoneDiff) flags.push("PHONE");
    if (r.companyDiff) flags.push("COMPANY");
    if (r.innDiff) flags.push("INN");

    console.log(`--- ${r.id}: ${r.label} [${r.classification}] ${flags.join(" ")} ---`);
    console.log(`  type: ${r.requestType} | urgent: ${r.isUrgent} | missing: [${r.missing.join(", ")}]`);
    console.log(`  RULES arts: [${r.rulesArticles.join(", ")}]`);
    console.log(`  LLM   arts: [${r.llmArticles.join(", ")}]`);
    if (r.newArts.length) console.log(`  *** НОВЫЕ от LLM: [${r.newArts.join(", ")}]`);
    console.log(`  RULES brands: [${r.rulesBrands.join(", ")}]`);
    console.log(`  LLM   brands: [${r.llmBrands.join(", ")}]`);
    if (r.nameDiff) console.log(`  ИМЯ: ${r.nameDiff}`);
    if (r.phoneDiff) console.log(`  ТЕЛ: ${r.phoneDiff}`);
    if (r.companyDiff) console.log(`  КОМПАНИЯ: ${r.companyDiff}`);
    if (r.innDiff) console.log(`  ИНН: ${r.innDiff}`);
    if (r.gaps.length) {
        console.log(`  GAPS:`);
        for (const g of r.gaps) console.log(`    - ${g}`);
    }
    console.log();
}

const withNewArts = results.filter(r => r.newArts?.length > 0);
const withGaps = results.filter(r => r.gaps?.length > 0);
const typeCount = {};
for (const r of results) if (r.gaps) for (const g of r.gaps) {
    const t = g.match(/^\[(\w+)\]/)?.[1] || "?";
    typeCount[t] = (typeCount[t] || 0) + 1;
}

console.log("============================== СВОДКА ==============================");
console.log(`Всего писем: ${results.length}`);
console.log(`С новыми артикулами от LLM: ${withNewArts.length} — ${withNewArts.map(r => r.id).join(", ")}`);
console.log(`С detection_gaps: ${withGaps.length} — ${withGaps.map(r => r.id).join(", ")}`);
console.log(`Всего gaps: ${gapsTotal}`);
console.log(`Gaps по типам: ${Object.entries(typeCount).map(([k, v]) => `${k}:${v}`).join(" ")}`);
const avgMs = Math.round(results.filter(r => r.ms).reduce((s, r) => s + r.ms, 0) / results.filter(r => r.ms).length);
console.log(`Среднее время LLM: ${avgMs} мс`);
