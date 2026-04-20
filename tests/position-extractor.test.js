// Phase 7 — Position (Должность) extraction TDD suite.
// Covers:
//   - negative filters: company-in-role, person-in-role, department-only,
//     contact garbage, signature blob, overcapture;
//   - normalizer: strip company/person/contact tails, bilingual split,
//     department separation;
//   - facade: source cascade form > signature > body > sender, cross-field
//     personHint / companyHint rejects, debug fields.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isCompanyInRole,
    isPersonInRole,
    isDepartmentOnly,
    isContactGarbage,
    isAddressLike,
    isPhoneLike,
    isFullSignatureBlob,
    hasRoleWord,
    isBadPosition,
} from "../src/services/position-filters.js";

import {
    stripCompanyTail,
    stripPersonTail,
    stripContactTail,
    splitBilingualRole,
    separateDepartmentFromRole,
    normalizePosition,
} from "../src/services/position-normalizer.js";

import { extractPosition } from "../src/services/position-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

test("isCompanyInRole: role contains ООО/АО/LLC tail", () => {
    assert.ok(isCompanyInRole("Менеджер ООО Ромашка"));
    assert.ok(isCompanyInRole("Инженер АО «Промстрой»"));
    assert.ok(isCompanyInRole("Sales Manager LLC Semicon"));
    assert.ok(isCompanyInRole("Директор ИП Иванов"));
    assert.ok(!isCompanyInRole("Менеджер по закупкам"));
    assert.ok(!isCompanyInRole("Главный инженер"));
});

test("isPersonInRole: role contains 2-3 Title-case surname+name", () => {
    assert.ok(isPersonInRole("Менеджер Иванов Иван"));
    assert.ok(isPersonInRole("Директор Петров Петр Петрович"));
    assert.ok(isPersonInRole("Manager John Smith"));
    assert.ok(!isPersonInRole("Менеджер по закупкам"));
    assert.ok(!isPersonInRole("Главный инженер"));
    assert.ok(!isPersonInRole("Sales Manager"));
});

test("isDepartmentOnly: department without role word", () => {
    assert.ok(isDepartmentOnly("Отдел закупок"));
    assert.ok(isDepartmentOnly("Департамент снабжения"));
    assert.ok(isDepartmentOnly("Служба главного механика"));
    assert.ok(isDepartmentOnly("Бюро технической документации"));
    assert.ok(isDepartmentOnly("Procurement Department"));
    // Role + department → NOT department-only.
    assert.ok(!isDepartmentOnly("Начальник отдела закупок"));
    assert.ok(!isDepartmentOnly("Менеджер отдела снабжения"));
    assert.ok(!isDepartmentOnly("Главный инженер"));
});

test("isContactGarbage: phone / email / url", () => {
    assert.ok(isContactGarbage("+7 (495) 123-45-67"));
    assert.ok(isContactGarbage("Тел: 8-800-555-35-35"));
    assert.ok(isContactGarbage("info@example.com"));
    assert.ok(isContactGarbage("https://example.com"));
    assert.ok(isContactGarbage("www.example.ru"));
    assert.ok(!isContactGarbage("Менеджер по закупкам"));
    assert.ok(!isContactGarbage("Sales Manager"));
});

test("isAddressLike: 'г. Москва' / 'ул. Ленина 5'", () => {
    assert.ok(isAddressLike("г. Москва, ул. Ленина, 5"));
    assert.ok(isAddressLike("ул. Советская, 10"));
    assert.ok(isAddressLike("119991, г. Москва"));
    assert.ok(!isAddressLike("Главный инженер"));
});

test("isPhoneLike: pure phone", () => {
    assert.ok(isPhoneLike("+7 (495) 123-45-67"));
    assert.ok(isPhoneLike("8-800-555-35-35"));
    assert.ok(isPhoneLike("79991234567"));
    assert.ok(!isPhoneLike("Менеджер"));
});

test("isFullSignatureBlob: multi-line signature dump", () => {
    assert.ok(isFullSignatureBlob("Иванов Иван\nМенеджер\n+7 495 123-45-67\ninfo@x.ru"));
    assert.ok(isFullSignatureBlob("С уважением, Иванов И. И. ООО Ромашка +7 495 123-45-67 info@x.ru г. Москва"));
    assert.ok(!isFullSignatureBlob("Главный инженер"));
    assert.ok(!isFullSignatureBlob("Менеджер по закупкам"));
});

