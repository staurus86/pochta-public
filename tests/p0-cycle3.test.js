// p0-cycle3.test.js — end-to-end regression for Cycle 3 bypass-path fixes.
// Cycle 1+2 fixed the monolith path (isObviousArticleNoise).
// Cycle 3 adds a post-extraction safety net that catches leaks from
// form-parser / LLM / attachment paths that don't call isObviousArticleNoise.
// Each test uses analyzeEmail so it exercises the full pipeline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = {
    id: "p-test",
    type: "email-parser",
    ownInns: ["7702802784"], // So sender INN of test company is own-inn (not added)
    ownBrands: [],
};

test("CYCLE3-A3-form: Siderus form ИНН (12-digit) NOT extracted as article", () => {
    const result = analyzeEmail(project, {
        fromEmail: "robot@siderus.ru",
        subject: 'Заполнена форма "Товар под заказ" на сайте SIDERUS',
        body: `Заполнена форма "Товар под заказ" на сайте SIDERUS

Имя посетителя: Михаил
Email: mihail@example.ru
Телефон: +7 999 123-45-67
Компания: ООО "Пример"
ИНН: 194000145952
Артикул: CD20-SFA
Количество: 3

Запрос отправлен: 2026-04-20 12:00`,
    });
    const articles = result.lead.articles || [];
    assert.ok(!articles.includes("194000145952"), `12-digit ИНН leaked into articles: ${JSON.stringify(articles)}`);
    // Real article must still be extracted
    assert.ok(articles.some((a) => /CD20-SFA/i.test(a)), `Legit article missing: ${JSON.stringify(articles)}`);
});

test("CYCLE3-A3-form: Siderus form 10-digit ИНН NOT leaked (no strict Арт.: label adjacency)", () => {
    const result = analyzeEmail(project, {
        fromEmail: "robot@siderus.ru",
        subject: 'Заполнена форма "Товар под заказ" на сайте SIDERUS',
        body: `Заполнена форма "Товар под заказ" на сайте SIDERUS

Имя посетителя: Иван
Компания: ООО "Косвик"
ИНН: 2101262828
Артикул: 9Ar-50142307700

Запрос отправлен: 2026-04-20 12:00`,
    });
    const articles = result.lead.articles || [];
    assert.ok(!articles.includes("2101262828"), `10-digit ИНН leaked: ${JSON.stringify(articles)}`);
    assert.ok(articles.some((a) => /9Ar-50142307700/i.test(a)), `Legit article missing: ${JSON.stringify(articles)}`);
});

test("CYCLE3-A3-form: 10-digit WITH strict Арт.: label adjacency preserved (no regression)", () => {
    // Same 10-digit number, but with "Арт.: 9510451992" adjacency — must still pass.
    // This matches existing test "parses vertical article-unit-quantity blocks...".
    const result = analyzeEmail(project, {
        fromEmail: "buyer@it-mo.ru",
        subject: "Заявка",
        body: `Узел
Арт.: 9510451992
шт.
1`,
    });
    const lineArticles = (result.lead.lineItems || []).map((i) => i.article);
    assert.ok(lineArticles.includes("9510451992"), `Strict-labeled 10-digit must survive: ${JSON.stringify(lineArticles)}`);
});

test("CYCLE3-A-size-triple: 58x98x14 / 300x620 NOT extracted as articles", () => {
    const result = analyzeEmail(project, {
        fromEmail: "customer@example.ru",
        subject: "Взрывной клапан KER",
        body: `Добрый день,

Интересует взрывной клапан KER 300x620.
Уплотнитель 58x98x14 к нему же.
Размер 27x40 для фланца.

С уважением`,
    });
    const articles = result.lead.articles || [];
    assert.ok(!articles.some((a) => /^\d{1,3}[xх×*/]\d{1,3}/.test(a)), `Size-triple leaked: ${JSON.stringify(articles)}`);
});

test("CYCLE3-A5-tiny-digit: bare 3-digit (270, 190) NOT extracted as articles", () => {
    const result = analyzeEmail(project, {
        fromEmail: "customer@example.ru",
        subject: "Заявка на запчасти",
        body: `Здравствуйте,

Нужны запчасти для оборудования JSW.
270 шт. клапанов 190 штук прокладок 195 единиц уплотнений.

С уважением`,
    });
    const articles = result.lead.articles || [];
    assert.ok(!articles.includes("270"), `270 leaked: ${JSON.stringify(articles)}`);
    assert.ok(!articles.includes("190"), `190 leaked: ${JSON.stringify(articles)}`);
    assert.ok(!articles.includes("195"), `195 leaked: ${JSON.stringify(articles)}`);
});

test("CYCLE3-A5-truncation: bare 810 (truncation remnant of 810.00.00.026) NOT leaked as standalone article", () => {
    // Note: separately, the article extractor currently fails to extract the full
    // dotted code "810.00.00.026" (truncation bug — scope of future cycle).
    // This test only asserts that the bare "810" remnant is filtered out — which
    // is the user-visible false positive we observed in prod.
    const result = analyzeEmail(project, {
        fromEmail: "customer@example.ru",
        subject: "Agie Charmilles Пневмоцилиндр",
        body: `Agie Charmilles Пневмоцилиндр Арт. 810.00.00.026 - 2шт`,
    });
    const articles = result.lead.articles || [];
    assert.ok(!articles.includes("810"), `Bare 810 leaked from truncation: ${JSON.stringify(articles)}`);
});

test("CYCLE3: legit 3-digit with strict Арт.: label adjacency IS preserved", () => {
    // Edge case: someone writes "Арт.: 810" — this is a real 3-digit article label.
    // Must pass (escape hatch via hasStrictArticleLabel).
    const result = analyzeEmail(project, {
        fromEmail: "customer@example.ru",
        subject: "Заявка",
        body: `Нужен манжет.
Арт.: 810
Количество 1 шт.`,
    });
    const articles = result.lead.articles || [];
    assert.ok(articles.includes("810"), `Strict-labeled 3-digit must survive: ${JSON.stringify(articles)}`);
});
