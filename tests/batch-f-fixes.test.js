import assert from "node:assert/strict";
import { analyzeEmail, isObviousArticleNoise } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

// Wake KB lazy init.
void detectionKb;

function runTest(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

const project = {
    mailbox: "inbox@example.com",
    brands: [
        "Schischek",
        "Endress & Hauser",
        "Micro Motion"
    ],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

// ------------------------------------------------------------
// P18 — P15 body-grounding gate applies to lead + SPAM paths too
// ------------------------------------------------------------

runTest("P18: Клиент WordPress schischek form — body has no brand → lead.detectedBrands drops Schischek", () => {
    // Mirrors baseline rows #1740-1742. Previously P15 dropped 'Schischek' from
    // classification.detectedBrands but lead.detectedBrands retained it via its
    // own extractLead path; the merge then re-exposed it.
    const analysis = analyzeEmail(project, {
        fromName: "WordPress",
        fromEmail: "wordpress@schischek.laskovaa.beget.tech",
        subject: "Отправка заявки с сайта schischek",
        attachments: "",
        body: "<b>Заявка с формы обратной связи</b>"
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b.includes("schischek")),
        `Expected no 'Schischek' in lead, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
    const topBrands = (analysis.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!topBrands.some((b) => b.includes("schischek")),
        `Expected no 'Schischek' at top-level, got: ${JSON.stringify(analysis.detectedBrands)}`);
});

runTest("P18: Клиент WordPress endress form — body has no brand → lead drops Endress/Hauser", () => {
    // Mirrors baseline row #1739 (empty body) — lead-level leak.
    const analysis = analyzeEmail(project, {
        fromName: "WordPress",
        fromEmail: "wordpress@endress.laskovaa.beget.tech",
        subject: "Отправка заявки с сайта Endress - Hauser",
        attachments: "",
        body: "<b>Заявка с формы обратной связи</b>"
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b.includes("endress") || b.includes("hauser")),
        `Expected no 'Endress'/'Hauser' in lead, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P18: СПАМ WordPress form — gate still drops subject-only brand leak", () => {
    // Mirrors baseline rows #1751, #1755. СПАМ label early-returns so the
    // classification gate never ran; Batch F adds a matching body-only gate
    // on the SPAM path after applySenderProfileHints.
    const analysis = analyzeEmail(project, {
        fromName: "WordPress",
        fromEmail: "wordpress@endress-hauser.pro",
        subject: "Отправка заявки с сайта Endress - Hauser",
        attachments: "",
        body: "<b>Заявка с формы обратной связи</b> <p>Имя: тест2</p><p>Телефон: +7 (899) 999-99-99</p>"
    });
    const brands = (analysis.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b.includes("endress") || b.includes("hauser")),
        `Expected no 'Endress'/'Hauser' for SPAM form, got: ${JSON.stringify(analysis.detectedBrands)}`);
});

runTest("P18: body DOES mention brand — brand IS still kept (no regression)", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос на Schischek",
        attachments: "",
        body: "Добрый день. Нужна цена на Schischek ExMax-15. Спасибо."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.some((b) => b.includes("schischek")),
        `Expected 'Schischek' to be kept, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

// ------------------------------------------------------------
// P19 — "2026" article from quoted-reply date headers
// ------------------------------------------------------------

runTest("P19: quoted-reply date '19 May 2026' must NOT yield article '2026'", () => {
    // Mirrors baseline row #851. "2026" leaked via the \d{4,9} pattern in
    // extractBrandAdjacentCodes because only DATE_LIKE_PATTERN (which checks
    // slashed dates) was consulted, not isObviousArticleNoise year-filter.
    const analysis = analyzeEmail(project, {
        fromName: "Tatyana",
        fromEmail: "kibirova@example.com",
        subject: "TROX",
        attachments: "",
        body: [
            "-------- Перенаправленное сообщение --------",
            "Date: Thu, 19 May 2026 10:22:19 +0300",
            "Добрый день, нужна цена по TROX VFL-F-S."
        ].join("\n")
    });
    const articles = (analysis.lead?.articles || []).map(String);
    assert.ok(!articles.includes("2026"),
        `Expected no bare '2026' article, got: ${JSON.stringify(articles)}`);
});

runTest("P19: forwarded 'Fri, 13 Mar 2026' date header yields no year article", () => {
    // Mirrors baseline row #1025.
    const analysis = analyzeEmail(project, {
        fromName: "ПромКомплектКоми",
        fromEmail: "promcomplect@inbox.ru",
        subject: "Fwd: FW: Запрос",
        attachments: "",
        body: [
            "-------- Перенаправленное сообщение --------",
            "Тема: Re: FW: Запрос",
            "Дата: Fri, 13 Mar 2026 15:31:05 +0300",
            "От: ПромКомплектКоми <promcomplect@inbox.ru>",
            "Кому: info@siderus.ru",
            "Добрый день. Нужна цена на деталь."
        ].join("\n")
    });
    const articles = (analysis.lead?.articles || []).map(String);
    assert.ok(!articles.some((a) => /^(19|20)\d{2}$/.test(a)),
        `Expected no pure-year article from quoted date, got: ${JSON.stringify(articles)}`);
});

runTest("P19: legitimate 8-digit catalog number still extracted (regression)", () => {
    // Regression: ensure the year-filter doesn't kill real long-digit articles.
    // Use brand-adjacent form ("SKF 12345678") which is the exact path we patched.
    const projectSkf = { ...project, brands: ["SKF"] };
    const analysis = analyzeEmail(projectSkf, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Нужна SKF 12345678 в количестве 3 шт."
    });
    const articles = (analysis.lead?.articles || []).map(String);
    assert.ok(articles.includes("12345678"),
        `Expected '12345678' to still be extracted, got: ${JSON.stringify(articles)}`);
});

// ------------------------------------------------------------
// P20 — residual multi-word brand ghosts
// ------------------------------------------------------------

runTest("P20: 'UV sensor' body must NOT emit SENSOR brand", () => {
    // Mirrors baseline row #341.
    const analysis = analyzeEmail(project, {
        fromName: "Ansar",
        fromEmail: "ansar@example.com",
        subject: "заявка на UV sensor",
        attachments: "",
        body: "Прошу вас предоставить цены на UV SENSOR BERSON в количестве 2 ед."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "sensor"),
        `Expected no bare 'SENSOR' brand, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P20: body '1 pc sensor' must NOT emit SENSOR brand", () => {
    // Mirrors baseline row #627.
    const analysis = analyzeEmail(project, {
        fromName: "Larisa",
        fromEmail: "l@example.com",
        subject: "5411 SAGINOMIYA",
        attachments: "",
        body: "Подскажите, пожалуйста, по ценам на ACB-2UB136 SAGINOMIYA 1 pc sensor"
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "sensor"),
        `Expected no bare 'SENSOR' brand, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P20: Micro Motion CMF300 body DOES keep Micro Motion (no regression)", () => {
    // Mirrors baseline row #626 — multi-token legit phrase must stay.
    const analysis = analyzeEmail(project, {
        fromName: "Denis",
        fromEmail: "d@example.com",
        subject: "Запрос КП",
        attachments: "",
        body: "Добрый день, прошу прислать КП на Кориолисовый расходомер Micro Motion CMF300 M392N2FZEZZZ - 1 шт."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.some((b) => b === "micro motion" || b.includes("micro motion")),
        `Expected 'Micro Motion' kept, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P20: hyphenated brand 'Check-All Valve' first-token in conflict set → not matched by bare 'valve'", () => {
    // Mirrors baseline-style row: "check valve" in body must not pull in
    // "Check-All Valve" through its hyphen-split first token.
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Нужен check valve по артикулу ABC-123 в количестве 4 шт."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "check-all valve" || b === "check all valve"),
        `Expected no 'Check-All Valve', got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P20: 'seals' / 'dichtungen' generic words must NOT match Corteco/Simrit/Nilos aliases", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Site",
        fromEmail: "robot@siderus.ru",
        subject: "Заполнена форма",
        attachments: "",
        body: [
            "Заполнена форма 'Товар под заказ' на сайте SIDERUS",
            "Имя посетителя: Тест",
            "Название товара: GUN, LV227, 0.6MM, 24VDC, CHEM.RES.SEALS",
            "Количество: 1 шт"
        ].join("\n")
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => ["corteco", "simrit", "nilos ring", "nilos-ring"].includes(b)),
        `Expected no Corteco/Simrit/Nilos from 'SEALS' token, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});
