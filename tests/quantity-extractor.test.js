// Phase 4 — Quantity extraction TDD suite.
// Covers: filters (dimensions/power/voltage/phone), normalizer (2шт/82ШТ/locale),
// extractor facade (zone-aware, article-boundary, pack parsing, primary picking).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    isDimensionLike,
    isWeightLike,
    isPowerLike,
    isVoltageLike,
    isPressureLike,
    isFrequencyLike,
    isRpmLike,
    isTemperatureLike,
    isPhoneLike,
    isDateLike,
    isHoursLike,
    isTechnicalSpec,
} from "../src/services/quantity-filters.js";

import {
    normalizeQtyUnit,
    parseQuantityForm,
    parseLocaleNumeric,
    parsePackStructure,
    parseInKolve,
} from "../src/services/quantity-normalizer.js";

import { extractQuantities } from "../src/services/quantity-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

test("isDimensionLike: mm / см / м / dn / Ду", () => {
    assert.ok(isDimensionLike("90 мм"));
    assert.ok(isDimensionLike("90мм"));
    assert.ok(isDimensionLike("1.5 mm"));
    assert.ok(isDimensionLike("DN 65"));
    assert.ok(isDimensionLike("Ду40"));
    assert.ok(isDimensionLike("12 см"));
    assert.ok(!isDimensionLike("2 шт"));
    assert.ok(!isDimensionLike("5 комплектов"));
});

test("isWeightLike: кг / г / тонн", () => {
    assert.ok(isWeightLike("5 кг"));
    assert.ok(isWeightLike("2.5кг"));
    assert.ok(isWeightLike("500 г"));
    assert.ok(!isWeightLike("5 шт"));
});

test("isPowerLike: kW / Вт / лс", () => {
    assert.ok(isPowerLike("2.20 kW"));
    assert.ok(isPowerLike("380 W"));
    assert.ok(isPowerLike("15Вт"));
    assert.ok(isPowerLike("100 л.с."));
    assert.ok(!isPowerLike("2 шт"));
});

test("isVoltageLike: V / В / kV", () => {
    assert.ok(isVoltageLike("240V"));
    assert.ok(isVoltageLike("1200V"));
    assert.ok(isVoltageLike("220 В"));
    assert.ok(isVoltageLike("10 kV"));
    assert.ok(!isVoltageLike("5 шт"));
});

test("isPressureLike: bar / MPa / atm / Па", () => {
    assert.ok(isPressureLike("250 bar"));
    assert.ok(isPressureLike("16 МПа"));
    assert.ok(isPressureLike("2.5 атм"));
    assert.ok(isPressureLike("16bar"));
});

test("isFrequencyLike: Hz / Гц / min-1", () => {
    assert.ok(isFrequencyLike("50Hz"));
    assert.ok(isFrequencyLike("60 HZ"));
    assert.ok(isFrequencyLike("50/60HZ"));
    assert.ok(isFrequencyLike("50 Гц"));
});

test("isRpmLike: rpm / об/мин / min-1", () => {
    assert.ok(isRpmLike("1500 min-1"));
    assert.ok(isRpmLike("3000 об/мин"));
    assert.ok(isRpmLike("1450 rpm"));
});

test("isTemperatureLike: °C / C / °F", () => {
    assert.ok(isTemperatureLike("60 °C"));
    assert.ok(isTemperatureLike("-20°C"));
    assert.ok(isTemperatureLike("100C"));
});

test("isPhoneLike: phone sequences", () => {
    assert.ok(isPhoneLike("+375 33 343-99-61"));
    assert.ok(isPhoneLike("+7 (495) 123-45-67"));
    assert.ok(isPhoneLike("8 800 200 00 00"));
    assert.ok(!isPhoneLike("2 шт"));
});

test("isDateLike: 21.04.2026 / 2026-04-20", () => {
    assert.ok(isDateLike("21.04.2026"));
    assert.ok(isDateLike("2026-04-20"));
    assert.ok(isDateLike("20/04/2026"));
});

test("isHoursLike: 9.00-18.00", () => {
    assert.ok(isHoursLike("9.00-18.00"));
    assert.ok(isHoursLike("9:00 - 18:00"));
});

test("isTechnicalSpec: composite", () => {
    assert.ok(isTechnicalSpec("90 мм"));
    assert.ok(isTechnicalSpec("2.20 kW"));
    assert.ok(isTechnicalSpec("240V"));
    assert.ok(isTechnicalSpec("50Hz"));
    assert.ok(isTechnicalSpec("1500 min-1"));
    assert.ok(!isTechnicalSpec("2 шт"));
    assert.ok(!isTechnicalSpec("5 компл."));
});

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer
// ─────────────────────────────────────────────────────────────────────────────

