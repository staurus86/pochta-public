import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCompanyName } from "../src/services/email-analyzer.js";

// Manager ground-truth (1ab382c3): companyName = "АО ТИНЬКОФФ БАНК" pulled from attachment
// payment requisites — a bank is never the industrial client. An existing reject at line ~4766
// used \b around Cyrillic, which JS never matches → 20 bank companyNames slipped through
// (Тинькофф/Сбербанк/Альфа-Банк/ВТБ/Райффайзенбанк). Corpus: 20 distinct, 0 false positives.

test("company-bank: банк из реквизитов отбрасывается (Cyrillic-safe)", () => {
    assert.equal(sanitizeCompanyName('АО "ТИНЬКОФФ БАНК"'), null);
    assert.equal(sanitizeCompanyName("ПАО Сбербанк"), null);
    assert.equal(sanitizeCompanyName("ПАО Сбербанк г."), null);
    assert.equal(sanitizeCompanyName("АО «Альфа-Банк»"), null);
    assert.equal(sanitizeCompanyName("АО «РАЙФФАЙЗЕНБАНК»"), null);
    assert.equal(sanitizeCompanyName("ЗАО БАНК ВТБ"), null);
});

test("company-bank: реальные компании не затрагиваются", () => {
    assert.equal(sanitizeCompanyName("ООО «ПроВоздух»"), "ООО «ПроВоздух»");
    assert.equal(sanitizeCompanyName("АО Волжский Оргсинтез"), "АО Волжский Оргсинтез");
    assert.equal(sanitizeCompanyName("ООО «ТехРесурс»"), "ООО «ТехРесурс»");
});
