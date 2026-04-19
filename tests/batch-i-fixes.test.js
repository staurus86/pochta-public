import { test } from "node:test";
import assert from "node:assert/strict";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";

test("article-noise: uuid: scheme prefix всегда отбрасывается", () => {
    assert.equal(isObviousArticleNoise("uuid:f1433557-0453-11dc-9364"), true);
    assert.equal(isObviousArticleNoise("uuid:ad6f13f2-4b0a-11db-a861"), true);
    assert.equal(isObviousArticleNoise("UUID:BD4B5D2E-FFFF"), true);
});

test("article-noise: Mozilla User-Agent отбрасывается", () => {
    assert.equal(isObviousArticleNoise("Mozilla/5.0"), true);
    assert.equal(isObviousArticleNoise("mozilla/4.0"), true);
});

test("article-noise: color tokens (RED0, BLUE255, GREEN128)", () => {
    assert.equal(isObviousArticleNoise("RED0"), true);
    assert.equal(isObviousArticleNoise("BLUE255"), true);
    assert.equal(isObviousArticleNoise("GREEN128"), true);
    assert.equal(isObviousArticleNoise("RGB128"), true);
    // Real article containing RED/BLUE as prefix with non-digit should pass
    assert.equal(isObviousArticleNoise("REDA-500"), false);
});

test("article-noise: font family с weight suffix", () => {
    assert.equal(isObviousArticleNoise("NotoSansSymbols2-Regular"), true);
    assert.equal(isObviousArticleNoise("CalibriLight-Bold"), true);
    assert.equal(isObviousArticleNoise("Arial-BoldMT"), true);
    assert.equal(isObviousArticleNoise("Times-Italic"), true);
});

test("article-noise: bare font family names (NotoSans, ArialMT)", () => {
    assert.equal(isObviousArticleNoise("NotoSans"), true);
    assert.equal(isObviousArticleNoise("ArialMT"), true);
    assert.equal(isObviousArticleNoise("TimesNewRoman"), true);
});

test("article-noise: CSS style tokens size/weight/family", () => {
    assert.equal(isObviousArticleNoise("size:612.0pt"), true);
    assert.equal(isObviousArticleNoise("weight:bold"), true);
    assert.equal(isObviousArticleNoise("family:sans"), true);
    assert.equal(isObviousArticleNoise("style:mso-something"), true);
});
