// Phase 5 — FIO (person name) extraction TDD suite.
// Covers: negative filters (company/email/alias/role), composite split,
// bilingual split, honorific removal, source-priority cascade.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isCompanyLike,
    isEmailLike,
    isAliasLike,
    isRoleOnly,
    isCorporateUppercase,
    isDepartmentLike,
    isBadPersonName,
} from "../src/services/fio-filters.js";

import {
    splitCompositeCompanyPerson,
    splitBilingualName,
    stripHonorific,
    stripRoleTail,
    stripRolePrefix,
    normalizePersonName,
} from "../src/services/fio-normalizer.js";

import { extractPersonName } from "../src/services/fio-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Filters — negative predicates
// ─────────────────────────────────────────────────────────────────────────────

test("isCompanyLike: ООО / ИП / АО / LLC / GmbH", () => {
    assert.ok(isCompanyLike("ООО БВС"));
    assert.ok(isCompanyLike("ООО КОМПЛЕКСНОЕ СНАБЖЕНИЕ ПРЕДПРИЯТИЙ"));
    assert.ok(isCompanyLike("ИП Безрукова"));
    assert.ok(isCompanyLike("АО Промресурс"));
    assert.ok(isCompanyLike("ЗАО Вектор"));
    assert.ok(isCompanyLike("ОАО Лукойл"));
    assert.ok(isCompanyLike("LLC Semicon"));
    assert.ok(isCompanyLike("Ltd Company"));
    assert.ok(isCompanyLike("GmbH Schmidt"));
    assert.ok(isCompanyLike("ФГУП РФЯЦ-ВНИИЭФ"));
    assert.ok(isCompanyLike("ТК Комплект"));
    assert.ok(!isCompanyLike("Иван Иванов"));
    assert.ok(!isCompanyLike("Елена"));
});

test("isEmailLike: contains @ или email-like pattern", () => {
    assert.ok(isEmailLike("manager@gazprojectservice.ru"));
    assert.ok(isEmailLike("info@promds.ru"));
    assert.ok(isEmailLike("pto@krion.by"));
    assert.ok(isEmailLike("robot@siderus.ru"));
    assert.ok(!isEmailLike("Иван Иванов"));
});

test("isAliasLike: buh/snab/support/info/sales/procurement/admin", () => {
    assert.ok(isAliasLike("buh"));
    assert.ok(isAliasLike("snab"));
    assert.ok(isAliasLike("support"));
    assert.ok(isAliasLike("info"));
    assert.ok(isAliasLike("sales"));
    assert.ok(isAliasLike("procurement"));
    assert.ok(isAliasLike("admin"));
    assert.ok(isAliasLike("office"));
    assert.ok(isAliasLike("zakup"));
    assert.ok(isAliasLike("Снабжение1"));
    assert.ok(isAliasLike("Snab.online"));
    assert.ok(!isAliasLike("Иван Иванов"));
    assert.ok(!isAliasLike("Елена"));
});

test("isRoleOnly: '' как имя", () => {
    assert.ok(isRoleOnly("менеджер"));
    assert.ok(isRoleOnly("директор"));
    assert.ok(isRoleOnly("manager"));
    assert.ok(isRoleOnly("engineer"));
    assert.ok(isRoleOnly("специалист"));
    assert.ok(!isRoleOnly("Иван Иванов"));
    assert.ok(!isRoleOnly("Igor Kim manager")); // not role-only, has name
});

test("isCorporateUppercase: полностью заглавные corporate labels", () => {
    assert.ok(isCorporateUppercase("ESTP.RU"));
    assert.ok(isCorporateUppercase("ООО БВС"));
    // Короткое "IVAN" или "АННА" — тоже uppercase, но это может быть ok-имя
    // → предикат должен требовать ≥2 слов или специальные corp markers
    assert.ok(!isCorporateUppercase("Ivan Petrov"));
});

test("isDepartmentLike: отделы/подразделения", () => {
    assert.ok(isDepartmentLike("ОГМ АО МЗП"));
    assert.ok(isDepartmentLike("ПСК СИГМА"));
    assert.ok(isDepartmentLike("Отдел закупок"));
    assert.ok(isDepartmentLike("Sales department"));
});

