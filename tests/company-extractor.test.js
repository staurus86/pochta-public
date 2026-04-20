// Phase 6 — Company extraction TDD suite.
// Covers: generic-provider reject, domain-label weak fallback, person-like reject,
// department/role reject, overcapture cleanup, composite split, scoring.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isGenericProvider,
    isPersonLikeCompany,
    isDepartmentCompany,
    isRoleCompany,
    isOvercaptureBlob,
    isDomainLabelOnly,
    isBadCompany,
} from "../src/services/company-filters.js";

import {
    stripRequisiteTails,
    splitCompositeForCompany,
    normalizeLegalQuotes,
    normalizeCompanyName,
} from "../src/services/company-normalizer.js";

import { extractCompany } from "../src/services/company-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

test("isGenericProvider: Yandex / Gmail / Mail / Outlook", () => {
    assert.ok(isGenericProvider("Yandex"));
    assert.ok(isGenericProvider("Gmai"));
    assert.ok(isGenericProvider("Gmail"));
    assert.ok(isGenericProvider("Mail"));
    assert.ok(isGenericProvider("Outlook"));
    assert.ok(isGenericProvider("yandex.ru"));
    assert.ok(isGenericProvider("gmail.com"));
    assert.ok(isGenericProvider("Foxmail"));
    assert.ok(!isGenericProvider("Tatenergo"));
    assert.ok(!isGenericProvider("ООО БВС"));
});

test("isPersonLikeCompany: 'Алексей' / 'Аббос' / 'Иван Иванов'", () => {
    assert.ok(isPersonLikeCompany("Алексей"));
    assert.ok(isPersonLikeCompany("Аббос"));
    assert.ok(isPersonLikeCompany("Иван Иванов"));
    assert.ok(isPersonLikeCompany("Елена Ананьева"));
    assert.ok(!isPersonLikeCompany("ООО БВС"));
    assert.ok(!isPersonLikeCompany("Tatenergo"));
    assert.ok(!isPersonLikeCompany("LLC Semicon"));
});

test("isDepartmentCompany: 'Отдел закупок' / 'Support Department'", () => {
    assert.ok(isDepartmentCompany("Отдел закупок ООО ГК"));
    assert.ok(isDepartmentCompany("Отдел документационного обеспечения"));
    assert.ok(isDepartmentCompany("Отдел инженерно-технического обеспечения"));
    assert.ok(isDepartmentCompany("Sales Department"));
    assert.ok(isDepartmentCompany("Support Department"));
    assert.ok(!isDepartmentCompany("ООО БВС"));
});

test("isRoleCompany: 'Procurement Specialist' / 'Менеджер по закупкам'", () => {
    assert.ok(isRoleCompany("Procurement Specialist TD MetImProm"));
    assert.ok(isRoleCompany("Менеджер по закупкам"));
    assert.ok(isRoleCompany("Инженер"));
    assert.ok(isRoleCompany("Sales Manager"));
    assert.ok(!isRoleCompany("ООО БВС"));
    assert.ok(!isRoleCompany("Tatenergo"));
});

test("isOvercaptureBlob: контейнеры реквизитов", () => {
    assert.ok(isOvercaptureBlob("ООО ЛВН-Менеджмент Дата регистрации 29.12.2009"));
    assert.ok(isOvercaptureBlob("ООО ПСИ Директор действующий на основании Устава"));
    assert.ok(isOvercaptureBlob("АО Омский каучук ИНН 5501023216 г.Омск"));
    assert.ok(isOvercaptureBlob("ООО Альтермо ИНН 9722061376"));
    assert.ok(isOvercaptureBlob("ООО ТД МПТ Организационно-правовая форма Общество"));
    assert.ok(!isOvercaptureBlob("ООО БВС"));
    assert.ok(!isOvercaptureBlob("АО Промресурс"));
});

test("isDomainLabelOnly: доменный ярлык без legal-marker", () => {
    assert.ok(isDomainLabelOnly("Hhr"));
    assert.ok(isDomainLabelOnly("Rdegroup"));
    assert.ok(isDomainLabelOnly("Karatsc"));
    assert.ok(isDomainLabelOnly("Tatenergo"));
    assert.ok(!isDomainLabelOnly("ООО Hhr"));
    assert.ok(!isDomainLabelOnly("ООО Татэнерго"));
    assert.ok(!isDomainLabelOnly("Иван Иванов"));
});

