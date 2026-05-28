// Phase 17 regression — GHOST brand pattern fixes (zone filter, slash-split, dedup, blocklist)

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { splitAliasBundle, dedupCanonical } from "../src/services/brand-normalizer.js";

const minProject = {
    mailbox: "inbox@test.com",
    brands: [],
    managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
    knownCompanies: [],
};

// =====================================================================
// GHOST-1 — Zone filter: quoted-reply brand bleed
// Currently fires only when brands.length > 5; should fire for ≥ 1 brand.
// Fix: lower threshold from > 5 to > 0 with attachment-grounding guard.
// =====================================================================

test("GHOST-1: brand only in quoted Siderus reply is dropped from short client reply", () => {
    // Only "ALLWEILER" is mentioned — but ONLY inside the quoted block, not in the client's own text or subject.
    // After the fix the zone filter should drop it.
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Re: Насосы",
        body: `Берем.

От: sales@siderus.ru
Кому: client@buyer.ru
Тема: Насосы импорт/аналоги
Предлагаем насосы ALLWEILER и аналоги.`,
        attachments: "",
    });
    const brands = (r.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(
        !brands.includes("allweiler"),
        `GHOST-1: "ALLWEILER" должен быть удалён как бренд из истории цитаты; found: ${JSON.stringify(r.lead?.detectedBrands)}`
    );
});

test("GHOST-1 guard: brand in client's OWN reply text is KEPT", () => {
    // Client explicitly names the brand in their own new message (before the quote). Must NOT be dropped.
    // Body is long enough (≥50 chars) to be the primary zone; "Siemens" appears in client's own text.
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Re: Насосы Siemens",
        body: `Да, нас устраивает Siemens. Прошу выслать коммерческое предложение на насосы Siemens с ценами и сроками.

От: sales@siderus.ru <sales@siderus.ru>
Кому: client@buyer.ru
Тема: Насосы Siemens
Добрый день, предлагаем насосы Siemens.`,
        attachments: "",
    });
    const brands = (r.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(
        brands.some((b) => b.includes("siemens")),
        `GHOST-1 guard: "Siemens" должен остаться в брендах (клиент написал его сам); found: ${JSON.stringify(r.lead?.detectedBrands)}`
    );
});

// =====================================================================
// GHOST-2 — Slash-canonical: generic second part emits ghost brand
// e.g. "WEST Control Solutions / Instruments" → ghost "Instruments"
// Fix: if any split part is in GENERIC_SPLIT_PARTS, keep only the first part.
// =====================================================================

test("GHOST-2: slash-canonical with generic second part keeps only primary", () => {
    const result = splitAliasBundle("WEST Control Solutions / Instruments");
    assert.deepEqual(
        result,
        ["WEST Control Solutions"],
        `GHOST-2: должно вернуть только первую часть, got: ${JSON.stringify(result)}`
    );
});

test("GHOST-2 guard: legitimate distinct pair still splits", () => {
    const result = splitAliasBundle("ASCO Joucomatic / Numatics");
    assert.deepEqual(
        result,
        ["ASCO Joucomatic", "Numatics"],
        `GHOST-2 guard: обе части должны остаться, got: ${JSON.stringify(result)}`
    );
});

test("GHOST-2 guard: simple alias bundle still splits", () => {
    const result = splitAliasBundle("Buerkert / Burkert");
    assert.deepEqual(
        result,
        ["Buerkert", "Burkert"],
        `GHOST-2 guard: оба варианта написания должны остаться, got: ${JSON.stringify(result)}`
    );
});

// =====================================================================
// GHOST-3 — Multi-canonical duplicates: punctuation variants not collapsed
// e.g. "Endress+Hauser" / "Endress & Hauser" / "ENDRESS+HAUSER" → 3 brands
// Fix: add concat-normalized second pass in dedupCanonical (strip + & - . and whitespace).
// =====================================================================

test("GHOST-3: Endress variants collapse to one", () => {
    const out = dedupCanonical(["Endress+Hauser", "Endress & Hauser", "ENDRESS+HAUSER"]);
    assert.equal(
        out.length,
        1,
        `GHOST-3: три варианта Endress+Hauser должны схлопнуться в один; got: ${JSON.stringify(out)}`
    );
});

test("GHOST-3 guard: Bosch and Bosch Rexroth stay distinct", () => {
    const out = dedupCanonical(["Bosch", "Bosch Rexroth"]);
    assert.equal(
        out.length,
        2,
        `GHOST-3 guard: Bosch и Bosch Rexroth должны оставаться отдельными брендами; got: ${JSON.stringify(out)}`
    );
});

// =====================================================================
// GHOST-4 — Generic single-token aliases from 15K-brand KB import
// e.g. "instruments", "smart", "west", "drive", "neo", "mission" match common words
// Fix: extend BRAND_FALSE_POSITIVE_ALIASES in detection-kb.js
// =====================================================================

test("GHOST-4: generic word 'Instruments' does not register as brand", () => {
    // Body mentioning "MTL Instruments" as product description with request signal
    const r = analyzeEmail(minProject, {
        fromEmail: "client@buyer.ru",
        subject: "Запрос оборудования",
        body: "Прошу выслать коммерческое предложение на измерительные приборы MTL Instruments для нашего проекта.",
        attachments: "",
    });
    const brands = (r.lead?.detectedBrands || []).map((b) => b.toLowerCase());
    assert.ok(
        !brands.includes("instruments"),
        `GHOST-4: "Instruments" не должен быть отдельным брендом; found: ${JSON.stringify(r.lead?.detectedBrands)}`
    );
});
