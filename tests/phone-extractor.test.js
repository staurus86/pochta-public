// Phase 8 — Phone (Телефон) extraction TDD suite.
// Covers:
//   - negative filters: INN, OGRN, KPP, bank account, postal code, article,
//     date, too-short, too-long;
//   - normalizer: strip extension, strip label, canonical +7 output,
//     mobile/landline/fax classification, country guess;
//   - facade: source cascade form > signature > current_message >
//     contact_lines > company_blob > quoted_thread > template_footer >
//     sender_header, misplacement recovery from company blob, debug fields.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isInnLike,
    isOgrnLike,
    isKppLike,
    isBankAccountLike,
    isPostalCodeLike,
    isArticleLike,
    isDateLike,
    isRiskyShort,
    isPhoneDigitCountValid,
} from "../src/services/phone-filters.js";

import {
    stripExtension,
    stripLabel,
    canonicalToPlus7,
    classifyMobileLandline,
    classifyCountry,
    normalizeBareDigits,
} from "../src/services/phone-normalizer.js";

import { extractPhone } from "../src/services/phone-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

test("isInnLike: 10 or 12 digit bare numbers look like INN", () => {
    assert.ok(isInnLike("7707083893"));        // 10-digit legal entity
    assert.ok(isInnLike("500100732259"));      // 12-digit natural person
    assert.ok(!isInnLike("89645510513"));      // 11 digits — phone
    assert.ok(!isInnLike("+79645510513"));     // leading + → phone
});

test("isOgrnLike: 13 or 15 digit bare numbers look like OGRN/OGRNIP", () => {
    assert.ok(isOgrnLike("1027700132195"));
    assert.ok(isOgrnLike("304500116000157"));
    assert.ok(!isOgrnLike("89645510513"));
});

test("isKppLike: 9 digit bare number (with likely region prefix) is KPP", () => {
    assert.ok(isKppLike("770701001"));
    assert.ok(!isKppLike("89645510513"));
});

test("isBankAccountLike: 20 digit sequence is a bank account", () => {
    assert.ok(isBankAccountLike("40702810123450000001"));
    assert.ok(!isBankAccountLike("89645510513"));
});

test("isPostalCodeLike: 6 digit RF postal index", () => {
    assert.ok(isPostalCodeLike("101000"));
    assert.ok(isPostalCodeLike("630090"));
    assert.ok(!isPostalCodeLike("89645510513"));
});

test("isArticleLike: mixed alphanumeric / dash-heavy reference", () => {
    assert.ok(isArticleLike("6ES7 214-1AG40-0XB0"));
    assert.ok(isArticleLike("IRFD9024"));
    assert.ok(!isArticleLike("+7 (495) 123-45-67"));
});

test("isDateLike: dd.mm.yyyy or yyyy-mm-dd", () => {
    assert.ok(isDateLike("12.04.2026"));
    assert.ok(isDateLike("2026-04-12"));
    assert.ok(!isDateLike("+7 (495) 123-45-67"));
});

test("isRiskyShort: fewer than 7 subscriber digits", () => {
    assert.ok(isRiskyShort("12345"));       // 5 digits
    assert.ok(isRiskyShort("123456"));      // 6 digits
    assert.ok(!isRiskyShort("1234567"));    // 7 digits ok
});

