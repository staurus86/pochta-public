// Phase 3 — product name extraction TDD tests.
// Covers 7 defect categories from business audit (2026-04-20):
//   1. Overcapture (>200/500/1000 chars)
//   2. Multi-item collapse (; \n multiple items)
//   3. Contact/signature contamination (phones, names, hours)
//   4. Document/accounting contamination (акт/паспорт/реквизиты)
//   5. HTML/PDF/doc parsing noise
//   6. Code-only fallback
//   7. Under-extraction (subject fallback)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isPhoneLike,
    isContactLike,
    isDocumentLike,
    isPdfOpsLike,
    isHtmlResidueLike,
    isCodeOnly,
    isOverlong,
    isMultiItemList,
    isBadProductName,
} from "../src/services/product-name-filters.js";

import {
    stripHtmlResidue,
    stripPdfOps,
    stripContactTail,
    stripQuantityTail,
    collapseWhitespace,
    capLength,
    splitMultiItem,
    normalizeProductName,
} from "../src/services/product-name-normalizer.js";

import { sanitizeProductNames } from "../src/services/product-name-extractor.js";

// ─────────────────────────────────────────────
// filters
// ─────────────────────────────────────────────

test("isPhoneLike rejects +375 33 343-99-61", () => {
    assert.equal(isPhoneLike("+375 33 343-99-61"), true);
    assert.equal(isPhoneLike("+375(29) 344-98-72"), true);
    assert.equal(isPhoneLike("Tel: +375 29 123-45-67"), true);
    assert.equal(isPhoneLike("Mob : (+99451) 123 45 67"), true);
});

test("isPhoneLike keeps real product names with digits", () => {
    assert.equal(isPhoneLike("Датчик VEGABAR 28"), false);
    assert.equal(isPhoneLike("Клапан DN50 PN16"), false);
    assert.equal(isPhoneLike("VK/A-02/20"), false);
});

test("isContactLike rejects hours/contact noise", () => {
    assert.equal(isContactLike("9.00-18.00"), true);
    assert.equal(isContactLike("9:00-18:00"), true);
    assert.equal(isContactLike("Дордаль Артем Инженер-механик"), true);
    assert.equal(isContactLike("С уважением, Иванов И.И."), true);
});

test("isContactLike keeps product names", () => {
    assert.equal(isContactLike("Реле контроля 3-фазной сети"), false);
    assert.equal(isContactLike("Мембранный клапан SED"), false);
});

test("isDocumentLike rejects accounting/legal noise", () => {
    assert.equal(isDocumentLike("если контрагент физическое лицо: паспорт физического лица"), true);
    assert.equal(isDocumentLike("03. Поступление на расчетный счет"), true);
    assert.equal(isDocumentLike("Акт сверки взаиморасчетов"), true);
    assert.equal(isDocumentLike("Карточка предприятия"), true);
    assert.equal(isDocumentLike("Реквизиты организации"), true);
});

test("isDocumentLike keeps products", () => {
    assert.equal(isDocumentLike("Клапан электромагнитный"), false);
    assert.equal(isDocumentLike("Датчик давления"), false);
});

test("isPdfOpsLike rejects PDF operator residue", () => {
    assert.equal(isPdfOpsLike("/Document Add /FillIn /Delete /SubmitStandalone"), true);
    assert.equal(isPdfOpsLike("CANON_PFINF_TYPE0_TEXTOFF"), true);
    assert.equal(isPdfOpsLike("/AcroForm /Type0 /FirstChar"), true);
});

test("isHtmlResidueLike rejects HTML entities and tags", () => {
    assert.equal(isHtmlResidueLike("&#1058;&#1080;&#1087;"), true);
    assert.equal(isHtmlResidueLike("<span style='color:red'>text</span>"), true);
    assert.equal(isHtmlResidueLike("<div><br></div>"), true);
    assert.equal(isHtmlResidueLike("WordSection1"), true);
    assert.equal(isHtmlResidueLike("page: WordSection1"), true);
});

test("isHtmlResidueLike keeps plain product names", () => {
    assert.equal(isHtmlResidueLike("Датчик давления VEGABAR 28"), false);
    assert.equal(isHtmlResidueLike("Клапан мембранный (SED)"), false);
});

test("isCodeOnly rejects bare codes without product noun", () => {
    assert.equal(isCodeOnly("4.5015-24"), true);
    assert.equal(isCodeOnly("EA4073"), true);
    assert.equal(isCodeOnly("8-10-375-17-225-10-95"), true);
    assert.equal(isCodeOnly("2405616-0010-0711-001"), true);
});

test("isCodeOnly keeps name+code combinations", () => {
    assert.equal(isCodeOnly("Датчик VEGABAR 28"), false);
    assert.equal(isCodeOnly("Клапан SED 316L"), false);
    assert.equal(isCodeOnly("RSM 51/8 реле"), false);
});

