// Phase 13 regression — CONTACT-03 (FIO template blocklist) + CONTACT-04 (intl phone coverage, added in plan 02)

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSenderFields, analyzeEmail } from "../src/services/email-analyzer.js";

const minProject = {
    mailbox: "inbox@test.com",
    brands: [],
    managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
    knownCompanies: [],
};

// =====================================================================
// CONTACT-03 — FIO template blocklist (validateSenderFields step 0c)
// =====================================================================

function makeSender(fullName, existingContactNameRaw = null) {
    return {
        fullName,
        contactNameRaw: existingContactNameRaw,
        sources: { name: "robot_form", phone: null, company: null, inn: null },
    };
}

test("CONTACT-03 blocklist: 'Екатерина Попова' → fullName null, contactNameRaw preserved", () => {
    const s = makeSender("Екатерина Попова");
    validateSenderFields(s);
    assert.strictEqual(s.fullName, null);
    assert.strictEqual(s.contactNameRaw, "Екатерина Попова");
    assert.strictEqual(s.sources.name, null);
});

test("CONTACT-03 blocklist: lowercase 'екатерина попова' also rejected", () => {
    const s = makeSender("екатерина попова");
    validateSenderFields(s);
    assert.strictEqual(s.fullName, null);
});

test("CONTACT-03 blocklist: real client name 'Иван Петров' passes through unchanged", () => {
    const s = makeSender("Иван Петров");
    validateSenderFields(s);
    assert.strictEqual(s.fullName, "Иван Петров");
});

test("CONTACT-03 blocklist: contactNameRaw not overwritten when already set", () => {
    const s = makeSender("Екатерина Попова", "previous value");
    validateSenderFields(s);
    assert.strictEqual(s.fullName, null);
    assert.strictEqual(s.contactNameRaw, "previous value");
});

// =====================================================================
// CONTACT-04 — International phone normalization (+375 BY, +86 CN, +994 AZ)
// =====================================================================

function getPhone(result) {
    const s = result?.sender || {};
    return s.cityPhone || s.mobilePhone || null;
}
function phoneDigits(ph) {
    return (ph || "").replace(/\D/g, "");
}

test("CONTACT-04 BY: +375 29 123-45-67 in body → phone stored, 10-15 digits", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@example.by",
        subject: "Запрос оборудования",
        body: "Добрый день.\nТелефон: +375 29 123-45-67\nПрошу выслать КП на ABB S201-C16 x 2 шт.",
        attachments: "",
    });
    const ph = getPhone(result);
    assert.ok(ph, `phone must be stored, got: ${ph}`);
    const d = phoneDigits(ph);
    assert.ok(d.length >= 10 && d.length <= 15, `digit count ${d.length} out of range for: ${ph}`);
});

test("CONTACT-04 CN: +86 138 1234 5678 in body → phone stored, 10-15 digits", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@example.cn",
        subject: "Inquiry",
        body: "Hello.\nPhone: +86 138 1234 5678\nWe need ABB S201-C16 x 5 pcs.",
        attachments: "",
    });
    const ph = getPhone(result);
    assert.ok(ph, `phone must be stored, got: ${ph}`);
    const d = phoneDigits(ph);
    assert.ok(d.length >= 10 && d.length <= 15, `digit count ${d.length} out of range for: ${ph}`);
});

test("CONTACT-04 AZ: +994 50 123 45 67 in body → phone stored, 10-15 digits", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@example.az",
        subject: "Запрос",
        body: "Добрый день.\nТел: +994 50 123 45 67\nАртикул ABB S201-C16 x 1 шт.",
        attachments: "",
    });
    const ph = getPhone(result);
    assert.ok(ph, `phone must be stored, got: ${ph}`);
    const d = phoneDigits(ph);
    assert.ok(d.length >= 10 && d.length <= 15, `digit count ${d.length} out of range for: ${ph}`);
});

test("CONTACT-04 RU regression: +7 916 123-45-67 still stored correctly", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@example.ru",
        subject: "Запрос",
        body: "Добрый день.\nТел: +7 916 123-45-67\nАртикул ABB S201-C16 x 3 шт.",
        attachments: "",
    });
    const ph = getPhone(result);
    assert.ok(ph, `RU phone must be stored, got: ${ph}`);
    const d = phoneDigits(ph);
    assert.ok(d.length >= 10 && d.length <= 15, `digit count ${d.length} out of range for: ${ph}`);
});
