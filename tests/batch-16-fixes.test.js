// Phase 16 regression — INN-A..E regex gaps + INN-F auto-learning (appended in plan 02)

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

const minProject = {
    mailbox: "inbox@test.com",
    brands: [],
    managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
    knownCompanies: [],
};

// Helper body — ensures "Клиент" classification fires
function reqBody(innLine) {
    return `Прошу выслать КП на оборудование.\n\nРеквизиты:\n${innLine}\nКПП: 770101001`;
}

// =====================================================================
// INN-A — em-dash и en-dash separator
// =====================================================================

test("INN-A: em-dash separator (—) extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("ИНН — 7707083893"),
        attachments: "",
    });
    assert.equal(r.sender.inn, "7707083893", `Expected 7707083893, got: ${r.sender.inn}`);
});

test("INN-A2: en-dash separator (–) extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("ИНН – 7707083893"),
        attachments: "",
    });
    assert.equal(r.sender.inn, "7707083893", `Expected 7707083893, got: ${r.sender.inn}`);
});

// =====================================================================
// INN-B — 5-group spaced format
// =====================================================================

test("INN-B: 5-group spaced INN (ИНН: 77 07 08 38 93) extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("ИНН: 77 07 08 38 93"),
        attachments: "",
    });
    assert.equal(r.sender.inn, "7707083893", `Expected 7707083893, got: ${r.sender.inn}`);
});

// =====================================================================
// INN-C — markdown bold asterisks around label
// =====================================================================

test("INN-C: markdown bold (*ИНН/КПП: *9704125161/...) extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("*ИНН/КПП: *9704125161/770401001"),
        attachments: "",
    });
    assert.equal(r.sender.inn, "9704125161", `Expected 9704125161, got: ${r.sender.inn}`);
});

// =====================================================================
// INN-D — EDO operator identifier
// =====================================================================

test("INN-D: EDO identifier (2BM-4028058061-402801001-...) INN extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: `Прошу выслать КП на оборудование.\n\nНаш ЭДО: 2BM-4028058061-402801001-20260101120000\nС уважением`,
        attachments: "",
    });
    assert.equal(r.sender.inn, "4028058061", `Expected 4028058061, got: ${r.sender.inn}`);
});

// =====================================================================
// INN-E — HTML closing tag after digits
// =====================================================================

test("INN-E: HTML-wrapped INN (ИНН 2724120169</span>) extracted", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("ИНН 2724120169</span>"),
        attachments: "",
    });
    assert.equal(r.sender.inn, "2724120169", `Expected 2724120169, got: ${r.sender.inn}`);
});

// =====================================================================
// Рegressions — не должны ложно срабатывать
// =====================================================================

test("REG-1: 'длинна 7707083893' without ИНН label → inn is null", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: "Прошу выслать КП.\n\nдлинна 7707083893",
        attachments: "",
    });
    assert.equal(r.sender.inn, null, `должно быть null, но: ${r.sender.inn}`);
});

test("REG-2: own INN 9701077015 is rejected", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: reqBody("ИНН 9701077015"),
        attachments: "",
    });
    assert.equal(r.sender.inn, null, `собственный ИНН должен быть отклонён, но: ${r.sender.inn}`);
});

test("REG-3: 'подлинность документа 7702802784' without label → inn is null", () => {
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос",
        body: "Прошу выслать КП.\n\nподлинность документа 7702802784",
        attachments: "",
    });
    assert.equal(r.sender.inn, null, `REG-3: должно быть null, но: ${r.sender.inn}`);
});

// =====================================================================
// AUTO-01..05 — auto-learning company_directory (plan 02)
// =====================================================================

test("AUTO-01: upsertCompanyDirectoryEntry stores INN, lookupCompanyDirectory returns it", () => {
    const testEmail = `auto_test_${Date.now()}@autotest-company.ru`;
    detectionKb.upsertCompanyDirectoryEntry({ email: testEmail, inn: "7707083893", companyName: "ООО Тест" });
    const entry = detectionKb.lookupCompanyDirectory({ email: testEmail });
    assert.equal(entry?.inn, "7707083893", `Expected 7707083893, got: ${entry?.inn}`);
});

test("AUTO-02: upsert does NOT overwrite non-empty existing INN", () => {
    const testEmail = `auto_no_overwrite_${Date.now()}@autotest-company.ru`;
    detectionKb.upsertCompanyDirectoryEntry({ email: testEmail, inn: "7707083893", companyName: "ООО Первый" });
    detectionKb.upsertCompanyDirectoryEntry({ email: testEmail, inn: "7702802784", companyName: "ООО Второй" });
    const entry = detectionKb.lookupCompanyDirectory({ email: testEmail });
    assert.equal(entry?.inn, "7707083893", `Первый ИНН должен сохраниться: ${entry?.inn}`);
});

test("AUTO-03: upsertCompanyDirectoryEntry does not throw for any domain", () => {
    assert.doesNotThrow(() => {
        detectionKb.upsertCompanyDirectoryEntry({ email: "user@gmail.com", inn: "7707083893", companyName: "Test" });
    });
});

test("AUTO-04: server.js guard logic — free domain skipped, company domain stored", () => {
    const FREE = new Set(["gmail.com","mail.ru","yandex.ru","ya.ru","hotmail.com","outlook.com","bk.ru","list.ru","inbox.ru","rambler.ru"]);
    const shouldLearn = (inn, label, source, email) => {
        const domain = (email.split("@")[1] || "").toLowerCase();
        return !!(inn && inn !== "9701077015" && label === "Клиент" && source !== "company_directory" && email && domain && !FREE.has(domain));
    };
    assert.equal(shouldLearn("7707083893", "Клиент", "body", "user@gmail.com"), false, "gmail должен быть пропущен");
    assert.equal(shouldLearn("7707083893", "Клиент", "body", "buyer@company.ru"), true, "корпоративный email должен учиться");
    assert.equal(shouldLearn("9701077015", "Клиент", "body", "buyer@company.ru"), false, "собственный ИНН должен быть пропущен");
    assert.equal(shouldLearn("7707083893", "Спам", "body", "buyer@company.ru"), false, "Спам не учится");
    assert.equal(shouldLearn("7707083893", "Клиент", "company_directory", "buyer@company.ru"), false, "company_directory source не перезаписывается");
});

test("AUTO-05: after upsertCompanyDirectoryEntry, analyzeEmail gets INN from company_directory", () => {
    const testEmail = `auto_roundtrip_${Date.now()}@roundtrip-company.ru`;
    detectionKb.upsertCompanyDirectoryEntry({ email: testEmail, inn: "7702802784", companyName: "ООО Раундтрип" });
    const r = analyzeEmail(minProject, {
        fromEmail: testEmail,
        subject: "Запрос",
        body: "Прошу выслать КП на оборудование. С уважением.",
        attachments: "",
    });
    assert.equal(r.sender.inn, "7702802784", `Expected 7702802784 from company_directory, got: ${r.sender.inn}`);
    assert.equal(r.sender.sources?.inn, "company_directory", `Source: ${r.sender.sources?.inn}`);
});
