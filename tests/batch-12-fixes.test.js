// Phase 12 regression — ART-04 (positions/totalQty) + CONTACT-02 (INN checksum) + CONTACT-01 (attachment checksum)

import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeLeadCounts, validateInnChecksum, normalizeInn } from "../src/services/email-analyzer.js";
import { validateInnChecksum as validateInnChecksumAttachment } from "../src/services/attachment-content.js";

// =====================================================================
// ART-04 — positions/totalQty deduplication (finalizeLeadCounts)
// =====================================================================

test("ART-04 Belgormash: 18 dup lineItems → positions 2, totalQty 10", () => {
    const dup = (code, qty) => ({ article: code, quantity: qty });
    const lead = {
        articles: ["MD-025-6L", "AB 100"],
        lineItems: [
            ...Array(9).fill(dup("MD-025-6L", 5)),
            ...Array(9).fill(dup("AB 100", 5)),
        ],
    };
    finalizeLeadCounts(lead);
    assert.equal(lead.positions, 2);
    assert.equal(lead.totalQty, 10);
});

test("ART-04 dedup picks max qty: same code with qty 3 and 7 → totalQty 7", () => {
    const lead = {
        articles: ["XY-100"],
        lineItems: [
            { article: "XY-100", quantity: 3 },
            { article: "XY-100", quantity: 7 },
        ],
    };
    finalizeLeadCounts(lead);
    assert.equal(lead.positions, 1);
    assert.equal(lead.totalQty, 7);
});

test("ART-04 null qty counts as 0: two unique codes, one null qty", () => {
    const lead = {
        articles: ["AA-1", "BB-2"],
        lineItems: [
            { article: "AA-1", quantity: 5 },
            { article: "BB-2", quantity: null },
        ],
    };
    finalizeLeadCounts(lead);
    assert.equal(lead.positions, 2);
    assert.equal(lead.totalQty, 5);
});

test("ART-04 no articles: positions === 0 (strict, not undefined) and totalQty === 0", () => {
    const lead = {
        articles: [],
        lineItems: [],
    };
    finalizeLeadCounts(lead);
    assert.strictEqual(lead.positions, 0);
    assert.strictEqual(lead.totalQty, 0);
});

test("ART-04 article without lineItem counts toward positions with qty 0", () => {
    const lead = {
        articles: ["SOLO-999"],
        lineItems: [],
    };
    finalizeLeadCounts(lead);
    assert.equal(lead.positions, 1);
    assert.equal(lead.totalQty, 0);
});

// =====================================================================
// CONTACT-02 — FNS mod-11 INN checksum (validateInnChecksum + normalizeInn)
// =====================================================================

test("CONTACT-02 validateInnChecksum: valid 10-digit (Сбербанк 7707083893) → true", () => {
    assert.equal(validateInnChecksum("7707083893"), true);
});

test("CONTACT-02 validateInnChecksum: invalid 10-digit (1234567890) → false", () => {
    assert.equal(validateInnChecksum("1234567890"), false);
});

test("CONTACT-02 validateInnChecksum: 9-digit Belarus УНП → true (no checksum)", () => {
    assert.equal(validateInnChecksum("123456789"), true);
});

test("CONTACT-02 validateInnChecksum: valid 12-digit ИП (500100732259) → true", () => {
    assert.equal(validateInnChecksum("500100732259"), true);
});

test("CONTACT-02 validateInnChecksum: invalid 12-digit ИП (flip last digit: 500100732250) → false", () => {
    assert.equal(validateInnChecksum("500100732250"), false);
});

test("CONTACT-02 normalizeInn: valid INN accepted (7707083893)", () => {
    assert.equal(normalizeInn("7707083893"), "7707083893");
});

test("CONTACT-02 normalizeInn: invalid INN rejected (1234567890) → null", () => {
    assert.equal(normalizeInn("1234567890"), null);
});

test("CONTACT-02 normalizeInn: strips non-digits then validates (ИНН: 7707083893)", () => {
    assert.equal(normalizeInn("ИНН: 7707083893"), "7707083893");
});

test("CONTACT-02 normalizeInn: valid 12-digit ИП accepted (500100732259)", () => {
    assert.equal(normalizeInn("500100732259"), "500100732259");
});

test("CONTACT-02 normalizeInn: invalid 12-digit ИП rejected (500100732250) → null", () => {
    assert.equal(normalizeInn("500100732250"), null);
});

// =====================================================================
// CONTACT-01 — Attachment validateInnChecksum parity with email-analyzer
// =====================================================================

test("CONTACT-01 attachment validateInnChecksum: valid INN accepted, invalid dropped", () => {
    const candidates = ["7707083893", "1234567890"];
    const filtered = candidates.filter(validateInnChecksumAttachment);
    assert.deepEqual(filtered, ["7707083893"]);
});

test("CONTACT-01 attachment validateInnChecksum: algorithm matches email-analyzer version", () => {
    const cases = ["7707083893", "1234567890", "123456789", "500100732259", "500100732250"];
    for (const v of cases) {
        assert.equal(
            validateInnChecksumAttachment(v),
            validateInnChecksum(v),
            `parity mismatch for ${v}`
        );
    }
});
