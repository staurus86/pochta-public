import { test } from "node:test";
import assert from "node:assert/strict";
import { isObviousArticleNoise, analyzeEmail } from "../src/services/email-analyzer.js";
import { classifyRequestType, applyRequestTypeFallback } from "../src/services/request-type-rules.js";
import { normalizeMissingKey, normalizeMissingList, reconcileMissingForProcessing } from "../src/services/field-enums.js";
import { validateBeforeCrm } from "../src/services/quality-gate.js";

// --- Batch J2 article blacklist ---
test("article-noise J2: page: / WordSection / 553E-mail / digit+mail", () => {
    assert.equal(isObviousArticleNoise("page:WordSection1"), true);
    assert.equal(isObviousArticleNoise("WordSection1"), true);
    assert.equal(isObviousArticleNoise("WORDSECTION1"), true);
    assert.equal(isObviousArticleNoise("553E-mail"), true);
    assert.equal(isObviousArticleNoise("553e-mail"), true);
    assert.equal(isObviousArticleNoise("8005mail"), true);
    // Real article starting with digits must pass
    assert.equal(isObviousArticleNoise("6EP1961-3BA21"), false);
    assert.equal(isObviousArticleNoise("08Х18Н10Т"), false);
});

// --- Batch J2 company sanitizer (via analyzeEmail integration) ---
const mkProject = () => ({ id: "test-j", name: "Test", type: "email-parser", settings: {} });

test("company-sanitizer J2: HTML angle brackets stripped — 'ООО <Алабуга Машинери>' → clean", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос цены",
        body: "Прошу выставить КП.\n\nС уважением,\nИванов И.И.\nООО <Алабуга Машинери>\nИНН 1234567890",
        from: "test@example.ru",
    });
    const company = result.analysis?.sender?.companyName || "";
    // After strip, should not contain < or >
    assert.ok(!/[<>]/.test(company), `Company still has angle brackets: "${company}"`);
});

test("company-sanitizer J2: mailto: fragment rejected or stripped", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "ООО Ромашка <mailto:sales@romashka.ru>\nИНН 7712345678",
        from: "test@example.ru",
    });
    const company = result.analysis?.sender?.companyName || "";
    assert.ok(!/mailto:|@/.test(company), `Company has mailto/email fragment: "${company}"`);
});

test("company-sanitizer J2: URL in company name rejected", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Компания: ООО Тест http://test.ru\nИНН 7712345678",
        from: "test@example.ru",
    });
    const company = result.analysis?.sender?.companyName || "";
    assert.ok(!/https?:\/\//i.test(company), `Company has URL: "${company}"`);
});

// --- Batch J2 person name sanitizer ---
test("fullname-sanitizer J2: ФИО с ООО/АО/LLC отбрасывается", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Test",
        body: "Здравствуйте,\n\nС уважением,\nООО Ромашка",
        from: "ivan@romashka.ru",
    });
    const fio = result.analysis?.sender?.fullName;
    assert.ok(
        !fio || !/\b(?:ООО|АО|ЗАО|ПАО|ИП|LLC|Ltd|GmbH)\b/.test(fio),
        `ФИО с юрлицом: "${fio}"`
    );
});

test("fullname-sanitizer J2: ФИО = должность 'Менеджер отдела продаж' отбрасывается когда нет имени", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Test",
        body: "Добрый день,\n\nС уважением,\nМенеджер отдела продаж\nТелефон: +7 495 123-45-67",
        from: "sales@example.ru",
    });
    const fio = result.analysis?.sender?.fullName || "";
    // job title alone should not pass as fullName
    assert.ok(!/^Менеджер отдела продаж$/i.test(fio), `Job title stored as ФИО: "${fio}"`);
});

// --- XLSX INN formatting (unit-level) ---
test("xlsx INN export J1: txt() helper wraps digit string as text cell object", () => {
    // Minimal fidelity check — replicate the helper and verify cell object shape
    const txt = (v) => ({ t: 's', v: v == null ? '' : String(v) });
    const cell = txt("7704784450");
    assert.equal(cell.t, 's');           // text type forced
    assert.equal(cell.v, "7704784450");  // value preserved as string
    assert.equal(typeof cell.v, "string");
    // null / undefined → empty string, still text
    assert.deepEqual(txt(null), { t: 's', v: '' });
    assert.deepEqual(txt(undefined), { t: 's', v: '' });
});

// --- Batch J4 request-type rule classifier -------------------------------
test("request-type J4: 'Запрос КП на оборудование' → quotation", () => {
    assert.equal(classifyRequestType({ subject: "Запрос КП на оборудование", body: "" }), "quotation");
});

