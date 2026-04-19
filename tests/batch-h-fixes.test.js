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
    brands: [],
    managerPool: { defaultMop: "Ольга", defaultMoz: "Андрей", brandOwners: [] },
    knownCompanies: []
};

// ------------------------------------------------------------
// H1 — body-grounding gate for applySenderProfileHints
// ------------------------------------------------------------

runTest("senderProfile: brand_hint НЕ применяется если бренда нет в теле", () => {
    // Simulate a sender that has a KB profile with brand_hint "TACHTROL" but the new
    // email body does not mention TACHTROL at all. Before H1, applySenderProfileHints
    // would blindly inject TACHTROL into classification.detectedBrands. After H1 the
    // body-grounding gate drops the hint when no evidence is found in subject+body.
    const fakeEmail = "ghost-brand-test-h1@example-unknown-domain-xxxx.test";
    let restoreMatch = null;
    let restoreAliases = null;
    const origMatch = detectionKb.matchSenderProfile;
    const origAliases = detectionKb.getBrandAliases;
    try {
        detectionKb.matchSenderProfile = function patched(email) {
            if (String(email || "").toLowerCase() === fakeEmail) {
                return { company_hint: "", brand_hint: "TACHTROL" };
            }
            return origMatch ? origMatch.call(detectionKb, email) : null;
        };
        restoreMatch = () => { detectionKb.matchSenderProfile = origMatch; };
        // Ensure aliases lookup yields nothing for TACHTROL in the small evidence text.
        detectionKb.getBrandAliases = function patched() {
            return origAliases ? origAliases.call(detectionKb) : [];
        };
        restoreAliases = () => { detectionKb.getBrandAliases = origAliases; };

        const analysis = analyzeEmail(project, {
            fromName: "Buyer",
            fromEmail: fakeEmail,
            subject: "Запрос на прокладки и уплотнения",
            attachments: "",
            body: "Добрый день, нужны уплотнения 10 штук для трубопровода, артикул ABC-123"
        });
        const brands = (analysis.detectedBrands || analysis.lead?.detectedBrands || [])
            .map((b) => String(b).toLowerCase());
        assert.ok(
            !brands.some((b) => b.includes("tachtrol")),
            `Expected no TACHTROL ghost brand from sender_profile hint, got: ${JSON.stringify(brands)}`
        );
    } finally {
        if (restoreMatch) restoreMatch();
        if (restoreAliases) restoreAliases();
    }
});

// ------------------------------------------------------------
// H3 — truncated UUID filter
// ------------------------------------------------------------

runTest("article-noise: truncated UUID без префикса (658ba197-6c73-4fea-91) не попадает в артикулы", () => {
    // Raw isObviousArticleNoise check — the tightened regex should catch both classic
    // UUIDs and truncated fragments (last segment <3 chars).
    assert.equal(isObviousArticleNoise("658ba197-6c73-4fea-91", ""), true,
        "Truncated UUID 658ba197-6c73-4fea-91 must be rejected as article noise");
    assert.equal(isObviousArticleNoise("550e8400-e29b-41d4-a716-446655440000", ""), true,
        "Full canonical UUID must still be rejected");
    // Sanity: a legitimate article code with hyphens should still pass.
    assert.equal(isObviousArticleNoise("ESQ-GS9-320", ""), false,
        "Legitimate article ESQ-GS9-320 must NOT be rejected");
});

// ------------------------------------------------------------
// H4 — productNames dedup + quoted-reply header filter
// ------------------------------------------------------------

runTest("productNames: дубли схлопываются; 'Сообщение: Здравствуйте' и '> Сообщение:' отфильтрованы", () => {
    const analysis = analyzeEmail(project, {
        fromName: "Клиент Тестов",
        fromEmail: "client@example.com",
        subject: "Запрос",
        attachments: "",
        body: [
            "Добрый день!",
            "Прошу предложить:",
            "1. Шаровый кран ABC-123 — 2 шт",
            "1. Шаровый кран ABC-123 — 2 шт",
            "Сообщение: Здравствуйте, нужна цена.",
            "> Сообщение: дубль цитаты"
        ].join("\n")
    });
    const pn = analysis.lead?.productNames || [];
    const names = pn.map((p) => String(p?.name || "").trim());
    // No leaked 'Сообщение:' headers.
    assert.ok(
        !names.some((n) => /^(?:>\s*)?сообщение\s*[:：]/i.test(n)),
        `Leaked reply-header in productNames: ${JSON.stringify(names)}`
    );
    assert.ok(
        !names.some((n) => /^>/.test(n)),
        `Leaked '>' quoted-line in productNames: ${JSON.stringify(names)}`
    );
    // Dedup: no (article, normalized-name) appears twice.
    const seen = new Set();
    for (const p of pn) {
        const key = `${String(p?.article || "").trim().toLowerCase()}|${String(p?.name || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
        assert.ok(!seen.has(key), `Duplicate productName entry not deduped: ${key}`);
        seen.add(key);
    }
    const articles = analysis.lead?.articles || [];
    const aSeen = new Set();
    for (const a of articles) {
        const key = String(a || "").trim().toLowerCase();
        if (!key) continue;
        assert.ok(!aSeen.has(key), `Duplicate article not deduped: ${key}`);
        aSeen.add(key);
    }
});
