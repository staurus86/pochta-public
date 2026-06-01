import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSenderFields } from "../src/services/email-analyzer.js";

// Post-deploy audit (2026-06-01): bank companyNames survived the sanitizeCompanyName bank fix
// because they enter from company_directory / sender_profile lookups (verified: sources.company
// = "company_directory"/"sender_profile") that assign companyName WITHOUT running the cleaner.
// Fix: a BANK-ONLY catch-all in validateSenderFields (NOT the full cleaner — its text-extraction
// trims misfire on already-resolved directory names like "ТЕХНИЧЕСКИЙ ЦЕНТР ЭКСПОС").

function coAfter(companyName) {
    const s = { companyName, sources: { company: "company_directory" } };
    validateSenderFields(s);
    return s.companyName;
}

test("company-bypass: банк из справочника/профиля отбрасывается", () => {
    assert.equal(coAfter("ПАО Сбербанк г."), null);
    assert.equal(coAfter("АО «АЛЬФА-БАНК»"), null);
    assert.equal(coAfter("ЗАО БАНК ВТБ"), null);
});

test("company-bypass: реальные компании НЕ затрагиваются (нет over-trim)", () => {
    // These were false-positives when the FULL cleaner ran as catch-all — bank-only leaves them.
    assert.equal(coAfter("ТЕХНИЧЕСКИЙ ЦЕНТР ЭКСПОС"), "ТЕХНИЧЕСКИЙ ЦЕНТР ЭКСПОС");
    assert.equal(coAfter("ТОРГОВЫЙ ДОМ ПРОМТОРГ"), "ТОРГОВЫЙ ДОМ ПРОМТОРГ");
    assert.equal(coAfter("ИНЖЕНЕРНЫЙ ЦЕНТР ЕВРОПЕЙСКАЯ ЭЛЕКТРОТЕХНИКА"), "ИНЖЕНЕРНЫЙ ЦЕНТР ЕВРОПЕЙСКАЯ ЭЛЕКТРОТЕХНИКА");
    assert.equal(coAfter("ООО «ПроВоздух»"), "ООО «ПроВоздух»");
    // "Точка" deliberately excluded from bank list → real "Точка плавления" survives.
    assert.equal(coAfter("ООО «Точка плавления»"), "ООО «Точка плавления»");
});