test("normalizeQtyUnit: форма → канон", () => {
    assert.equal(normalizeQtyUnit("шт"), "шт");
    assert.equal(normalizeQtyUnit("ШТ"), "шт");
    assert.equal(normalizeQtyUnit("штук"), "шт");
    assert.equal(normalizeQtyUnit("штуки"), "шт");
    assert.equal(normalizeQtyUnit("штука"), "шт");
    assert.equal(normalizeQtyUnit("pcs"), "шт");
    assert.equal(normalizeQtyUnit("pc"), "шт");
    assert.equal(normalizeQtyUnit("ea"), "шт");
    assert.equal(normalizeQtyUnit("комплект"), "компл");
    assert.equal(normalizeQtyUnit("комплектов"), "компл");
    assert.equal(normalizeQtyUnit("к-т"), "компл");
    assert.equal(normalizeQtyUnit("пара"), "пар");
    assert.equal(normalizeQtyUnit("пары"), "пар");
    assert.equal(normalizeQtyUnit("упак"), "уп");
    assert.equal(normalizeQtyUnit("упаковки"), "уп");
});

test("parseQuantityForm: '2 шт' / '2шт' / '82ШТ'", () => {
    assert.deepEqual(parseQuantityForm("2 шт"), { value: 2, unit: "шт" });
    assert.deepEqual(parseQuantityForm("2шт"), { value: 2, unit: "шт" });
    assert.deepEqual(parseQuantityForm("82ШТ"), { value: 82, unit: "шт" });
    assert.deepEqual(parseQuantityForm("5 pcs"), { value: 5, unit: "шт" });
    assert.deepEqual(parseQuantityForm("2 компл."), { value: 2, unit: "компл" });
    assert.deepEqual(parseQuantityForm("10 штук"), { value: 10, unit: "шт" });
});

test("parseQuantityForm: fractional '2.5 л' / '0,5 м'", () => {
    assert.deepEqual(parseQuantityForm("2.5 л"), { value: 2.5, unit: "л" });
    assert.deepEqual(parseQuantityForm("0,5 м"), { value: 0.5, unit: "м" });
});

test("parseQuantityForm: returns null for non-quantity", () => {
    assert.equal(parseQuantityForm("240V"), null);
    assert.equal(parseQuantityForm("90 мм"), null);
    assert.equal(parseQuantityForm("abc"), null);
    assert.equal(parseQuantityForm(""), null);
});

test("parseLocaleNumeric: '1,000 шт' → 1000 (en-locale thousand sep)", () => {
    // "1,000" with " шт" — trailing units imply count, comma = thousand separator
    assert.deepEqual(parseLocaleNumeric("1,000 шт"), { value: 1000, unit: "шт", ambiguous: true });
    assert.deepEqual(parseLocaleNumeric("2,5 шт"), { value: 2.5, unit: "шт", ambiguous: false });
    assert.deepEqual(parseLocaleNumeric("10 000 шт"), { value: 10000, unit: "шт", ambiguous: false });
});

test("parsePackStructure: '3 комплекта по 4 шт' → pack+item", () => {
    const r = parsePackStructure("3 комплекта по 4 шт");
    assert.equal(r.packCount, 3);
    assert.equal(r.packUnit, "компл");
    assert.equal(r.itemCount, 4);
    assert.equal(r.itemUnit, "шт");
    assert.equal(r.totalCount, 12);
});

test("parsePackStructure: null on no pack", () => {
    assert.equal(parsePackStructure("5 шт"), null);
    assert.equal(parsePackStructure("просто текст"), null);
});