test("isBadPersonName: composite предикат reject plural", () => {
    assert.ok(isBadPersonName("ООО БВС"));
    assert.ok(isBadPersonName("manager@gazprojectservice.ru"));
    assert.ok(isBadPersonName("buh"));
    assert.ok(isBadPersonName("менеджер"));
    assert.ok(isBadPersonName(""));
    assert.ok(!isBadPersonName("Иван Иванов"));
    assert.ok(!isBadPersonName("Елена Ананьева"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer — composite / bilingual / role-tail
// ─────────────────────────────────────────────────────────────────────────────

test("splitCompositeCompanyPerson: 'ИП Безрукова ЕВ - Елена'", () => {
    const r = splitCompositeCompanyPerson("ИП Безрукова ЕВ - Елена");
    assert.equal(r.person, "Елена");
    assert.ok(/ИП/.test(r.company));
});

test("splitCompositeCompanyPerson: 'ООО ... - Цыганок Алексей'", () => {
    const r = splitCompositeCompanyPerson("ООО Энергетические системы - Цыганок Алексей Александрович");
    assert.equal(r.person, "Цыганок Алексей Александрович");
    assert.ok(/ООО/.test(r.company));
});

test("splitCompositeCompanyPerson: 'Person - Company' (reverse order)", () => {
    const r = splitCompositeCompanyPerson("Ермошкин Антон - ООО Вентинтех");
    assert.equal(r.person, "Ермошкин Антон");
    assert.ok(/ООО/.test(r.company));
});

test("splitCompositeCompanyPerson: 'Person (Company)' — скобки", () => {
    const r = splitCompositeCompanyPerson("Елена Ананьева (ООО Металлургический Сервис)");
    assert.equal(r.person, "Елена Ананьева");
    assert.ok(/ООО/.test(r.company));
});

test("splitCompositeCompanyPerson: no split если нет company marker", () => {
    const r = splitCompositeCompanyPerson("Иван Петров");
    assert.equal(r.person, "Иван Петров");
    assert.equal(r.company, null);
});

test("splitBilingualName: 'Александр Аленников/Aleksandr Alennikov'", () => {
    const r = splitBilingualName("Александр Аленников/Aleksandr Alennikov");
    // primary = кириллица (preferred) if matches Russian script
    assert.equal(r.primary, "Александр Аленников");
    assert.equal(r.alt, "Aleksandr Alennikov");
});

test("splitBilingualName: 'Леонтьев \\ Andrei Leontev'", () => {
    const r = splitBilingualName("Леонтьев Андрей Викторович \\ Andrei Leontev");
    assert.equal(r.primary, "Леонтьев Андрей Викторович");
    assert.equal(r.alt, "Andrei Leontev");
});

test("splitBilingualName: no split если одна форма", () => {
    const r = splitBilingualName("Иван Петров");
    assert.equal(r.primary, "Иван Петров");
    assert.equal(r.alt, null);
});

test("stripHonorific: Mrs/Mr/Ms/госпожа", () => {
    assert.equal(stripHonorific("Zainetdinova Guzel (Mrs)"), "Zainetdinova Guzel");
    assert.equal(stripHonorific("Mr. John Smith"), "John Smith");
    assert.equal(stripHonorific("Mrs Mary Johnson"), "Mary Johnson");
    assert.equal(stripHonorific("Иван Петров"), "Иван Петров");
});

test("stripRoleTail: 'Igor Kim manager' → 'Igor Kim'", () => {
    assert.equal(stripRoleTail("Igor Kim manager"), "Igor Kim");
    assert.equal(stripRoleTail("Иван Петров, инженер"), "Иван Петров");
    assert.equal(stripRoleTail("Елена Смирнова engineer"), "Елена Смирнова");
    assert.equal(stripRoleTail("Иван Иванов"), "Иван Иванов");
});

test("normalizePersonName: trim + collapse + clean", () => {
    assert.equal(normalizePersonName("  Иван   Иванов  "), "Иван Иванов");
    assert.equal(normalizePersonName("ИВАН ИВАНОВ"), "Иван Иванов"); // title-case
    assert.equal(normalizePersonName("иван иванов"), "Иван Иванов");
    assert.equal(normalizePersonName(""), "");
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade extractPersonName
// ─────────────────────────────────────────────────────────────────────────────

test("extractPersonName: clean person in signature preferred over header", () => {
    const r = extractPersonName({
        senderDisplay: "ООО БВС",
        signature: "С уважением,\nИван Петров\nинженер",
        body: "",
        emailLocal: "info",
    });
    assert.equal(r.primary, "Иван Петров");
    assert.equal(r.source, "signature");
    assert.ok(r.confidence >= 0.7);
});

test("extractPersonName: reject company header, fall through to signature", () => {
    const r = extractPersonName({
        senderDisplay: "ООО БВС",
        signature: "Елена Смирнова",
        body: "",
        emailLocal: "elena",
    });
    assert.equal(r.primary, "Елена Смирнова");
    assert.equal(r.source, "signature");
});

test("extractPersonName: reject email-like display, use signature", () => {
    const r = extractPersonName({
        senderDisplay: "info@company.ru",
        signature: "Елена Смирнова",
        body: "",
        emailLocal: "info",
    });
    assert.equal(r.primary, "Елена Смирнова");
});

test("extractPersonName: reject alias display (buh/snab), use body candidate", () => {
    const r = extractPersonName({
        senderDisplay: "snab",
        signature: "",
        body: "Контактное лицо: Пётр Сидоров",
        emailLocal: "snab",
    });
    assert.equal(r.primary, "Пётр Сидоров");
});

test("extractPersonName: composite display 'ИП Foo - Елена' → person=Елена", () => {
    const r = extractPersonName({
        senderDisplay: "ИП Безрукова ЕВ - Елена",
        signature: "",
        body: "",
        emailLocal: "elena",
    });
    assert.equal(r.primary, "Елена");
    assert.ok(r.company && /ИП/.test(r.company));
});

test("extractPersonName: bilingual split → primary + alt", () => {
    const r = extractPersonName({
        senderDisplay: "Александр Аленников/Aleksandr Alennikov",
        signature: "",
        body: "",
        emailLocal: "alennikov",
    });
    assert.equal(r.primary, "Александр Аленников");
    assert.equal(r.alt, "Aleksandr Alennikov");
});

test("extractPersonName: honorific removed", () => {
    const r = extractPersonName({
        senderDisplay: "Zainetdinova Guzel (Mrs)",
        signature: "",
        body: "",
        emailLocal: "zainetdinova",
    });
    assert.equal(r.primary, "Zainetdinova Guzel");
});

test("extractPersonName: role tail stripped", () => {
    const r = extractPersonName({
        senderDisplay: "Igor Kim manager",
        signature: "",
        body: "",
        emailLocal: "ikim",
    });
    assert.equal(r.primary, "Igor Kim");
    assert.ok(/manager|менедж/i.test(r.role || ""));
});

test("extractPersonName: all-bad inputs → null + needsReview", () => {
    const r = extractPersonName({
        senderDisplay: "ООО БВС",
        signature: "",
        body: "",
        emailLocal: "info",
    });
    assert.equal(r.primary, null);
    assert.equal(r.needsReview, true);
});

test("extractPersonName: single-word sender (Elena) accepted with low confidence", () => {
    const r = extractPersonName({
        senderDisplay: "Елена",
        signature: "",
        body: "",
        emailLocal: "elena",
    });
    assert.equal(r.primary, "Елена");
    assert.ok(r.confidence < 0.7);
    assert.equal(r.needsReview, true);
});

test("extractPersonName: 2-word proper name → high confidence", () => {
    const r = extractPersonName({
        senderDisplay: "Иван Петров",
        signature: "",
        body: "",
        emailLocal: "ipetrov",
    });
    assert.equal(r.primary, "Иван Петров");
    assert.ok(r.confidence >= 0.7);
    assert.equal(r.needsReview, false);
});

test("extractPersonName: signature person wins over bad sender", () => {
    const r = extractPersonName({
        senderDisplay: "info@company.ru",
        signature: "С уважением,\nПётр Иванович Сидоров\nООО Тест",
        body: "",
        emailLocal: "info",
    });
    assert.equal(r.primary, "Пётр Иванович Сидоров");
    assert.equal(r.source, "signature");
});

test("extractPersonName: rejected candidates in debug", () => {
    const r = extractPersonName({
        senderDisplay: "ООО БВС",
        signature: "Иван Петров",
        body: "",
        emailLocal: "info",
    });
    assert.ok(Array.isArray(r.rejected));
    assert.ok(r.rejected.some((rej) => /company|ООО/i.test(rej.value || rej.reason || "")));
});

test("extractPersonName: email-local as last-resort fallback only", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "",
        body: "",
        emailLocal: "ivan.petrov",
    });
    // ivan.petrov → "Ivan Petrov" или "Иван Петров" — low confidence
    assert.ok(r.primary);
    assert.equal(r.source, "email_local");
    assert.ok(r.confidence < 0.5);
});

// ─────────────────────────────────────────────────────────────────────────────
// Post-audit 2026-04-20: role compound rejection + role-prefix strip (81 cases)
// ─────────────────────────────────────────────────────────────────────────────

test("isRoleOnly: adjective+noun role compounds rejected", () => {
    assert.ok(isRoleOnly("Главный Механик"));
    assert.ok(isRoleOnly("Главный Энергетик"));
    assert.ok(isRoleOnly("Ведущий Менеджер"));
    assert.ok(isRoleOnly("Коммерческий Директор"));
    assert.ok(isRoleOnly("Генеральный директор"));
    assert.ok(isRoleOnly("Старший Специалист"));
    assert.ok(isRoleOnly("Менеджер По Закупкам"));
    assert.ok(isRoleOnly("Инженер По Продажам"));
    assert.ok(isRoleOnly("Менеджер по снабжению"));
    assert.ok(isRoleOnly("Head of Sales"));
    assert.ok(isRoleOnly("Chief Engineer"));
    // Pure adjective without noun is NOT a role
    assert.ok(!isRoleOnly("Главный"));
    assert.ok(!isRoleOnly("Senior"));
    // Real names not flagged
    assert.ok(!isRoleOnly("Иван Петров"));
    assert.ok(!isRoleOnly("Петрова Анна"));
});

test("isBadPersonName: rejects role compound strings", () => {
    assert.ok(isBadPersonName("Главный Механик"));
    assert.ok(isBadPersonName("Менеджер По Закупкам"));
    assert.ok(isBadPersonName("Ведущий Менеджер По Снабжению"));
    assert.ok(isBadPersonName("Коммерческий Директор"));
    // Real name still valid
    assert.ok(!isBadPersonName("Иван Петров"));
});

test("stripRolePrefix: 'Менеджер По Закупкам Жарихин Н.в.' → 'Жарихин Н.в.'", () => {
    assert.equal(
        stripRolePrefix("Менеджер По Закупкам Жарихин Н.в."),
        "Жарихин Н.в.",
    );
    assert.equal(
        stripRolePrefix("Менеджер Петрова Анна Игоревна"),
        "Петрова Анна Игоревна",
    );
    assert.equal(
        stripRolePrefix("Главный Механик"),
        "", // pure role compound → empty
    );
    assert.equal(
        stripRolePrefix("Инженер По Оборудованию,"),
        "",
    );
    // No role prefix: return as-is
    assert.equal(
        stripRolePrefix("Иван Петров"),
        "Иван Петров",
    );
    // Empty input
    assert.equal(stripRolePrefix(""), "");
    // Only adjective (no role noun) → keep unchanged
    assert.equal(
        stripRolePrefix("Старший Иванов Иван"),
        "Старший Иванов Иван",
    );
});

test("extractPersonName: role-prefix stripped from signature leak", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Менеджер По Закупкам Жарихин Н.в.\n+7 (495) 123-45-67",
        body: "",
        emailLocal: "",
    });
    // Expected: role prefix stripped → "Жарихин Н.в."
    assert.ok(r.primary, "expected primary to be extracted");
    assert.match(r.primary, /Жарихин/);
    assert.ok(!r.primary.toLowerCase().includes("менеджер"));
});