test("isPhoneDigitCountValid: 7..15 digits incl country code", () => {
    assert.ok(isPhoneDigitCountValid("+79645510513"));
    assert.ok(isPhoneDigitCountValid("+375291234567"));
    assert.ok(!isPhoneDigitCountValid("+7999"));
    assert.ok(!isPhoneDigitCountValid("+1234567890123456"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer
// ─────────────────────────────────────────────────────────────────────────────

test("stripExtension: preserves extension as separate field", () => {
    const r1 = stripExtension("+7(8352) 62-29-15, доб. 204");
    assert.equal(r1.ext, "204");
    assert.match(r1.main, /\+7|8352|622915/);
    const r2 = stripExtension("+7 495 123 45 67 ext 103");
    assert.equal(r2.ext, "103");
    const r3 = stripExtension("+7 495 123 45 67 доб 500");
    assert.equal(r3.ext, "500");
    const r4 = stripExtension("+7 495 123 45 67 вн. 12");
    assert.equal(r4.ext, "12");
    const r5 = stripExtension("+7 495 123 45 67");
    assert.equal(r5.ext, null);
});

test("stripLabel: detects phone / fax / phone_or_fax types", () => {
    assert.equal(stripLabel("тел. +7 495 123 45 67").type, "phone");
    assert.equal(stripLabel("моб. +7 964 551 05 13").type, "phone");
    assert.equal(stripLabel("факс: +7 495 123 45 68").type, "fax");
    assert.equal(stripLabel("fax +7 495 123 45 68").type, "fax");
    assert.equal(stripLabel("т/ф (3812) 606-232").type, "phone_or_fax");
    assert.equal(stripLabel("tel/fax +7 495 123 45 67").type, "phone_or_fax");
    assert.equal(stripLabel("+7 495 123 45 67").type, "unknown");
});

test("canonicalToPlus7: 8-prefix converts to +7 canonical", () => {
    assert.equal(canonicalToPlus7("8-964-551-05-13"), "+7 (964) 551-05-13");
    assert.equal(canonicalToPlus7("8 (495) 123-45-67"), "+7 (495) 123-45-67");
    assert.equal(canonicalToPlus7("+7 (495) 123-45-67"), "+7 (495) 123-45-67");
    assert.equal(canonicalToPlus7("+79645510513"), "+7 (964) 551-05-13");
    // Invalid formats return null.
    assert.equal(canonicalToPlus7("12345"), null);
});

test("classifyMobileLandline: 9xx → mobile, else landline", () => {
    assert.equal(classifyMobileLandline("+7 (964) 551-05-13"), "mobile");
    assert.equal(classifyMobileLandline("+7 (999) 123-45-67"), "mobile");
    assert.equal(classifyMobileLandline("+7 (495) 123-45-67"), "landline");
    assert.equal(classifyMobileLandline("+7 (3812) 606-23-22"), "landline");
});

test("classifyCountry: +7 → RU, +375 → BY, +86 → CN, +1 → US/CA", () => {
    assert.equal(classifyCountry("+7 (964) 551-05-13"), "RU");
    assert.equal(classifyCountry("+375 29 123 45 67"), "BY");
    assert.equal(classifyCountry("+86 10 1234 5678"), "CN");
    assert.equal(classifyCountry("+998 90 123 45 67"), "UZ");
});

test("normalizeBareDigits: 11 digit starting with 7 → +7 canonical", () => {
    assert.equal(normalizeBareDigits("79645510513"), "+7 (964) 551-05-13");
    assert.equal(normalizeBareDigits("89645510513"), "+7 (964) 551-05-13");
    // 10 digits (missing country code) — assume RU.
    assert.equal(normalizeBareDigits("9645510513"), "+7 (964) 551-05-13");
    // Too short → null.
    assert.equal(normalizeBareDigits("12345"), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade — extractPhone
// ─────────────────────────────────────────────────────────────────────────────

test("facade: extracts +7 phone from signature", () => {
    const r = extractPhone({
        signature: "С уважением,\nИванов И.И.\nтел. +7 (495) 123-45-67",
        body: "",
    });
    assert.equal(r.primary, "+7 (495) 123-45-67");
    assert.equal(r.type, "phone");
    assert.equal(r.source, "signature");
});

test("facade: normalizes 8-prefix to +7", () => {
    const r = extractPhone({
        body: "Свяжитесь со мной: 8-964-551-05-13",
    });
    assert.equal(r.primary, "+7 (964) 551-05-13");
    assert.equal(r.isMobile, true);
});

test("facade: splits phone and extension into sub-fields", () => {
    const r = extractPhone({
        signature: "тел: +7(8352) 62-29-15, доб. 204",
    });
    assert.equal(r.ext, "204");
    assert.ok(/\+7/.test(r.primary));
});

test("facade: classifies т/ф as phone_or_fax", () => {
    const r = extractPhone({
        signature: "т/ф (812) 606-23-22",
    });
    assert.equal(r.type, "phone_or_fax");
});

test("facade: classifies факс as fax", () => {
    const r = extractPhone({
        signature: "факс: +7 (495) 123-45-68",
    });
    assert.equal(r.type, "fax");
});

test("facade: detects risky short numbers", () => {
    const r = extractPhone({
        body: "+7 (3349) 22450",
    });
    // 4-digit area + 5-digit subscriber → still valid 11 digits.
    // But the subscriber block is only 5 digits → risky / local.
    assert.ok(r.primary);
    assert.equal(r.needsReview, true);
});

test("facade: recovers phone from companyHint (misplacement)", () => {
    const r = extractPhone({
        body: "",
        companyHint: "ООО Предприятие Теллур 8 903 605 27 08",
    });
    assert.equal(r.primary, "+7 (903) 605-27-08");
    assert.equal(r.recoveredFromCompany, true);
});

test("facade: rejects INN-like numbers", () => {
    const r = extractPhone({
        body: "ИНН 7707083893",
    });
    assert.equal(r.primary, null);
    assert.ok(r.rejected.some((x) => x.reason === "inn_like"));
});

test("facade: rejects bank account", () => {
    const r = extractPhone({
        body: "р/с 40702810123450000001",
    });
    assert.equal(r.primary, null);
});

test("facade: rejects postal code", () => {
    const r = extractPhone({
        body: "630090 г. Новосибирск",
    });
    assert.equal(r.primary, null);
});

test("facade: form_fields has highest priority", () => {
    const r = extractPhone({
        formFields: { "Телефон": "+7 (964) 551-05-13" },
        signature: "тел. +7 (495) 123-45-67",
    });
    assert.equal(r.primary, "+7 (964) 551-05-13");
    assert.equal(r.source, "form");
});

test("facade: intl non-RU phone preserved", () => {
    const r = extractPhone({
        body: "Contact: +375 29 123-45-67",
    });
    assert.ok(/^\+375/.test(r.primary));
    assert.equal(r.country, "BY");
});

test("facade: intl +7 accidentally looked like Kazakhstan stays RU", () => {
    const r = extractPhone({
        body: "+7 (727) 123 45 67",
    });
    assert.ok(/^\+7/.test(r.primary));
});

test("facade: empty input returns null primary with needsReview=true", () => {
    const r = extractPhone({});
    assert.equal(r.primary, null);
    assert.equal(r.needsReview, true);
});

test("facade: debug fields populated", () => {
    const r = extractPhone({
        body: "+7 (495) 123-45-67 and 7707083893",
    });
    assert.ok(Array.isArray(r.rawCandidates));
    assert.ok(Array.isArray(r.rejected));
    assert.ok(typeof r.confidence === "number");
});

test("facade: multiple phones — picks best-source highest-confidence", () => {
    const r = extractPhone({
        signature: "тел. +7 (495) 123-45-67\nмоб. +7 (964) 551-05-13",
    });
    // Both signature source — either is acceptable primary,
    // but `alt` must contain the other.
    assert.ok(r.primary);
    assert.ok(r.alt);
    assert.notEqual(r.primary, r.alt);
});

test("facade: date like number is not a phone", () => {
    const r = extractPhone({
        body: "Дата: 12.04.2026",
    });
    assert.equal(r.primary, null);
});