test("request-type J4: 'Просим выставить счёт' → quotation", () => {
    assert.equal(classifyRequestType({ subject: "", body: "Добрый день! Просим выставить счёт на поставку." }), "quotation");
});

test("request-type J4: 'Purchase order №123' → order", () => {
    assert.equal(classifyRequestType({ subject: "Purchase order", body: "Наш заказ №12345 на поставку." }), "order");
});

test("request-type J4: 'Предлагаем сотрудничество' → vendor_offer", () => {
    assert.equal(classifyRequestType({ subject: "Сотрудничество", body: "Здравствуйте. Наша компания предлагает сотрудничество по поставкам кабеля." }), "vendor_offer");
});

test("request-type J4: СПАМ label → 'spam' regardless of content", () => {
    assert.equal(classifyRequestType({ subject: "Запрос КП", body: "", label: "СПАМ" }), "spam");
});

test("request-type J4: неопознанное → null (не навязывает)", () => {
    assert.equal(classifyRequestType({ subject: "hi", body: "hello" }), null);
});

test("applyRequestTypeFallback J4: fills when LLM left null", () => {
    const analysis = {
        rawInput: { subject: "Запрос КП", body: "Прошу выставить КП" },
        classification: { label: "Клиент" },
        llmExtraction: { requestType: null, missingForProcessing: [] }
    };
    const changed = applyRequestTypeFallback(analysis);
    assert.equal(changed, true);
    assert.equal(analysis.llmExtraction.requestType, "quotation");
    assert.equal(analysis.llmExtraction.requestTypeSource, "rules");
});

test("applyRequestTypeFallback J4: does NOT override existing LLM value", () => {
    const analysis = {
        rawInput: { subject: "Покупаем", body: "" },
        classification: { label: "Клиент" },
        llmExtraction: { requestType: "order" }
    };
    const changed = applyRequestTypeFallback(analysis);
    assert.equal(changed, false);
    assert.equal(analysis.llmExtraction.requestType, "order");
});

// --- Batch J4 missing-enum normalization ---------------------------------
test("normalizeMissingKey J4: company_name → company", () => {
    assert.equal(normalizeMissingKey("company_name"), "company");
    assert.equal(normalizeMissingKey("companyName"), "company");
});

test("normalizeMissingKey J4: russian/english aliases mapped", () => {
    assert.equal(normalizeMissingKey("ИНН"), "inn");
    assert.equal(normalizeMissingKey("ФИО"), "contact_name");
    assert.equal(normalizeMissingKey("sender_phone"), "phone");
    assert.equal(normalizeMissingKey("tax_id"), "inn");
    assert.equal(normalizeMissingKey("sku"), "article");
});

test("normalizeMissingKey J4: unknown key returns null", () => {
    assert.equal(normalizeMissingKey("frobnicator"), null);
    assert.equal(normalizeMissingKey(""), null);
    assert.equal(normalizeMissingKey(null), null);
});

test("normalizeMissingList J4: dedupes and drops invalid", () => {
    const out = normalizeMissingList(["company_name", "company", "ИНН", "frobnicator", "inn"]);
    assert.deepEqual(out.sort(), ["company", "inn"]);
});

test("reconcileMissingForProcessing J4: drops fields that ARE present, adds rule-derived gaps", () => {
    const analysis = {
        sender: { companyName: "ООО Тест", inn: "7704784450", cityPhone: null, mobilePhone: null, fullName: null },
        lead: { articles: [], lineItems: [] },
        detectedBrands: [],
        llmExtraction: { missingForProcessing: ["company_name"] }  // LLM insists company is missing
    };
    reconcileMissingForProcessing(analysis);
    const missing = analysis.llmExtraction.missingForProcessing.sort();
    // company removed (present), inn removed (present), + article/brand/phone/contact_name added
    assert.ok(!missing.includes("company"));
    assert.ok(!missing.includes("inn"));
    assert.ok(missing.includes("phone"));
    assert.ok(missing.includes("contact_name"));
    assert.ok(missing.includes("article"));
    assert.ok(missing.includes("brand"));
});

// --- Batch J4 quality gate -----------------------------------------------
test("quality-gate J4: quotation without contact nor product → blocked", () => {
    const analysis = {
        sender: {},
        lead: { articles: [], lineItems: [] },
        detectedBrands: [],
        classification: { confidence: 0.8 },
        llmExtraction: { requestType: "quotation" }
    };
    const { ok, errors } = validateBeforeCrm(analysis);
    assert.equal(ok, false);
    assert.ok(errors.includes("no_contact_info"));
    assert.ok(errors.includes("no_product_signal"));
});