test("hasRoleWord: contains known role keyword", () => {
    assert.ok(hasRoleWord("Менеджер по закупкам"));
    assert.ok(hasRoleWord("Главный инженер"));
    assert.ok(hasRoleWord("Procurement Specialist"));
    assert.ok(hasRoleWord("CEO"));
    assert.ok(hasRoleWord("Sales Manager"));
    assert.ok(!hasRoleWord("Отдел закупок"));
    assert.ok(!hasRoleWord("Иванов Иван"));
});

test("isBadPosition: composite rejection", () => {
    assert.ok(isBadPosition(""));
    assert.ok(isBadPosition(null));
    assert.ok(isBadPosition("+7 (495) 123-45-67"));
    assert.ok(isBadPosition("info@example.com"));
    assert.ok(isBadPosition("Иванов Иван Петрович"));
    assert.ok(!isBadPosition("Менеджер"));
    assert.ok(!isBadPosition("Главный инженер"));
    assert.ok(!isBadPosition("Sales Manager"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer
// ─────────────────────────────────────────────────────────────────────────────

test("stripCompanyTail: 'Менеджер ООО Ромашка' → 'Менеджер'", () => {
    assert.equal(stripCompanyTail("Менеджер ООО Ромашка"), "Менеджер");
    assert.equal(stripCompanyTail("Инженер АО «Промстрой»"), "Инженер");
    assert.equal(stripCompanyTail("Sales Manager LLC Semicon"), "Sales Manager");
    assert.equal(stripCompanyTail("Менеджер по закупкам"), "Менеджер по закупкам");
    assert.equal(stripCompanyTail("Главный инженер"), "Главный инженер");
});

test("stripPersonTail: 'Менеджер Иванов Иван' → 'Менеджер'", () => {
    assert.equal(stripPersonTail("Менеджер Иванов Иван"), "Менеджер");
    assert.equal(stripPersonTail("Менеджер Иванов Иван Петрович"), "Менеджер");
    assert.equal(stripPersonTail("Менеджер по закупкам"), "Менеджер по закупкам");
});

test("stripContactTail: trailing phone / email / url", () => {
    assert.equal(stripContactTail("Менеджер +7 495 123-45-67"), "Менеджер");
    assert.equal(stripContactTail("Менеджер info@example.com"), "Менеджер");
    assert.equal(stripContactTail("Менеджер https://example.com"), "Менеджер");
    assert.equal(stripContactTail("Менеджер по закупкам"), "Менеджер по закупкам");
});

test("splitBilingualRole: 'Главный инженер | Chief Engineer'", () => {
    const r = splitBilingualRole("Главный инженер | Chief Engineer");
    assert.equal(r.ru, "Главный инженер");
    assert.equal(r.en, "Chief Engineer");
});

test("splitBilingualRole: plain single-language → no split", () => {
    const r = splitBilingualRole("Главный инженер");
    assert.equal(r.ru, "Главный инженер");
    assert.equal(r.en, null);
});

test("separateDepartmentFromRole: 'Начальник отдела закупок' → role+dept", () => {
    const r = separateDepartmentFromRole("Начальник отдела закупок");
    assert.equal(r.role, "Начальник");
    assert.equal(r.department, "отдела закупок");
});

test("separateDepartmentFromRole: plain role → no dept", () => {
    const r = separateDepartmentFromRole("Менеджер по закупкам");
    assert.equal(r.role, "Менеджер по закупкам");
    assert.equal(r.department, null);
});

test("normalizePosition: full cleanup pipeline", () => {
    assert.equal(
        normalizePosition("  Менеджер  ООО  Ромашка  +7 495 123-45-67  "),
        "Менеджер"
    );
    assert.equal(
        normalizePosition("Менеджер по закупкам,"),
        "Менеджер по закупкам"
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade
// ─────────────────────────────────────────────────────────────────────────────

test("extractPosition: form_fields > signature cascade", () => {
    const r = extractPosition({
        formFields: { "Должность": "Главный инженер" },
        signature: "Менеджер по закупкам\nИванов И. И.",
        body: "",
    });
    assert.equal(r.primary, "Главный инженер");
    assert.equal(r.source, "form");
});

test("extractPosition: label 'Должность: X' in body", () => {
    const r = extractPosition({
        body: "Прошу рассмотреть заявку.\nДолжность: Менеджер по закупкам\nКомпания: ООО Ромашка",
    });
    assert.equal(r.primary, "Менеджер по закупкам");
});

test("extractPosition: signature multi-line role", () => {
    const r = extractPosition({
        signature: "С уважением,\nГлавный инженер\nИванов Иван",
    });
    assert.equal(r.primary, "Главный инженер");
    assert.equal(r.source, "signature");
});

test("extractPosition: company contamination stripped", () => {
    const r = extractPosition({
        body: "Должность: Менеджер ООО Ромашка",
    });
    assert.equal(r.primary, "Менеджер");
});

test("extractPosition: cross-field personHint rejects", () => {
    const r = extractPosition({
        body: "Должность: Иванов Иван Петрович",
        personHint: "Иванов Иван Петрович",
    });
    assert.equal(r.primary, null);
});

test("extractPosition: cross-field companyHint rejects", () => {
    const r = extractPosition({
        body: "Должность: ООО Ромашка",
        companyHint: "ООО Ромашка",
    });
    assert.equal(r.primary, null);
});

test("extractPosition: department-only captured as department", () => {
    const r = extractPosition({
        body: "Должность: Отдел закупок",
    });
    // Pure department is not a position → primary null, department set.
    assert.equal(r.primary, null);
    assert.equal(r.department, "Отдел закупок");
});

test("extractPosition: role + department split", () => {
    const r = extractPosition({
        body: "Должность: Начальник отдела материально-технического снабжения",
    });
    assert.equal(r.primary, "Начальник отдела материально-технического снабжения");
    assert.ok(r.department && r.department.length > 0);
});

test("extractPosition: contact garbage rejected", () => {
    const r = extractPosition({
        body: "Должность: +7 (495) 123-45-67",
    });
    assert.equal(r.primary, null);
    assert.ok(Array.isArray(r.rejected));
});

test("extractPosition: no body/signature → null", () => {
    const r = extractPosition({ body: "" });
    assert.equal(r.primary, null);
    assert.equal(r.source, null);
});

test("extractPosition: Latin signature role", () => {
    const r = extractPosition({
        signature: "Best regards,\nSales Manager\nJohn Smith",
    });
    assert.equal(r.primary, "Sales Manager");
});

test("extractPosition: bilingual role preserved in alt", () => {
    const r = extractPosition({
        body: "Должность: Главный инженер | Chief Engineer",
    });
    assert.equal(r.primary, "Главный инженер");
    assert.equal(r.alt, "Chief Engineer");
});

test("extractPosition: overcapture 5+ words truncated", () => {
    // "Менеджер по закупкам ООО Ромашка +7 495 123-45-67 info@x.ru"
    const r = extractPosition({
        body: "Должность: Менеджер по закупкам ООО Ромашка +7 495 123-45-67 info@x.ru",
    });
    assert.ok(r.primary);
    assert.ok(!/@|\+7|ООО/.test(r.primary), `expected cleaned, got: ${r.primary}`);
});

test("extractPosition: debug fields present", () => {
    const r = extractPosition({
        body: "Должность: Менеджер",
    });
    assert.equal(typeof r.confidence, "number");
    assert.equal(typeof r.needsReview, "boolean");
    assert.ok(Array.isArray(r.rawCandidates));
    assert.ok(Array.isArray(r.rejected));
});

test("extractPosition: recall short role 'Закупщик'", () => {
    const r = extractPosition({
        body: "С уважением,\nЗакупщик\nИванов И.",
    });
    assert.equal(r.primary, "Закупщик");
});

test("extractPosition: recall 'Procurement Specialist'", () => {
    const r = extractPosition({
        signature: "Best regards,\nProcurement Specialist\nJohn Smith",
    });
    assert.equal(r.primary, "Procurement Specialist");
});

test("extractPosition: reject 'Иванов Иван' without role word", () => {
    const r = extractPosition({
        body: "Должность: Иванов Иван Петрович",
    });
    assert.equal(r.primary, null);
});

test("extractPosition: reject bare company as position", () => {
    const r = extractPosition({
        body: "Должность: ООО Ромашка",
    });
    assert.equal(r.primary, null);
});
