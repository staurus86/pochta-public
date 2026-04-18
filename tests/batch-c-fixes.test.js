import assert from "node:assert/strict";
import { stripQuotedReply } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

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

// ------------------------------------------------------------
// Patch 1 — mailbox→brand fallback for empty brand detection
// The fallback block in project3-runner.js mutates `analysis`; we reproduce
// it here and verify the mutation shape (Клиент + empty brands → brand filled).
// ------------------------------------------------------------

function applyMailboxFallback(item, analysis) {
    if (
        item.brand &&
        analysis.classification?.label === "Клиент" &&
        analysis.lead &&
        (!analysis.lead.detectedBrands || analysis.lead.detectedBrands.length === 0)
    ) {
        analysis.lead.detectedBrands = [item.brand];
        analysis.lead.sources = analysis.lead.sources || {};
        analysis.lead.sources.brands = "mailbox_fallback";
        if (analysis.classification && (!analysis.classification.detectedBrands || analysis.classification.detectedBrands.length === 0)) {
            analysis.classification.detectedBrands = [item.brand];
        }
    }
    return analysis;
}

runTest("mailbox-fallback: Клиент with empty brands gets mailbox brand", () => {
    const item = { brand: "Vahle" };
    const analysis = {
        classification: { label: "Клиент", detectedBrands: [] },
        lead: { detectedBrands: [] }
    };
    const result = applyMailboxFallback(item, analysis);
    assert.deepEqual(result.lead.detectedBrands, ["Vahle"]);
    assert.equal(result.lead.sources.brands, "mailbox_fallback");
    assert.deepEqual(result.classification.detectedBrands, ["Vahle"]);
});

runTest("mailbox-fallback: undefined lead.detectedBrands is treated as empty", () => {
    const item = { brand: "Petersime" };
    const analysis = {
        classification: { label: "Клиент" },
        lead: {}
    };
    const result = applyMailboxFallback(item, analysis);
    assert.deepEqual(result.lead.detectedBrands, ["Petersime"]);
    assert.equal(result.lead.sources.brands, "mailbox_fallback");
});

runTest("mailbox-fallback: already-detected brands are NOT overwritten", () => {
    const item = { brand: "Vahle" };
    const analysis = {
        classification: { label: "Клиент", detectedBrands: ["Siemens"] },
        lead: { detectedBrands: ["Siemens"] }
    };
    const result = applyMailboxFallback(item, analysis);
    assert.deepEqual(result.lead.detectedBrands, ["Siemens"]);
    // sources not modified when fallback didn't fire
    assert.equal(result.lead.sources, undefined);
});

runTest("mailbox-fallback: SPAM classification never triggers fallback", () => {
    const item = { brand: "Vahle" };
    const analysis = {
        classification: { label: "СПАМ", detectedBrands: [] },
        lead: { detectedBrands: [] }
    };
    const result = applyMailboxFallback(item, analysis);
    assert.deepEqual(result.lead.detectedBrands, []);
    assert.equal(result.lead.sources, undefined);
});

runTest("mailbox-fallback: empty item.brand does not set 'undefined' brand", () => {
    const item = { brand: "" };
    const analysis = {
        classification: { label: "Клиент", detectedBrands: [] },
        lead: { detectedBrands: [] }
    };
    const result = applyMailboxFallback(item, analysis);
    assert.deepEqual(result.lead.detectedBrands, []);
});

// ------------------------------------------------------------
// Patch 2 — stripQuotedReply
// ------------------------------------------------------------

runTest("stripQuotedReply: cuts at 'From:' separator", () => {
    const body = [
        "Добрый день!",
        "Прошу выставить счёт.",
        "С уважением, Иван Иванов",
        "Менеджер по продажам",
        "ООО Клиент",
        "",
        "From: siderus@example.com",
        "Здравствуйте,",
        "Екатерина Попова",
        "Офис-менеджер",
        "ООО «КОЛОВРАТ»"
    ].join("\n");
    const out = stripQuotedReply(body);
    assert.ok(out.includes("Менеджер по продажам"), "must keep sender's position");
    assert.ok(!/Офис-менеджер/.test(out), "must strip our signature in quoted block");
    assert.ok(!/КОЛОВРАТ/.test(out));
});

