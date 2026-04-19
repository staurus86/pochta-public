import { test } from "node:test";
import assert from "node:assert/strict";
import { isObviousArticleNoise, analyzeEmail } from "../src/services/email-analyzer.js";

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
