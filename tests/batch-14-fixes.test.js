// Phase 14 regression — BRAND-02 (subject priority) + BRAND-03 (short alias rejection)
// + PROD-01 (numbered list) + PROD-02 (HTML dedup) — PROD-01/02 appended in plan 02

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

const minProject = {
    mailbox: "inbox@test.com",
    brands: ["Siemens", "ABB"],
    managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
    knownCompanies: [],
};

// =====================================================================
// BRAND-02 — Subject-priority brands survive P15/P18 grounding gates
// =====================================================================

test("BRAND-02: brand in subject only → survives grounding gates, appears in lead.detectedBrands", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос Siemens PLC",
        body: "Добрый день. Просим предоставить информацию по данной позиции. С уважением.",
        attachments: "",
    });
    const brands = result.lead?.detectedBrands || [];
    assert.ok(
        brands.some((b) => /siemens/i.test(b)),
        `Expected "Siemens" in lead.detectedBrands, got: ${JSON.stringify(brands)}`
    );
});

test("BRAND-02 regression: no brand in subject or body → detectedBrands empty or no spurious brand", () => {
    const result = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос на оборудование",
        body: "Добрый день. Просим предоставить информацию.",
        attachments: "",
    });
    const brands = result.lead?.detectedBrands || [];
    assert.ok(
        !brands.some((b) => /siemens/i.test(b)),
        `No brand in subject/body — Siemens must NOT appear, got: ${JSON.stringify(brands)}`
    );
});

// =====================================================================
// BRAND-03 — 1-2 char single-token aliases do not produce brand hits
// =====================================================================

test("BRAND-03: 2-char alias 'av' does not fire brand match via detectionKb.detectBrands", () => {
    // "av" (2-char) is a known alias in the KB (→ "AV" canonical)
    // After fix, detectBrands must reject it
    const result = detectionKb.detectBrands("нужен av блок управления для насоса", []);
    assert.ok(
        !result.some((b) => /^av$/i.test(b)),
        `2-char alias "av" must not fire brand match, got: ${JSON.stringify(result)}`
    );
});

test("BRAND-03 regression: 3-char alias 'abb' still matches canonical ABB", () => {
    // "abb" (3-char) is a legitimate alias for ABB — must NOT be blocked by the ≤2-char guard
    const result = detectionKb.detectBrands("нужен контактор abb серии А", []);
    assert.ok(
        result.some((b) => /^abb$/i.test(b)),
        `3-char alias "abb" must still match ABB, got: ${JSON.stringify(result)}`
    );
});