test("isOverlong flags strings > 200 chars", () => {
    assert.equal(isOverlong("short name"), false);
    assert.equal(isOverlong("x".repeat(199)), false);
    assert.equal(isOverlong("x".repeat(201)), true);
});

test("isMultiItemList detects multi-item strings", () => {
    // 3+ items separated by ; or newlines indicate multi-item
    assert.equal(isMultiItemList("Клапан A; Клапан B; Клапан C; Клапан D"), true);
    assert.equal(isMultiItemList("Датчик1\nДатчик2\nДатчик3\nДатчик4"), true);
    assert.equal(isMultiItemList("K0978 Вставки резьбовые; K0978 Вставки резьбовые; K0978 Вставки"), true);
    assert.equal(isMultiItemList("Один нормальный товар"), false);
    assert.equal(isMultiItemList("Товар А; Товар Б"), false); // 2 items is not yet multi
});

test("isBadProductName composite predicate", () => {
    assert.equal(isBadProductName("+375 33 343-99-61"), true);
    assert.equal(isBadProductName("9.00-18.00"), true);
    assert.equal(isBadProductName("Паспорт физического лица"), true);
    assert.equal(isBadProductName("/Document Add /FillIn"), true);
    assert.equal(isBadProductName("&#1058;&#1080;&#1087;"), true);
    assert.equal(isBadProductName("4.5015-24"), true);
    assert.equal(isBadProductName(""), true);
    assert.equal(isBadProductName("ab"), true); // too short
    assert.equal(isBadProductName("Датчик давления VEGABAR 28"), false);
});

// ─────────────────────────────────────────────
// normalizer
// ─────────────────────────────────────────────

test("stripHtmlResidue removes tags and entities", () => {
    assert.equal(stripHtmlResidue("<span>Датчик</span>"), "Датчик");
    assert.equal(stripHtmlResidue("Датчик &nbsp; VEGABAR"), "Датчик VEGABAR");
    assert.equal(stripHtmlResidue("Клапан&#32;SED"), "Клапан SED");
});

test("stripPdfOps removes PDF operator residue", () => {
    assert.equal(
        stripPdfOps("Датчик /FillIn /Delete /SubmitStandalone /Document"),
        "Датчик"
    );
    assert.equal(stripPdfOps("Клапан AcroForm Type0 FirstChar LastChar"), "Клапан");
});

test("stripContactTail removes trailing contact info", () => {
    assert.equal(
        stripContactTail("Датчик давления +375 33 343-99-61"),
        "Датчик давления"
    );
    assert.equal(
        stripContactTail("Клапан SED Tel: +7 495 123-45-67"),
        "Клапан SED"
    );
    assert.equal(
        stripContactTail("Реле с уважением Иванов"),
        "Реле"
    );
});

test("stripQuantityTail removes qty markers", () => {
    assert.equal(stripQuantityTail("Клапан SED - 5 шт"), "Клапан SED");
    assert.equal(stripQuantityTail("Датчик 10 штук"), "Датчик");
    assert.equal(stripQuantityTail("Реле 3 pcs"), "Реле");
    assert.equal(stripQuantityTail("Реле 3 ea"), "Реле");
    assert.equal(stripQuantityTail("Комплект 2 компл."), "Комплект");
});

test("collapseWhitespace normalizes spaces", () => {
    assert.equal(collapseWhitespace("Датчик   давления\n\n VEGABAR"), "Датчик давления VEGABAR");
    assert.equal(collapseWhitespace("  \tКлапан  \n SED "), "Клапан SED");
});

test("capLength truncates at sentence/word boundary", () => {
    const long = "Датчик давления VEGABAR 28 с выходным сигналом 4-20 мА, диапазон измерения от 0 до 10 бар, присоединение G1/2, материал мембраны - нержавеющая сталь 316L, температура процесса от -40 до +150°C";
    const capped = capLength(long, 100);
    assert.ok(capped.length <= 100, `length ${capped.length} > 100`);
    assert.ok(!capped.endsWith(" "), "trailing whitespace");
});

test("splitMultiItem splits ; separated items", () => {
    const input = "K0978 Вставки резьбовые; K0978 Вставки резьбовые; M6 Болты";
    const out = splitMultiItem(input);
    assert.ok(out.length >= 2, "should split into multiple items");
    assert.ok(out[0].includes("K0978"));
});

test("splitMultiItem splits newline-separated items", () => {
    const input = "Датчик давления\nКлапан SED\nРеле контроля";
    const out = splitMultiItem(input);
    assert.equal(out.length, 3);
});

test("splitMultiItem returns single item if no separators", () => {
    const out = splitMultiItem("Датчик давления VEGABAR 28");
    assert.equal(out.length, 1);
    assert.equal(out[0], "Датчик давления VEGABAR 28");
});