test("isBadCompany: composite предикат", () => {
    assert.ok(isBadCompany("Yandex"));
    assert.ok(isBadCompany("Алексей"));
    assert.ok(isBadCompany("Отдел закупок"));
    assert.ok(isBadCompany("Procurement Specialist"));
    assert.ok(isBadCompany(""));
    assert.ok(!isBadCompany("ООО БВС"));
    assert.ok(!isBadCompany("АО Промресурс"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer
// ─────────────────────────────────────────────────────────────────────────────

test("stripRequisiteTails: ИНН / ОГРН / Дата / Устав / адрес", () => {
    assert.equal(
        stripRequisiteTails("ООО «ЛВН-Менеджмент» Дата регистрации предприятия 29.12.2009"),
        "ООО «ЛВН-Менеджмент»"
    );
    assert.equal(
        stripRequisiteTails("ООО Альтермо ИНН 9722061376"),
        "ООО Альтермо"
    );
    assert.equal(
        stripRequisiteTails("АО «Омский каучук» (ИНН 5501023216), г.Омск"),
        "АО «Омский каучук»"
    );
    assert.equal(
        stripRequisiteTails("ООО «ПСИ» Директор (действующий на основании Устава)"),
        "ООО «ПСИ»"
    );
    assert.equal(
        stripRequisiteTails("ООО ТД «МПТ» Организационно-правовая форма Общество с ограниченной ответственностью"),
        "ООО ТД «МПТ»"
    );
});

test("stripRequisiteTails: не режет легитимные короткие компании", () => {
    assert.equal(stripRequisiteTails("ООО БВС"), "ООО БВС");
    assert.equal(stripRequisiteTails("АО Промресурс"), "АО Промресурс");
});

test("splitCompositeForCompany: 'ИП Серебряков А.А. - Алексей'", () => {
    const r = splitCompositeForCompany("ИП Серебряков А.А. - Алексей");
    assert.ok(/ИП/.test(r.company));
    assert.equal(r.person, "Алексей");
});

test("splitCompositeForCompany: 'ООО Энерг. системы - Цыганок Алексей'", () => {
    const r = splitCompositeForCompany("ООО Энергетические системы - Цыганок Алексей Александрович");
    assert.ok(/ООО/.test(r.company));
    assert.equal(r.person, "Цыганок Алексей Александрович");
});

test("splitCompositeForCompany: 'Person (ООО Company)'", () => {
    const r = splitCompositeForCompany("Елена Ананьева (ООО Металлургический Сервис)");
    assert.ok(/ООО/.test(r.company));
    assert.equal(r.person, "Елена Ананьева");
});

test("splitCompositeForCompany: 'Иван Иванов | Neo'", () => {
    const r = splitCompositeForCompany("Иван Иванов | Neo");
    // "Neo" — бренд без legal marker; но это "company candidate"
    assert.equal(r.person, "Иван Иванов");
    assert.equal(r.company, "Neo");
});

test("splitCompositeForCompany: пустой вход → null", () => {
    const r = splitCompositeForCompany("");
    assert.equal(r.company, null);
    assert.equal(r.person, null);
});

test("normalizeLegalQuotes: ООО \"X\" → ООО «X»", () => {
    assert.equal(normalizeLegalQuotes('ООО "БВС"'), "ООО «БВС»");
    assert.equal(normalizeLegalQuotes("ООО 'БВС'"), "ООО «БВС»");
    assert.equal(normalizeLegalQuotes("ООО «БВС»"), "ООО «БВС»");
    assert.equal(normalizeLegalQuotes("ООО БВС"), "ООО БВС");
});

test("normalizeCompanyName: trim + collapse", () => {
    assert.equal(normalizeCompanyName("  ООО   БВС  "), "ООО БВС");
    assert.equal(normalizeCompanyName(""), "");
    assert.equal(normalizeCompanyName(null), "");
});

// ─────────────────────────────────────────────────────────────────────────────
// Facade extractCompany
// ─────────────────────────────────────────────────────────────────────────────

test("extractCompany: legal pattern в signature предпочитается над domain", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "С уважением, ООО «РДЕ Групп»",
        body: "",
        emailDomain: "rdegroup.ru",
    });
    assert.equal(r.primary, "ООО «РДЕ Групп»");
    assert.equal(r.source, "signature");
    assert.ok(r.confidence >= 0.7);
});

test("extractCompany: generic provider rejected", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "",
        body: "",
        emailDomain: "gmail.com",
    });
    assert.equal(r.primary, null);
    assert.equal(r.needsReview, true);
    assert.ok(r.rejected.some((x) => /provider|generic/i.test(x.reason)));
});

test("extractCompany: yandex.ru не становится Yandex", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "",
        body: "",
        emailDomain: "yandex.ru",
    });
    assert.equal(r.primary, null);
});

