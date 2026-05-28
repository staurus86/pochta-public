// Phase 12 regression — ART-04 (positions/totalQty) + CONTACT-02 (INN checksum, added in plan 02)

import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeLeadCounts } from "../src/services/email-analyzer.js";

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