test("extractPersonName: pure role compound 'Главный Механик' rejected", () => {
    const r = extractPersonName({
        senderDisplay: "Главный Механик",
        signature: "",
        body: "",
        emailLocal: "",
    });
    // Should fall through to null because this is role-only
    assert.equal(r.primary, null);
    assert.ok(r.needsReview);
});

test("extractPersonName: '(Менеджер Петрова Анна Игоревна)' accepts real name", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Менеджер Петрова Анна Игоревна\n+7 (495) 555",
        body: "",
        emailLocal: "",
    });
    assert.ok(r.primary);
    assert.match(r.primary, /Петрова/);
});

test("extractPersonName: trailing Cyrillic role tail stripped ('Дордаль Артем Инженер')", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Дордаль Артем Инженер",
        body: "",
        emailLocal: "",
    });
    assert.equal(r.primary, "Дордаль Артем");
    assert.equal(r.role, "инженер");
});

test("extractPersonName: role with punctuation ('Инженер-Механик +phone')", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Дордаль Артем Инженер-Механик +375 (33) 367-70-23",
        body: "",
        emailLocal: "",
    });
    assert.equal(r.primary, "Дордаль Артем");
});

test("extractPersonName: compound role tail ('Генеральный Директор')", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Вусал Аллахвердиев / Генеральный Директор",
        body: "",
        emailLocal: "",
    });
    assert.equal(r.primary, "Вусал Аллахвердиев");
});

test("extractPersonName: compound role with connector ('Специалист По Закупкам')", () => {
    const r = extractPersonName({
        senderDisplay: "",
        signature: "Шаталова Ольга, Специалист По Закупкам",
        body: "",
        emailLocal: "",
    });
    assert.equal(r.primary, "Шаталова Ольга");
});