test("parseInKolve: 'в кол-ве 5 шт' / 'количество: 10'", () => {
    assert.deepEqual(parseInKolve("в кол-ве 5 шт"), { value: 5, unit: "шт" });
    assert.deepEqual(parseInKolve("Количество: 10"), { value: 10, unit: "шт" });
    assert.deepEqual(parseInKolve("Кол-во 3 компл."), { value: 3, unit: "компл" });
    assert.deepEqual(parseInKolve("qty 7"), { value: 7, unit: "шт" });
    assert.equal(parseInKolve("просто текст"), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Extractor facade
// ─────────────────────────────────────────────────────────────────────────────

test("extractQuantities: simple 'Клапан - 2 шт'", () => {
    const result = extractQuantities("Клапан - 2 шт");
    assert.equal(result.primary?.value, 2);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: glued '2шт' no space", () => {
    const result = extractQuantities("Муфта соединительная 2шт");
    assert.equal(result.primary?.value, 2);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: uppercase '82ШТ'", () => {
    const result = extractQuantities("Заказ 82ШТ датчиков давления");
    assert.equal(result.primary?.value, 82);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: 'в кол-ве 5 шт' prefix form", () => {
    const result = extractQuantities("Нужны реле в кол-ве 5 шт.");
    assert.equal(result.primary?.value, 5);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: pack '3 комплекта по 4 шт' → total 12", () => {
    const result = extractQuantities("Поставить 3 комплекта по 4 шт");
    assert.equal(result.primary?.value, 3);
    assert.equal(result.primary?.unit, "компл");
    assert.equal(result.primary?.itemCount, 4);
    assert.equal(result.primary?.itemUnit, "шт");
    assert.equal(result.primary?.totalCount, 12);
});

test("extractQuantities: filters dimensions (90 мм)", () => {
    const result = extractQuantities("Клапан шаровой 90 мм");
    assert.equal(result.primary, null);
});

test("extractQuantities: filters power/voltage/pressure/freq", () => {
    assert.equal(extractQuantities("Двигатель 2.20 kW 240V 50Hz").primary, null);
    assert.equal(extractQuantities("Насос 1500 min-1 250 bar").primary, null);
    assert.equal(extractQuantities("Температура 60 °C").primary, null);
});

test("extractQuantities: filters phone/date/hours", () => {
    assert.equal(extractQuantities("Тел: +375 33 343-99-61").primary, null);
    assert.equal(extractQuantities("Дата 21.04.2026").primary, null);
    assert.equal(extractQuantities("Часы работы 9.00-18.00").primary, null);
});

test("extractQuantities: article-boundary '9226513-4 шт' → qty=4, не 13", () => {
    const result = extractQuantities("Артикул 9226513 - 4 шт", { articles: ["9226513"] });
    assert.equal(result.primary?.value, 4);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: article-glued '11TC080-1шт' → qty=1", () => {
    const result = extractQuantities("Муфта 11TC080-1шт", { articles: ["11TC080"] });
    assert.equal(result.primary?.value, 1);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: multi-line multiple quantities", () => {
    const text = "1. Датчик давления - 3 шт\n2. Клапан - 5 шт\n3. Муфта - 10 шт";
    const result = extractQuantities(text);
    assert.equal(result.items.length, 3);
    assert.deepEqual(result.items.map((i) => i.value).sort((a, b) => a - b), [3, 5, 10]);
    // primary = either sum (18) or first-found (3), pick first
    assert.ok(result.primary?.value > 0);
});

test("extractQuantities: locale-aware '1,000 шт' = 1000 (ambiguous flag)", () => {
    const result = extractQuantities("Партия 1,000 шт");
    assert.equal(result.primary?.value, 1000);
    assert.equal(result.primary?.unit, "шт");
    assert.equal(result.primary?.ambiguous, true);
});

test("extractQuantities: rejects standalone large numbers (likely INN/article)", () => {
    const result = extractQuantities("Контрагент ИНН 7722334455");
    assert.equal(result.primary, null);
});

test("extractQuantities: explicit '1 шт' count not filtered even near spec", () => {
    const result = extractQuantities("Датчик DN 65 - 1 шт");
    assert.equal(result.primary?.value, 1);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: empty/blank → null primary, empty items", () => {
    const r1 = extractQuantities("");
    assert.equal(r1.primary, null);
    assert.deepEqual(r1.items, []);
    const r2 = extractQuantities("   ");
    assert.equal(r2.primary, null);
});

test("extractQuantities: needsReview flag when ambiguous locale present", () => {
    const result = extractQuantities("Партия 1,000 шт");
    assert.equal(result.needsReview, true);
});

test("extractQuantities: dedup identical quantities on different lines", () => {
    const text = "Клапан - 5 шт\nКлапан - 5 шт";
    const result = extractQuantities(text);
    assert.equal(result.items.length, 2); // keep per-line, orchestrator can collapse
    assert.equal(result.primary?.value, 5);
});

test("extractQuantities: object input { quantity, unit } passthrough", () => {
    const result = extractQuantities([{ quantity: 4, unit: "шт" }]);
    assert.equal(result.primary?.value, 4);
    assert.equal(result.primary?.unit, "шт");
});

test("extractQuantities: rejected items captured with reason", () => {
    const result = extractQuantities("Датчик 90 мм и ещё 2 шт");
    assert.ok(Array.isArray(result.rejected));
    // 90 мм should be rejected with reason dimension/technical
    assert.ok(result.rejected.some((r) => /dimension|technical/i.test(r.reason || "")));
    // 2 шт accepted
    assert.equal(result.primary?.value, 2);
});