test("extractCompany: corporate domain fallback при пустой подписи", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "",
        body: "",
        emailDomain: "tatenergo.ru",
    });
    // Низкая уверенность, но кандидат есть.
    assert.equal(r.primary, "Tatenergo");
    assert.equal(r.source, "email_domain");
    assert.ok(r.confidence < 0.5);
});

test("extractCompany: подпись побеждает domain fallback", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "С уважением, АО Татэнерго",
        body: "",
        emailDomain: "tatenergo.ru",
    });
    assert.equal(r.primary, "АО Татэнерго");
    assert.equal(r.source, "signature");
});

test("extractCompany: overcapture blob очищается", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "ООО «ЛВН-Менеджмент» Дата регистрации 29.12.2009 ИНН 7700000000",
        body: "",
        emailDomain: "lvn.ru",
    });
    assert.equal(r.primary, "ООО «ЛВН-Менеджмент»");
});

test("extractCompany: department/role не становится компанией", () => {
    const r = extractCompany({
        senderDisplay: "Отдел закупок",
        signature: "",
        body: "",
        emailDomain: "rdegroup.ru",
    });
    // Должна быть отвергнута, но сработает fallback в domain.
    assert.notEqual(r.primary, "Отдел закупок");
});

test("extractCompany: person-like rejected", () => {
    const r = extractCompany({
        senderDisplay: "Алексей",
        signature: "",
        body: "",
        emailDomain: "",
    });
    assert.equal(r.primary, null);
    assert.equal(r.needsReview, true);
});

test("extractCompany: composite 'ИП X - Алексей' → company=ИП, person=Алексей", () => {
    const r = extractCompany({
        senderDisplay: "ИП Серебряков А.А. - Алексей",
        signature: "",
        body: "",
        emailDomain: "",
    });
    assert.ok(/ИП/.test(r.primary));
    assert.equal(r.personHint, "Алексей");
});

test("extractCompany: 'ООО X - Иван Иванов'", () => {
    const r = extractCompany({
        senderDisplay: "ООО Энергетические системы - Цыганок Алексей Александрович",
        signature: "",
        body: "",
        emailDomain: "energosys.ru",
    });
    assert.ok(/ООО/.test(r.primary));
    assert.ok(/Цыганок/.test(r.personHint || ""));
});

test("extractCompany: form fields priority над подписью", () => {
    const r = extractCompany({
        formFields: { "Компания": "ООО «FromForm»" },
        senderDisplay: "",
        signature: "С уважением, ООО «FromSignature»",
        body: "",
        emailDomain: "form.ru",
    });
    assert.equal(r.primary, "ООО «FromForm»");
    assert.equal(r.source, "form");
});

test("extractCompany: пустые входы → primary=null + needsReview", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "",
        body: "",
        emailDomain: "",
    });
    assert.equal(r.primary, null);
    assert.equal(r.needsReview, true);
});

test("extractCompany: email contains @ → rejected as company", () => {
    const r = extractCompany({
        senderDisplay: "info@bvs.ru",
        signature: "",
        body: "",
        emailDomain: "bvs.ru",
    });
    assert.notEqual(r.primary, "info@bvs.ru");
});

test("extractCompany: reject если совпадает с personHint (cross-field conflict)", () => {
    const r = extractCompany({
        senderDisplay: "Иван Иванов",
        signature: "",
        body: "",
        emailDomain: "iiv.ru",
        personHint: "Иван Иванов",
    });
    // Company = FIO → не принимать в финал.
    assert.notEqual(r.primary, "Иван Иванов");
});

test("extractCompany: body contains LEGAL pattern", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "",
        body: "Добрый день!\n\nПрошу выставить КП. С уважением, ООО «Галактика»",
        emailDomain: "galaxy.ru",
    });
    assert.equal(r.primary, "ООО «Галактика»");
    assert.equal(r.source, "body");
});

test("extractCompany: rejected candidates в debug", () => {
    const r = extractCompany({
        senderDisplay: "Отдел закупок",
        signature: "",
        body: "",
        emailDomain: "yandex.ru",
    });
    assert.ok(Array.isArray(r.rejected));
    assert.ok(r.rejected.length >= 1);
});

test("extractCompany: raw candidates в debug", () => {
    const r = extractCompany({
        senderDisplay: "",
        signature: "С уважением, ООО «Тест»",
        body: "",
        emailDomain: "test.ru",
    });
    assert.ok(Array.isArray(r.rawCandidates));
    assert.ok(r.rawCandidates.length >= 1);
});
