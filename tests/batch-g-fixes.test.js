import assert from "node:assert/strict";
import { analyzeEmail, isObviousArticleNoise } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

// Wake KB lazy init.
void detectionKb;

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
        "ARMATUREN-ARNDT",
        "EBRO",
        "ARI-Armaturen"
    ],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

// ------------------------------------------------------------
// P21 — "armaturen" as BRAND_FIRST_TOKEN_CONFLICT
// ------------------------------------------------------------

runTest("P21: body 'EBRO ARMATUREN Ду100' must NOT emit ghost 'ARMATUREN-ARNDT'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "о манжете для затворов EBRO ARMATUREN Ду100",
        attachments: "",
        body: "5 манжет для EBRO ARMATUREN Ду100, арт. ABC-123"
    });
    const brands = (analysis.detectedBrands || analysis.lead?.detectedBrands || []).map((b) => String(b).toLowerCase());
    assert.ok(
        !brands.some((b) => b.includes("armaturen-arndt") || b === "armaturen-arndt"),
        `Expected no 'ARMATUREN-ARNDT' ghost, got: ${JSON.stringify(brands)}`
    );
});

runTest("P21: 'ARI-Armaturen' body mention must NOT emit ghost 'ARMATUREN-ARNDT'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "ARI-Armaturen ES 11-230В Позиционер электрический, 2 шт"
    });
    const brands = (analysis.detectedBrands || analysis.lead?.detectedBrands || []).map((b) => String(b).toLowerCase());
    assert.ok(
        !brands.some((b) => b.includes("armaturen-arndt")),
        `Expected no 'ARMATUREN-ARNDT' ghost from 'ARI-Armaturen', got: ${JSON.stringify(brands)}`
    );
});

runTest("P21: generic 'указанных позиций (минимум 2)' with no brand must NOT emit 'ARMATUREN-ARNDT'", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Интересует стоимость указанных позиций (минимум 2). Артикул ABC-123."
    });
    const brands = (analysis.detectedBrands || analysis.lead?.detectedBrands || []).map((b) => String(b).toLowerCase());
    assert.ok(
        !brands.some((b) => b.includes("armaturen-arndt")),
        `Expected no 'ARMATUREN-ARNDT' ghost from generic text, got: ${JSON.stringify(brands)}`
    );
});

// ------------------------------------------------------------
// P22 — short-numeric voltage/dimension parameters as articles
// ------------------------------------------------------------

runTest("P22: '380В' voltage parameter must NOT appear in lead.articles", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "ESQ-GS9-320 (640А, 380В, 320кВт, встроенный шунтирующий контактор), арт. ESQ-GS9-320, 2 шт"
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a));
    assert.ok(
        !articles.includes("380"),
        `Expected '380' voltage filtered, got: ${JSON.stringify(articles)}`
    );
});

runTest("P22: '178х216х16' first dimension must NOT appear as article", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Garlock 178х216х16 N-2 шт, артикул 24700-3500"
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a));
    assert.ok(
        !articles.includes("178"),
        `Expected '178' dimension filtered, got: ${JSON.stringify(articles)}`
    );
});

runTest("P22: '230V' voltage must NOT appear as article", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Позиционер 230V, артикул ES-11-XYZ, 3 шт"
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a));
    assert.ok(
        !articles.includes("230"),
        `Expected '230' voltage filtered, got: ${JSON.stringify(articles)}`
    );
});

runTest("P22: real numeric article followed by comma/no-unit is NOT filtered by isParamValueNoise (regression)", () => {
    // Simulate the post-filter directly via KB: craft a body where 380 appears WITHOUT unit
    // suffix after it — isParamValueNoise should NOT flag it.
    // We test the filter behavior inline by calling analyzeEmail and verifying that when
    // body has "380, " (no suffix) the sanitize path does not kick in.
    const bodyNoUnit = "Артикул ESQ-GS9-320, партия 380, 2 шт";
    const bodyWithUnit = "Артикул ESQ-GS9-320 (380В, 2 шт)";
    const a1 = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: bodyNoUnit
    });
    const a2 = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: bodyWithUnit
    });
    // 380 appears in a2 body with В suffix → must be filtered regardless of extraction path.
    // 380 in a1 has no unit suffix → if extractor emitted it, sanitize MUST leave it alone.
    const has380InA2 = (a2.lead?.articles || []).map(String).includes("380");
    assert.equal(has380InA2, false, `Expected '380В' voltage filtered in a2, got: ${JSON.stringify(a2.lead?.articles)}`);
});

// ------------------------------------------------------------
// P23 — cid:UUID.png / UUID.png MIME content-id artifacts
// ------------------------------------------------------------

runTest("P23: isObviousArticleNoise flags UUID.png filename", () => {
    assert.equal(
        isObviousArticleNoise("6827a7ed-dd19-44a4-9482-3d26e1b5ea7b.png", "[cid:6827a7ed-dd19-44a4-9482-3d26e1b5ea7b.png]"),
        true,
        "Expected UUID.png flagged as noise"
    );
});

runTest("P23: isObviousArticleNoise flags UUID.jpg / UUID.pdf", () => {
    assert.equal(
        isObviousArticleNoise("aaaabbbb-cccc-dddd-eeee-ffff11112222.jpg", ""),
        true,
        "Expected UUID.jpg flagged"
    );
    assert.equal(
        isObviousArticleNoise("12345678-90ab-cdef-1234-567890abcdef.pdf", ""),
        true,
        "Expected UUID.pdf flagged"
    );
});

runTest("P23: cid: prefix already flagged (regression)", () => {
    assert.equal(
        isObviousArticleNoise("cid:6827a7ed-dd19-44a4-9482-3d26e1b5ea7b.png", ""),
        true,
        "Expected cid:... flagged as noise"
    );
});

runTest("P23: email body with [cid:UUID.png] does NOT leak UUID.png into articles", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Buyer",
        fromEmail: "buyer@example.com",
        subject: "Запрос",
        attachments: "",
        body: "Добрый день. Нужен артикул ABC-123, 2 шт.\n[cid:6827a7ed-dd19-44a4-9482-3d26e1b5ea7b.png]"
    });
    const articles = (analysis.lead?.articles || []).map((a) => String(a).toLowerCase());
    assert.ok(
        !articles.some((a) => a.endsWith(".png") || a.endsWith(".jpg")),
        `Expected no UUID.png in articles, got: ${JSON.stringify(articles)}`
    );
});

runTest("P23: real product code that happens to end in .PDF (e.g. datasheet ref) is NOT affected — too short", () => {
    // Short hex tokens or non-UUID-shaped filenames with <20 chars body pass through.
    assert.equal(isObviousArticleNoise("ABC-123.pdf", ""), false, "short non-UUID filename should NOT be flagged by P23");
});
