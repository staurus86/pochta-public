import { test } from "node:test";
import assert from "node:assert/strict";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";

// Post-deploy audit #2 (2026-06-01): 43 messages have OCR-garbled Russian words extracted as
// articles — Cyrillic descriptions typed with Latin look-alikes ("ПPYЖIHA"=ПРУЖИНА, "ДATЧIK"=
// ДАТЧИК). The existing mixed-script filter has an exception for a single mis-typed Cyrillic
// letter (legit "мLT220", "ПP200"), but it was too broad ("^[Cyr][Lat]") and kept any token
// starting Cyr+Lat. Tighten: except only when there is EXACTLY ONE Cyrillic letter total.

test("article-mixed: битые слова (2+ кириллицы) отбрасываются", () => {
    assert.equal(isObviousArticleNoise("ПPYЖIHA ПЛYHЖEPA 100048-001"), true);
    assert.equal(isObviousArticleNoise("ДATЧIK BIБPAЦII AC102-1A"), true);
    assert.equal(isObviousArticleNoise("ГAЗOAHAЛIЗATOP IГM-12M"), true);
    assert.equal(isObviousArticleNoise("ДOKYMEHT COCTABЛEH HA 1 ЛICTE"), true);
});

test("article-mixed: реальный код с одной опечаткой (1 кириллица) сохраняется", () => {
    assert.equal(isObviousArticleNoise("ПP200-24.4.2.0"), false);   // ОВЕН ПР200, Р→P
    assert.equal(isObviousArticleNoise("ДTC035-PT1000.B2.120.G1/2"), false);
    assert.equal(isObviousArticleNoise("мLT220"), false);            // legit single Cyr prefix
});
