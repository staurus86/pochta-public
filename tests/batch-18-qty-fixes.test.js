// batch-18-qty-fixes.test.js
// Phase 18-01 TDD regression suite.
// RED count (before implementation): 9 tests should FAIL, 2 should PASS.
//
// QTY-1: multiline_table scanner — number and unit on separate lines (HTML table split)
// QTY-2: bold/italic Outlook marker strip — *10****шт.* → value=10

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractQuantities } from "../src/services/quantity-extractor.js";

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: multiline_table — number then unit, distance=1 (no blank line)
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: number then unit, distance=1 → multiline_table", () => {
    const result = extractQuantities("10\nшт", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 10);
    assert.equal(multiline[0].unit, "шт");
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: number then unit, distance=2 (one blank line between)
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: number then unit, distance=2 → multiline_table", () => {
    const result = extractQuantities("10\n\nшт", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: unit first, then number, distance=1
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: unit then number, distance=1 → multiline_table", () => {
    const result = extractQuantities("шт\n10", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 10);
    assert.equal(multiline[0].unit, "шт");
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: unit first, then number, distance=2 (blank line between)
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: unit then number, distance=2 → multiline_table", () => {
    const result = extractQuantities("шт\n\n10", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 10);
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: realistic HTML table block — description, blank, number, blank, unit
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: realistic table block ДАТЧИК\\n\\n10\\n\\nшт → multiline_table", () => {
    const result = extractQuantities("ДАТЧИК DSD 1820\n\n10\n\nшт", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 10);
    assert.equal(multiline[0].unit, "шт");
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1: "pcs" variant (should normalize to "шт")
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1: pcs variant 5\\npcs → multiline_table with unit=шт", () => {
    const result = extractQuantities("5\npcs", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.ok(
        multiline.length > 0,
        `Expected at least one item with source=multiline_table, got: ${JSON.stringify(result.items)}`
    );
    assert.equal(multiline[0].value, 5);
    assert.equal(multiline[0].unit, "шт");
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-1 FALSE-POSITIVE GUARD: distance=4 must NOT produce multiline_table
// (number and unit are more than 2 lines apart — pure coincidence, not a table)
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-1 guard: distance=4 should NOT produce multiline_table (false-positive guard)", () => {
    // 4 blank lines between number and unit exceeds the 2-line window
    const result = extractQuantities("100\n\n\n\nшт", { articles: [] });
    const multiline = result.items.filter((i) => i.source === "multiline_table");
    assert.equal(
        multiline.length,
        0,
        `Expected NO multiline_table items for distance=4, got: ${JSON.stringify(multiline)}`
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-2: bold/italic Outlook markdown strip
// *1**0****шт.* → strips all * → "10шт." → value=10, unit=шт
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-2: bold markers stripped before parsing → value=10, unit=шт", () => {
    const result = extractQuantities("*1**0****шт.*", { articles: [] });
    const found = result.items.filter((i) => i.value === 10);
    assert.ok(
        found.length > 0,
        `Expected item with value=10, got: ${JSON.stringify(result.items)}`
    );
    const hasShт = found.some((i) => i.unit === "шт");
    assert.ok(hasShт, `Expected item with unit=шт, got: ${JSON.stringify(found)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-2 REGRESSION GUARD: bold strip must NOT break the dimension filter
// "90 мм" has no asterisks — must still be rejected as technical spec
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-2 regression: 90 мм still returns primary=null after bold strip", () => {
    const result = extractQuantities("90 мм", { articles: [] });
    assert.equal(
        result.primary,
        null,
        `Expected primary=null for "90 мм", got: ${JSON.stringify(result.primary)}`
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// QTY-2 REGRESSION GUARD: covers existing test "extractQuantities: filters dimensions (90 мм)"
// (from quantity-extractor.test.js line 234) — ensures no regression when called via text form
// ─────────────────────────────────────────────────────────────────────────────

test("QTY-2 regression: Клапан шаровой 90 мм → primary=null (no regression)", () => {
    const result = extractQuantities("Клапан шаровой 90 мм");
    assert.equal(
        result.primary,
        null,
        `Expected primary=null, got: ${JSON.stringify(result.primary)}`
    );
});