runTest("stripQuotedReply: cuts at 'Отправлено:' separator", () => {
    const body = [
        "Здравствуйте.",
        "Нужен Vahle 12345.",
        "С уважением, Пётр Петров",
        "Инженер",
        "",
        "Отправлено: Четверг, 17 апреля 2026",
        "Екатерина Попова",
        "Офис-менеджер SIDERUS"
    ].join("\n");
    const out = stripQuotedReply(body);
    assert.ok(out.includes("Инженер"));
    assert.ok(!/Офис-менеджер/.test(out));
});

runTest("stripQuotedReply: removes '>' quoted lines", () => {
    const body = [
        "Добрый день!",
        "Коммерческое, пожалуйста.",
        "Алексей Алексеев",
        "Ведущий инженер",
        "",
        "> Здравствуйте,",
        "> Екатерина Попова,",
        "> Офис-менеджер, ООО «КОЛОВРАТ» | SIDERUS"
    ].join("\n");
    const out = stripQuotedReply(body);
    assert.ok(out.includes("Ведущий инженер"));
    assert.ok(!/Офис-менеджер/.test(out));
    assert.ok(!/КОЛОВРАТ/.test(out));
});

runTest("stripQuotedReply: keeps body when no quote separators", () => {
    const body = "Прошу КП на Vahle\n\nИван Иванов\nМенеджер";
    const out = stripQuotedReply(body);
    assert.equal(out, body);
});

runTest("stripQuotedReply: handles null/empty input", () => {
    assert.equal(stripQuotedReply(""), "");
    assert.equal(stripQuotedReply(null), null);
    assert.equal(stripQuotedReply(undefined), undefined);
});

runTest("stripQuotedReply: cuts at '----- Original Message -----' separator", () => {
    const body = [
        "Нужно уточнить по запросу.",
        "Мария Сидорова",
        "Специалист по закупкам",
        "",
        "----- Исходное сообщение -----",
        "Екатерина Попова",
        "Офис-менеджер"
    ].join("\n");
    const out = stripQuotedReply(body);
    assert.ok(out.includes("Специалист по закупкам"));
    assert.ok(!/Офис-менеджер/.test(out));
});

runTest("stripQuotedReply: cuts at 'В письме от ... пишет:' separator", () => {
    const body = [
        "Спасибо, учту.",
        "Андрей Андреев",
        "Руководитель отдела снабжения",
        "",
        "17.04.2026, 10:30, siderus@example.com пишет:",
        "> Екатерина Попова",
        "> Офис-менеджер"
    ].join("\n");
    const out = stripQuotedReply(body);
    assert.ok(out.includes("Руководитель отдела снабжения"));
    assert.ok(!/Офис-менеджер/.test(out));
});

// ------------------------------------------------------------
// Patch 3 — DEFAULT_BRAND_ALIASES seeds new entries
// The singleton `detectionKb` calls seedDefaults() on construction
// (idempotent INSERT-WHERE-NOT-EXISTS), so the new rows must be present.
// ------------------------------------------------------------

runTest("brand-aliases seed: Petersime 'питерсайм' present", () => {
    const aliases = detectionKb.getBrandAliases();
    const match = aliases.find(
        (row) => row.canonical_brand === "Petersime" && row.alias === "питерсайм"
    );
    assert.ok(match, "expected seed row Petersime→питерсайм to exist");
});

runTest("brand-aliases seed: Petersime 'петерсайм' present", () => {
    const aliases = detectionKb.getBrandAliases();
    const match = aliases.find(
        (row) => row.canonical_brand === "Petersime" && row.alias === "петерсайм"
    );
    assert.ok(match, "expected seed row Petersime→петерсайм to exist");
});

runTest("brand-aliases seed: Vahle 'paul vahle' present", () => {
    const aliases = detectionKb.getBrandAliases();
    const match = aliases.find(
        (row) => row.canonical_brand === "Vahle" && row.alias === "paul vahle"
    );
    assert.ok(match, "expected seed row Vahle→paul vahle to exist");
});

runTest("brand-aliases seed: Schischek 'schischek' present", () => {
    const aliases = detectionKb.getBrandAliases();
    const match = aliases.find(
        (row) => row.canonical_brand === "Schischek" && row.alias === "schischek"
    );
    assert.ok(match, "expected seed row Schischek→schischek to exist");
});