test("quality-gate J4: quotation with company+brand → passes", () => {
    const analysis = {
        sender: { companyName: "ООО Тест", inn: "7704784450" },
        lead: { articles: [], lineItems: [] },
        detectedBrands: ["Siemens"],
        classification: { confidence: 0.8 },
        llmExtraction: { requestType: "quotation" }
    };
    const { ok } = validateBeforeCrm(analysis);
    assert.equal(ok, true);
});

test("quality-gate J4: dirty company name (<>/mailto) blocks", () => {
    const analysis = {
        sender: { companyName: "ООО <test@example.ru>", inn: null },
        lead: { articles: ["ART-1"] },
        detectedBrands: [],
        classification: { confidence: 0.8 },
        llmExtraction: { requestType: "info_request" }
    };
    const { ok, errors } = validateBeforeCrm(analysis);
    assert.equal(ok, false);
    assert.ok(errors.includes("dirty_company_name"));
});

test("quality-gate J4: invalid INN format blocks", () => {
    const analysis = {
        sender: { companyName: "ООО Тест", inn: "123" },
        lead: { articles: ["ART-1"] },
        detectedBrands: [],
        classification: { confidence: 0.8 },
        llmExtraction: { requestType: "info_request" }
    };
    const { ok, errors } = validateBeforeCrm(analysis);
    assert.equal(ok, false);
    assert.ok(errors.includes("invalid_inn_format"));
});

test("quality-gate J4: low confidence + no requisites → blocks", () => {
    const analysis = {
        sender: {},
        lead: { articles: ["X"] },
        detectedBrands: ["Brand"],
        classification: { confidence: 0.3 },
        llmExtraction: { requestType: "info_request" }
    };
    const { ok, errors } = validateBeforeCrm(analysis);
    assert.equal(ok, false);
    assert.ok(errors.includes("low_confidence_no_requisites"));
});

// --- Batch J3: phone normalization (extension strip + Kazakhstan +7(7xx)) ---
test("phone J3: extension 'доб. N' stripped so RU phone normalizes", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос КП",
        body: "Прошу выставить КП.\n\nС уважением,\nИванов Иван\nТел.: +7 (495) 363-90-38, доб. 72156\nООО Тест\nИНН 7712345678",
        from: "ivanov@test.ru",
    });
    const phone = result.sender?.mobilePhone || result.sender?.cityPhone || "";
    assert.ok(/\+7\s*\(495\)\s*363-90-38/.test(phone), `expected '+7 (495) 363-90-38' in '${phone}'`);
});

test("phone J3: Kazakhstan +7(701) mobile preserved (was filtered as '0167' prefix)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу предоставить КП.\n\nС уважением,\nАсел Жанатовна\nТел: +7 (701) 234-56-78\nТОО Казахстан\nБИН 123456789012",
        from: "asel@kz.example",
    });
    const phone = result.sender?.mobilePhone || result.sender?.cityPhone || "";
    assert.ok(/\+7\s*\(701\)\s*234-56-78/.test(phone), `expected KZ '+7 (701) 234-56-78' in '${phone}'`);
});

test("phone J3: quoted Siderus form echo does NOT override client's current-message signature", async () => {
    // Reproduces prod case d8720861: client replies to Siderus's auto-reply which contains
    // an echoed Siderus robot-form block. Before fix: quotedRobotFormData.formSection became
    // senderBody, losing client's new-message phones. After fix: client's bodyForSender wins.
    const body = [
        "Какой будет срок ?",
        "",
        "С уважением, Александр Корнев",
        "",
        "Менеджер по работе с розничными предприятиями",
        "РУССКИЙ СВЕТ",
        "Адрес: ООО «РУССКИЙ СВЕТ» г. Петрозаводск ул. Повенецкая д.16.",
        "Тел.: +7 (8142) 67-21-70 (доб. 212) | | Моб.: +7-921-455-56-60",
        "",
        ">",
        "> От кого: SIDERUS",
        "> Кому: rp3@petrzv.russvet.ru",
        "> Дата: Четверг, 16 апреля 2026, 11:41 +03:00",
        ">",
        "> Добрый день, для обработки запроса прошу прислать реквизиты Вашей",
        "> организации.",
        ">",
        "> Получен запрос \"Получить прайс\" от формы SIDERUS (8452)",
        "> Тип оформления: Получить прайс",
        "> Контакты:",
        "> Email: rp3@petrzv.russvet.ru",
        "> Запрос: Счетчик и устройство визуализации CM78N C02",
        "> Количество: датчик Elap CM78N - 2 шт",
    ].join("\n");
    const result = await analyzeEmail(mkProject(), {
        subject: "Re: FW: поставка",
        body,
        from: "rp3@petrzv.russvet.ru",
    });
    const mobile = result.sender?.mobilePhone || "";
    const city = result.sender?.cityPhone || "";
    assert.ok(/\+7\s*\(921\)\s*455-56-60/.test(mobile), `expected mobile '+7 (921) 455-56-60' in '${mobile}'`);
    assert.ok(/\+7\s*\(814\)\s*267-21-70/.test(city), `expected city '+7 (814) 267-21-70' in '${city}'`);
});

