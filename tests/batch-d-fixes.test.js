import assert from "node:assert/strict";
import { analyzeEmail, isObviousArticleNoise } from "../src/services/email-analyzer.js";

function runTest(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
    }
}

const project = {
    mailbox: "inbox@example.com",
    brands: [
        "Alfa Electric",
        "Alfa Meccanica",
        "Alfa Valvole",
        "Power Innovation",
        "SMW-AUTOBLOK",
        "Fisher",
        "High Perfection Tech"
    ],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

// ------------------------------------------------------------
// P12 — reject articles that equal the from-email local part
// ------------------------------------------------------------

runTest("P12: article == fromLocal → flagged by isObviousArticleNoise", () => {
    // With ctx.fromLocal passed, normalized code equal to local part must be rejected.
    assert.equal(
        isObviousArticleNoise("snab-2", "Здравствуйте snab-2", { fromLocal: "snab-2" }),
        true
    );
});

runTest("P12: article similar but not equal to fromLocal → NOT flagged for this reason", () => {
    // A normal article that does NOT equal the local part must still behave as before.
    // Here "ABC-123" is neither a pure year, nor cyrillic-only, nor equal to "buyer".
    assert.equal(
        isObviousArticleNoise("ABC-123", "Артикул: ABC-123", { fromLocal: "buyer" }),
        false
    );
});

runTest("P12: no fromEmail context passed → legacy behavior unchanged", () => {
    // Batch B still flags pure Cyrillic words; that must keep working when no ctx is given.
    assert.equal(isObviousArticleNoise("Конический", "Продукт: Конический"), true);
    // And a real-looking article must still pass without ctx.
    assert.equal(isObviousArticleNoise("ABC-123", "Артикул: ABC-123"), false);
});

runTest("P12: analyzeEmail strips article equal to sender local part from lead", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Snab",
        fromEmail: "snab-2@stroy-komplex.com",
        subject: "Запрос",
        attachments: "",
        body: "Добрый день. С уважением, snab-2."
    });
    assert.ok(
        !(analysis.lead.articles || []).some((a) => String(a).toLowerCase() === "snab-2"),
        `Expected 'snab-2' article to be filtered, got: ${JSON.stringify(analysis.lead.articles)}`
    );
});

// ------------------------------------------------------------
// P13 — block ALFA-family contiguous multi-word false match
// ------------------------------------------------------------

runTest("P13: 'Alfa Laval spare part' does NOT emit 'Alfa Electric'/'Alfa Meccanica'/'Alfa Valvole'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос по Alfa Laval",
        attachments: "",
        body: "Добрый день. Нужны запчасти Alfa Laval spare part, арт ABC-123 x 2 шт."
    });
    const brands = analysis.lead.detectedBrands || [];
    assert.ok(!brands.some((b) => /alfa\s+electric/i.test(b)),
        `Expected no 'Alfa Electric', got: ${JSON.stringify(brands)}`);
    assert.ok(!brands.some((b) => /alfa\s+meccanica/i.test(b)),
        `Expected no 'Alfa Meccanica', got: ${JSON.stringify(brands)}`);
    assert.ok(!brands.some((b) => /alfa\s+valvole/i.test(b)),
        `Expected no 'Alfa Valvole', got: ${JSON.stringify(brands)}`);
});

runTest("P13: real 'ALFA ELECTRIC VF-400' mention DOES match 'Alfa Electric'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос ALFA ELECTRIC VF-400",
        attachments: "",
        body: "Добрый день. Нужна цена на ALFA ELECTRIC VF-400, 5 шт."
    });
    const brands = (analysis.lead.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.some((b) => b.includes("alfa") && b.includes("electric")),
        `Expected 'Alfa Electric' to match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("P13: 'Power Innovation GmbH' still matches 'Power Innovation' (Batch A regression)", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос Power Innovation",
        attachments: "",
        body: "Добрый день. Нужна цена на Power Innovation GmbH модели XYZ, 5 шт."
    });
    const brands = (analysis.lead.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.some((b) => b.includes("power") && b.includes("innovation")),
        `Expected 'Power Innovation' to match, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

// ------------------------------------------------------------
// P14 — gate KB-inferred brands behind textual overlap
// ------------------------------------------------------------
// The gate only fires when extractLead/classify produced ZERO brands up-front and
// enrichLeadFromKnowledgeBase is invoked with catalog hits. We simulate that condition
// with a body devoid of any known brand alias or article.

runTest("P14: KB-inferred brand with NO body overlap → NOT promoted to detectedBrands", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        // Body mentions no brand name and no article — but uses generic product words
        // that FTS over catalog descriptions might hit (e.g. "pressure", "diaphragm").
        body: "Добрый день. Нужна мембрана и насос для дозирования раствора."
    });
    const brands = (analysis.lead.detectedBrands || []).map((b) => b.toLowerCase());
    // No brand from the project list should leak because none of their aliases
    // appear in the body and no lineItem articles tie to them.
    assert.ok(
        !brands.includes("high perfection tech"),
        `Expected no 'High Perfection Tech' leak, got: ${JSON.stringify(analysis.lead.detectedBrands)}`
    );
});

runTest("P14: brand with direct body mention → DOES appear in detectedBrands", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос Fisher",
        attachments: "",
        body: "Добрый день. Нужна цена на Fisher FIELDVUE x 2 шт."
    });
    const brands = (analysis.lead.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(brands.includes("fisher"),
        `Expected 'Fisher' to be kept, got: ${JSON.stringify(analysis.lead.detectedBrands)}`);
});

runTest("P14: no brand leak on body without any brand mention (negative regression)", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Общий вопрос",
        attachments: "",
        body: "Добрый день. Просьба прислать прайс на продукцию."
    });
    const brands = analysis.lead.detectedBrands || [];
    // An empty body must not produce any ghost brands via KB enrichment.
    assert.ok(brands.length === 0 || !brands.some((b) => /simrit|corteco|nilos|spm|pressure tech/i.test(b)),
        `Expected no KB-inferred ghost brands, got: ${JSON.stringify(brands)}`);
});