test("normalizeProductName chains all strippers + cap", () => {
    const raw = "<span>Датчик   давления</span>&nbsp;VEGABAR /FillIn Tel: +375 33 343";
    const out = normalizeProductName(raw, { maxLen: 120 });
    assert.ok(out.includes("VEGABAR"));
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes("&nbsp;"));
    assert.ok(!out.includes("FillIn"));
    assert.ok(!out.includes("+375"));
});

// ─────────────────────────────────────────────
// facade sanitizeProductNames
// ─────────────────────────────────────────────

test("sanitizeProductNames: rejects phone-only and doc-only", () => {
    const out = sanitizeProductNames([
        "+375 33 343-99-61",
        "Акт сверки",
        "Датчик давления VEGABAR 28",
    ]);
    assert.ok(out.names.includes("Датчик давления VEGABAR 28"));
    assert.ok(out.rejected.length >= 2);
    assert.ok(!out.names.some((n) => n.includes("+375")));
});

test("sanitizeProductNames: picks primary product name", () => {
    const out = sanitizeProductNames([
        "Датчик давления VEGABAR 28",
        "Клапан мембранный SED",
    ]);
    assert.ok(out.primary);
    assert.ok(out.names.length >= 1);
});

test("sanitizeProductNames: length cap applied", () => {
    const longText = "Датчик давления VEGABAR 28 " + "описание ".repeat(80);
    const out = sanitizeProductNames([longText]);
    if (out.primary) {
        assert.ok(out.primary.length <= 200, `primary length ${out.primary.length}`);
    }
});

test("sanitizeProductNames: multi-item splits into items[]", () => {
    const multi = "K0978 Вставки резьбовые; K0978 Вставки; M6 Болты; M8 Гайки";
    const out = sanitizeProductNames([multi]);
    assert.ok(out.items.length >= 2, `items=${out.items.length}`);
    // Primary should be short, not the whole list
    assert.ok(out.primary);
    assert.ok(out.primary.length < multi.length);
});

test("sanitizeProductNames: subject fallback when all raw rejected", () => {
    const out = sanitizeProductNames(
        ["+375 33 343-99-61", "/Document /FillIn"],
        { subject: "ДАТЧИК ДАВЛЕНИЯ VEGABAR 28" }
    );
    assert.ok(out.primary);
    assert.ok(out.primary.toLowerCase().includes("датчик") || out.primary.toLowerCase().includes("vegabar"));
});

test("sanitizeProductNames: dedup identical cleaned forms", () => {
    const out = sanitizeProductNames([
        "Датчик VEGABAR 28",
        "Датчик VEGABAR 28 ",
        "датчик vegabar 28",
    ]);
    // After normalization, should collapse to 1-2 forms
    assert.ok(out.names.length <= 2);
});

test("sanitizeProductNames: HTML/PDF residue cleaned", () => {
    const out = sanitizeProductNames([
        "<span style='color:red'>Клапан SED</span>",
        "Датчик /FillIn /Delete",
    ]);
    for (const n of out.names) {
        assert.ok(!n.includes("<"));
        assert.ok(!n.includes("/FillIn"));
    }
});

test("sanitizeProductNames: empty input returns empty", () => {
    const out = sanitizeProductNames([]);
    assert.equal(out.names.length, 0);
    assert.equal(out.primary, null);
    assert.equal(out.items.length, 0);
});

test("sanitizeProductNames: code-only candidates marked rejected", () => {
    const out = sanitizeProductNames(["4.5015-24", "EA4073", "Датчик VEGABAR"]);
    assert.equal(out.names.length, 1);
    assert.ok(out.names[0].includes("Датчик"));
    assert.ok(out.rejected.length >= 2);
});

test("sanitizeProductNames: handles objects with name field", () => {
    const out = sanitizeProductNames([
        { name: "Датчик давления VEGABAR 28", article: "VB28" },
        { name: "+375 33 343-99-61", article: "PHONE" },
        "Клапан SED",
    ]);
    assert.ok(out.names.length >= 2);
});

test("sanitizeProductNames: real-world noisy input", () => {
    const out = sanitizeProductNames([
        "<p>Клапан электромагнитный 220В;</p>",
        "/Document Add /FillIn /Delete",
        "Дордаль Артем Инженер-механик +375 (33) 367-70-23",
        "Акт сверки взаиморасчетов",
        "Датчик давления VEGABAR 28",
        "9.00-18.00",
    ]);
    // Should keep 2 legit products, reject the rest
    assert.ok(out.names.length >= 1);
    assert.ok(out.names.some((n) => n.toLowerCase().includes("клапан") || n.toLowerCase().includes("датчик")));
    assert.ok(out.rejected.length >= 3);
});