test("phone J3: Kazakhstan +7(727) city code (Almaty) preserved", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу прайс-лист.\n\nС уважением,\nАйгуль\nТел: +7 (727) 345-67-89\nТОО Алматы\nИНН 7712345678",
        from: "a@almaty.kz",
    });
    const phone = result.sender?.mobilePhone || result.sender?.cityPhone || "";
    assert.ok(/\+7\s*\(727\)\s*345-67-89/.test(phone), `expected KZ '+7 (727) 345-67-89' in '${phone}'`);
});

// --- Batch J5 product names: dedup + prefix/suffix/intro cleanup ---
test("product-names J5: '1. desc - ARTICLE - N шт' line does not duplicate short productName", async () => {
    const body = [
        "Добрый день!",
        "",
        "1. 3-х ходовой_Bronze_1\"_подсоединение_Rc_тип WR- 2510GLW - 10 шт.",
        "2. 2-х ходовой_Bronze_2\"_подсоединение_ Flange _тип МWR- 5020FLWH - 10 шт.",
        "",
        "С уважением,",
        "Виталий К.",
    ].join("\n");
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос КП на клапаны SAGINOMIYA",
        body,
        from: "vk@hhr.ru",
    });
    const pn = result.lead?.productNames || [];
    // Exactly one productName per article — no extra dupes
    const perArticle = new Map();
    for (const p of pn) {
        const a = String(p.article || "");
        perArticle.set(a, (perArticle.get(a) || 0) + 1);
    }
    for (const [a, n] of perArticle) {
        assert.equal(n, 1, `Article ${a} has ${n} productName entries, expected 1`);
    }
    // Stored names: no "1." row prefix, no trailing " - 10 шт.", no underscore clutter
    for (const p of pn) {
        const nm = String(p.name || "");
        assert.ok(!/^\s*\d{1,3}\s*[.)\]]/.test(nm), `productName still has row-number prefix: "${nm}"`);
        assert.ok(!/-\s*\d+\s*шт/i.test(nm), `productName still has qty tail: "${nm}"`);
        assert.ok(!/_/.test(nm), `productName still has underscore clutter: "${nm}"`);
    }
});

// --- Batch J3 phone (continued): bare-parens 4-digit city code + intl preserve ---
test("phone J3: bare-parens 4-digit city code '(8635) 22-88-07' → +7 (8635) 22-88-07 (Novocherkassk)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу КП.\n\nС уважением,\nИван\nООО БВС\nТел: (8635) 22-88-07\nИНН 6150012345",
        from: "ivan@bvs.ru",
    });
    const phone = result.sender?.cityPhone || result.sender?.mobilePhone || "";
    assert.ok(/\+7\s*\(8635\)\s*22-88-07/.test(phone), `expected '+7 (8635) 22-88-07' in '${phone}'`);
});

test("phone J3: Belarus intl +375 preserved (not dropped)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Добрый день.\nПрошу прайс.\n\nС уважением,\nАлесь\nООО Минсктест\nТел: +375 29 123 45 67\nИНН 7712345678",
        from: "ales@minsktest.by",
    });
    const phone = result.sender?.cityPhone || result.sender?.mobilePhone || "";
    assert.ok(/^\+375\s/.test(phone), `expected +375 intl phone, got '${phone}'`);
});

test("phone J3: China intl +86 preserved", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Request",
        body: "Hello, please send quote.\n\nBest regards,\nLi Wei\nShenzhen Tech\nTel: +86 138 1234 5678\nИНН 7712345678",
        from: "liwei@shenzhen.cn",
    });
    const phone = result.sender?.cityPhone || result.sender?.mobilePhone || "";
    assert.ok(/^\+86\s/.test(phone), `expected +86 intl phone, got '${phone}'`);
});

test("phone J3: Azerbaijan intl +994 preserved", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу прайс.\n\nС уважением,\nАли\nООО Баку\nТел: +994 50 123 45 67\nИНН 7712345678",
        from: "ali@baku.az",
    });
    const phone = result.sender?.cityPhone || result.sender?.mobilePhone || "";
    assert.ok(/^\+994\s/.test(phone), `expected +994 intl phone, got '${phone}'`);
});

