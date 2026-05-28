// Phase 13 regression — CONTACT-03 (FIO template blocklist) + CONTACT-04 (intl phone coverage, added in plan 02)

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSenderFields } from "../src/services/email-analyzer.js";

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
