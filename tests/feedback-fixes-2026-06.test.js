// feedback-fixes-2026-06.test.js
// Regression suite for the 2026-06-11 n8n feedback session (manager-flagged errors):
//   - cid/image content-id tokens and network standards are not articles
//   - dimension tokens (full and clipped-tail) are not articles
//   - genuine vendor prefixes are not "transliterated Cyrillic" payload noise,
//     while real translit garbage still is
//   - digit-dense industrial product names are not phone-like

import { test } from "node:test";
import assert from "node:assert/strict";

import { isObviousArticleNoise } from "../src/services/email-analyzer.js";
import { isPhoneLike } from "../src/services/product-name-filters.js";

test("cid content-id token is article noise", () => {
    assert.equal(
        isObviousArticleNoise("C87CD170", "[cid:image001.png@01DC9140.C87CD170]"),
        true
    );
});

test("network standard 100BASE-TX is article noise", () => {
    assert.equal(isObviousArticleNoise("100BASE-TX", ""), true);
    assert.equal(isObviousArticleNoise("10BASE-T", ""), true);
});

test("decimal dimension triple is article noise, clipped tail too", () => {
    assert.equal(isObviousArticleNoise("601.7x605.5x318.4", ""), true);
    assert.equal(isObviousArticleNoise("x605.5x318.4", ""), true);
});

test("digit-dense industrial name is not phone-like", () => {
    assert.equal(
        isPhoneLike("Ремкомплект регулятора Tartarini MBN 100х200 полный с мембраной Emerson Process Management Regulator Technologies М2200180Х12"),
        false
    );
    // Real phone lines still are
    assert.equal(isPhoneLike("тел.: +7 (343) 270-12-00 доб. 66483"), true);
});

test("payload translit filter: homoglyph-only tokens rejected, vendor prefixes kept", async () => {
    const { buildSiderusCrmPayload } = await import("../src/services/siderus-crm-sender.js");
    const lead = {
        positionsSource: undefined,
        lineItems: [
            { article: "TCTTRAD-25E-63-SP", quantity: 14, unit: "шт", descriptionRu: "Редуктор" },
            { article: "TIPICTOP T161-160-14", quantity: 20, unit: "шт", descriptionRu: "Тиристор" },
            { article: "HYTPOMEP HI 18-35-1", quantity: 1, unit: "шт", descriptionRu: "" },
        ],
    };
    const payload = buildSiderusCrmPayload(
        { id: "p", name: "p" },
        { analysis: { lead, sender: {} }, subject: "t", attachmentFiles: [] }
    );
    const arts = payload.order_from_mail.map((r) => r.item_number);
    assert.ok(arts.includes("TCTTRAD-25E-63-SP"), `vendor prefix kept: ${arts}`);
    assert.ok(!arts.includes("TIPICTOP T161-160-14"), "translit Тиристор rejected");
    assert.ok(!arts.includes("HYTPOMEP HI 18-35-1"), "translit Нутромер rejected");
});