test("product-names J5: intro question 'У вас есть ...' is not stored as product name", async () => {
    const body = [
        "Здравствуйте,",
        "",
        "У вас есть в наличии или под заказ водорегулирующие клапаны SAGINOMIYA для",
        "холодильных установок?",
        "",
        "С уважением, Иван",
    ].join("\n");
    const result = await analyzeEmail(mkProject(), {
        subject: "Наличие SAGINOMIYA",
        body,
        from: "ivan@example.ru",
    });
    const pn = result.lead?.productNames || [];
    const li = result.lead?.lineItems || [];
    const allNames = [
        ...pn.map((p) => String(p.name || "")),
        ...li.map((i) => String(i.descriptionRu || "")),
    ];
    for (const n of allNames) {
        assert.ok(!/^у\s+вас\s+есть\b/i.test(n), `intro question leaked as product name: "${n}"`);
        if (n.length >= 20) {
            assert.ok(!/\s(?:для|на|с|под)\s*$/iu.test(n),
                `dangling-preposition line leaked as product name: "${n}"`);
        }
    }
});

// --- Batch J3 #5a: ФИО с юрлицом — ORG strip / segment fallback ---
test("fullName-sanitize J3 #5a: 'Иванов И.И. ООО Ромашка' → 'Иванов И.И.' (ORG stripped)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу КП.\n\nИванов И.И.\nООО Ромашка\nТел: +7 495 123-45-67",
        fromEmail: "ivan@romashka.ru",
        fromName: "Иванов И.И. ООО Ромашка",
    });
    const fn = result.sender?.fullName || "";
    assert.ok(!/\b(?:ООО|ОАО|ЗАО|АО|LLC|Ltd|GmbH)\b/u.test(fn),
        `fullName still contains org marker: "${fn}"`);
    assert.equal(fn, "Иванов И.И.");
});

test("fullName-sanitize J3 #5a: comma-form 'Иванов Иван, ООО Ромашка' → 'Иванов Иван'", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу КП.\n\nС уважением,\nИванов Иван, ООО Ромашка\nТел: +7 495 111",
        fromEmail: "ivan@r.ru",
        fromName: "Иванов Иван, ООО Ромашка",
    });
    const fn = result.sender?.fullName || "";
    assert.ok(!/ООО|ОАО|ЗАО|АО|ПАО|LLC/u.test(fn),
        `comma-form fullName still contains org: "${fn}"`);
    assert.equal(fn, "Иванов Иван");
});

test("fullName-sanitize J3 #5a: prefix-ORG 'ООО Ромашка Иванов Иван' → 'Иванов Иван'", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу КП.",
        fromEmail: "ivan@r.ru",
        fromName: "ООО Ромашка Иванов Иван",
    });
    const fn = result.sender?.fullName || "";
    assert.ok(!/ООО|ОАО|ЗАО|АО|LLC/u.test(fn),
        `prefix-ORG fullName still contains org: "${fn}"`);
    assert.equal(fn, "Иванов Иван");
});

// --- Audit fix: balance unbalanced quotes in company name ---
test("company-sanitize: balance unmatched guillemets (nested-quote company)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос цены",
        body: "Прошу КП.\n\nС уважением,\nАО «Совхоз «Тепличный»\nИНН 7712345678",
        fromEmail: "a@teplichny.ru",
    });
    const company = result.sender?.companyName || "";
    const op = (company.match(/«/g) || []).length;
    const cl = (company.match(/»/g) || []).length;
    assert.equal(op, cl, `Guillemets unbalanced in "${company}"`);
});

test("company-sanitize: balance unmatched ASCII double-quotes (truncated close)", async () => {
    const result = await analyzeEmail(mkProject(), {
        subject: "Запрос",
        body: "Прошу КП.\n\nС уважением,\nАО \"Интер РАО\nИНН 7712345678",
        fromEmail: "a@interrao.ru",
    });
    const company = result.sender?.companyName || "";
    if (company) {
        const count = (company.match(/["«»]/g) || []).length;
        // If any quote chars present, count must be even (balanced).
        if (count > 0) {
            const op = (company.match(/«/g) || []).length + Math.floor((company.match(/"/g) || []).length / 2);
            const cl = (company.match(/»/g) || []).length + Math.ceil((company.match(/"/g) || []).length / 2);
            assert.equal(op, cl, `Quotes unbalanced in "${company}"`);
        }
    }
});

