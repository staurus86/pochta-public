import assert from "node:assert/strict";
import { analyzeEmail, isObviousArticleNoise } from "../src/services/email-analyzer.js";

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
        "Fisher Controls",
        "Pressure Tech",
        "High Perfection Tech",
        "Check Point",
        "Select Automation",
        "Micro Motion",
        "Vahle"
    ],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

// ------------------------------------------------------------
// P15 — body-grounding for from-domain/subject brand leaks
// ------------------------------------------------------------

runTest("P15: WordPress schischek form — body has no 'schischek', brand must NOT appear", () => {
    const analysis = analyzeEmail(project, {
        fromName: "WordPress",
        fromEmail: "wordpress@schischek.laskovaa.be",
        subject: "Отправка заявки с сайта schischek",
        attachments: "",
        body: "<b>Заявка с формы обратной связи</b> <p>Имя: тест2</p><p>Телефон: +7 (899) 999-99-99</p>"
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b.includes("schischek")),
        `Expected no 'Schischek' leak, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P15: WordPress endress-hauser form — body has no brand mention, no leak", () => {
    const analysis = analyzeEmail(project, {
        fromName: "WordPress",
        fromEmail: "wordpress@endress-hauser.pro",
        subject: "Отправка заявки с сайта endress-hauser",
        attachments: "",
        body: "<b>Заявка с формы обратной связи</b> <p>Имя: тест</p><p>Телефон: +7 999 999-99-99</p>"
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b.includes("endress") || b.includes("hauser")),
        `Expected no 'Endress'/'Hauser' leak, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P15: body DOES mention brand — brand IS kept", () => {
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

runTest("P15: subject-only mention with empty body — brand dropped", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Noreply",
        fromEmail: "noreply@example.com",
        subject: "Fisher alerts",
        attachments: "",
        body: "Добрый день. Общий вопрос, нет запчастей."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "fisher" || b === "fisher controls"),
        `Expected no 'Fisher' leak from subject-only, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

// ------------------------------------------------------------
// P16: final sanitize pass against Russian product-category noise
// ------------------------------------------------------------

runTest("P16: 'Диафрагменный' as form-article → NOT present in lead.articles", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Site",
        fromEmail: "robot@siderus.ru",
        subject: "Заявка с сайта",
        attachments: "",
        body: [
            "Заявка с формы обратной связи",
            "Имя: Иван",
            "Телефон: +7 999 000-00-00",
            "Email: ivan@example.com",
            "Продукт: Диафрагменный",
            "Сообщение: нужен насос"
        ].join("\n")
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a));
    assert.ok(!articles.some((a) => /^Диафрагмен/i.test(a)),
        `Expected 'Диафрагменный' filtered, got: ${JSON.stringify(articles)}`);
});

runTest("P16: 'Конический' / 'Счетчик' / 'Ручки-барашки' pure-Cyrillic noise all filtered", () => {
    for (const noiseWord of ["Конический", "Счетчик", "Ручки-барашки", "Зажимной", "Метчики", "Шаровые"]) {
        const analysis = analyzeEmail(project, {
            fromName: "Site",
            fromEmail: "robot@siderus.ru",
            subject: "Заявка с сайта",
            attachments: "",
            body: [
                "Заявка с формы обратной связи",
                "Имя: Иван",
                "Телефон: +7 999 000-00-00",
                "Email: ivan@example.com",
                `Продукт: ${noiseWord}`,
                "Сообщение: запрос"
            ].join("\n")
        });
        const articles = (analysis.lead?.articles || []).map((a) => String(a));
        assert.ok(
            !articles.some((a) => new RegExp(`^${noiseWord.slice(0, 5)}`, "i").test(a)),
            `Expected '${noiseWord}' filtered, got: ${JSON.stringify(articles)}`
        );
    }
});

runTest("P16: real article 'ABC-123' with product-category descriptor still passes", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Добрый день. Конический редуктор, артикул ABC-123, 5 шт."
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a).toUpperCase());
    assert.ok(articles.some((a) => a === "ABC-123"),
        `Expected 'ABC-123' kept, got: ${JSON.stringify(analysis.lead?.articles)}`);
});

runTest("P16: isObviousArticleNoise still flags pure-Cyrillic-no-digit words (Batch B regression)", () => {
    for (const w of ["Диафрагменный", "Конический", "Счетчик", "Шаровые", "Зажимной", "Метчики", "Ручки-барашки"]) {
        assert.equal(
            isObviousArticleNoise(w, `Продукт: ${w}`),
            true,
            `Expected noise-flag for '${w}'`
        );
    }
});

// ------------------------------------------------------------
// P17: extended BRAND_FIRST_TOKEN_CONFLICT
// ------------------------------------------------------------

runTest("P17: body with 'pressure sensor' must NOT emit 'Pressure Tech'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Нужен pressure sensor по артикулу ABC-123, 3 штуки."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "pressure tech"),
        `Expected no 'Pressure Tech' filler-match, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P17: body with 'high quality tech' must NOT emit 'High Perfection Tech'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Please quote us high quality tech parts for our project, art ABC-123 x 2 шт."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "high perfection tech"),
        `Expected no 'High Perfection Tech', got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P17: body with 'check valve' must NOT emit 'Check Point'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Нужен check valve с артикулом ABC-123 в количестве 4 шт."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(!brands.some((b) => b === "check point"),
        `Expected no 'Check Point' filler-match, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});

runTest("P17: contiguous 'Pressure Tech' body mention DOES match (regression)", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Нужна цена на Pressure Tech PT-500, 5 шт."
    });
    const brands = (analysis.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.some((b) => b.includes("pressure") && b.includes("tech")),
        `Expected 'Pressure Tech' to match, got: ${JSON.stringify(analysis.lead?.detectedBrands)}`);
});
