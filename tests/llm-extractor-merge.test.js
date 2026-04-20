import test from "node:test";
import assert from "node:assert/strict";
import { classifyLlmPhone, mergeLlmExtraction } from "../src/services/llm-extractor.js";

// ---------------------------------------------------------------------------
// classifyLlmPhone — country-aware phone bucket
// ---------------------------------------------------------------------------

test("classifyLlmPhone: RU mobile +7 9XX → mobile", () => {
    assert.equal(classifyLlmPhone("+7 (921) 784-93-64"), "mobile");
    assert.equal(classifyLlmPhone("89217849364"), "mobile");
    assert.equal(classifyLlmPhone("+79161234567"), "mobile");
});

test("classifyLlmPhone: RU city +7 4XX/8XX → city", () => {
    assert.equal(classifyLlmPhone("+7 (495) 123-45-67"), "city");
    assert.equal(classifyLlmPhone("+7 (812) 555-01-02"), "city");
    assert.equal(classifyLlmPhone("8 (499) 100-00-00"), "city");
});

test("classifyLlmPhone: KZ mobile +7 7XX → mobile", () => {
    assert.equal(classifyLlmPhone("+7 (701) 123-45-67"), "mobile");
    assert.equal(classifyLlmPhone("+7 (747) 999-88-77"), "mobile");
    assert.equal(classifyLlmPhone("+77776543210"), "mobile");
});

test("classifyLlmPhone: Chinese +86 → mobile", () => {
    assert.equal(classifyLlmPhone("+86 138 1234 5678"), "mobile");
    assert.equal(classifyLlmPhone("+8613812345678"), "mobile");
});

test("classifyLlmPhone: Belarus +375, Azerbaijan +994 → mobile", () => {
    assert.equal(classifyLlmPhone("+375 29 123-45-67"), "mobile");
    assert.equal(classifyLlmPhone("+994 50 123 45 67"), "mobile");
    assert.equal(classifyLlmPhone("+380 67 123 45 67"), "mobile");
});

test("classifyLlmPhone: empty / garbage → city (conservative)", () => {
    assert.equal(classifyLlmPhone(""), "city");
    assert.equal(classifyLlmPhone(null), "city");
    assert.equal(classifyLlmPhone("abc"), "city");
});

// ---------------------------------------------------------------------------
// mergeLlmExtraction — downgrade guard
// ---------------------------------------------------------------------------

function mkResult(overrides = {}) {
    return {
        lead: { articles: [], lineItems: [] },
        detectedBrands: [],
        sender: { sources: {} },
        classification: { label: "Клиент", confidence: 0.7, scores: {}, matchedRules: [] },
        rawInput: {},
        ...overrides
    };
}

test("merge downgrade: LLM other + no articles + low conf → downgrade to Не определено", () => {
    const result = mkResult({ classification: { label: "Клиент", confidence: 0.6 } });
    mergeLlmExtraction(result, { request_type: "other" }, "msg-1");
    assert.equal(result.classification.label, "Не определено");
    assert.equal(result.classification.llmDowngraded, true);
    assert.equal(result.classification.needsReview, true);
});

test("merge downgrade guard: LLM other but rules conf ≥0.85 → keep Клиент", () => {
    const result = mkResult({ classification: { label: "Клиент", confidence: 0.92 } });
    mergeLlmExtraction(result, { request_type: "other" }, "msg-2");
    assert.equal(result.classification.label, "Клиент");
    assert.ok(result.classification.llmDisagreed, "should flag disagreement");
    assert.ok(!result.classification.llmDowngraded, "should not downgrade");
});

test("merge downgrade guard: LLM other but articles present → keep Клиент", () => {
    const result = mkResult({
        lead: { articles: ["ACS580-01-09A5-4"], lineItems: [{ article: "ACS580-01-09A5-4" }] },
        classification: { label: "Клиент", confidence: 0.6 }
    });
    mergeLlmExtraction(result, { request_type: "other" }, "msg-3");
    assert.equal(result.classification.label, "Клиент");
    assert.ok(result.classification.llmDisagreed);
    assert.ok(!result.classification.llmDowngraded);
});

test("merge downgrade guard: LLM other but brands detected → keep Клиент", () => {
    const result = mkResult({
        detectedBrands: ["ABB", "Siemens"],
        classification: { label: "Клиент", confidence: 0.6 }
    });
    mergeLlmExtraction(result, { request_type: "other" }, "msg-4");
    assert.equal(result.classification.label, "Клиент");
    assert.ok(result.classification.llmDisagreed);
});

test("merge upgrade: LLM info_request on Не определено → upgrade to Клиент", () => {
    const result = mkResult({ classification: { label: "Не определено", confidence: 0.5 } });
    mergeLlmExtraction(result, { request_type: "info_request" }, "msg-5");
    assert.equal(result.classification.label, "Клиент");
    assert.ok(result.classification.llmReclassified);
});

// ---------------------------------------------------------------------------
// mergeLlmExtraction — phone bucket routing
// ---------------------------------------------------------------------------

test("merge phone: LLM Chinese +86 → mobile bucket", () => {
    const result = mkResult();
    mergeLlmExtraction(result, { sender_phone: "+86 138 1234 5678" }, "msg-p1");
    assert.equal(result.sender.mobilePhone, "+86 138 1234 5678");
    assert.equal(result.sender.cityPhone, undefined);
});

test("merge phone: LLM RU city → city bucket", () => {
    const result = mkResult();
    mergeLlmExtraction(result, { sender_phone: "+7 (495) 123-45-67" }, "msg-p2");
    assert.equal(result.sender.cityPhone, "+7 (495) 123-45-67");
    assert.equal(result.sender.mobilePhone, undefined);
});

test("merge phone: LLM RU 9XX → mobile bucket", () => {
    const result = mkResult();
    mergeLlmExtraction(result, { sender_phone: "+7 921 784-93-64" }, "msg-p3");
    assert.equal(result.sender.mobilePhone, "+7 921 784-93-64");
});

test("merge phone: existing phone → LLM skipped", () => {
    const result = mkResult({ sender: { sources: {}, mobilePhone: "+7 999 111-22-33" } });
    mergeLlmExtraction(result, { sender_phone: "+7 495 111-22-33" }, "msg-p4");
    assert.equal(result.sender.mobilePhone, "+7 999 111-22-33");
    assert.equal(result.sender.cityPhone, undefined);
});
