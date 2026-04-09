import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeEmail } from "../src/services/email-analyzer.js";

// Транслитерация тестируется inline (функция приватная в email-analyzer.js)
// Интеграционные тесты (Task 3+) используют analyzeEmail

const TRANSLIT_MAP = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",
    к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
    х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"
};

function transliterateToSlug(text) {
    return "DESC:" + text
        .toLowerCase()
        .split("")
        .map((c) => TRANSLIT_MAP[c] ?? (/[a-z0-9]/i.test(c) ? c : "-"))
        .join("")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
}

test("transliterateToSlug: кириллица → латиница", () => {
    const result = transliterateToSlug("шаровой кран");
    assert.equal(result, "DESC:sharovoy-kran");
});

test("transliterateToSlug: кириллица + латиница + цифры", () => {
    const result = transliterateToSlug("редуктор DN50 PN16");
    assert.equal(result, "DESC:reduktor-dn50-pn16");
});

test("transliterateToSlug: обрезка до 40 символов", () => {
    const result = transliterateToSlug("очень длинное название оборудования промышленного");
    assert.ok(result.length <= 45); // "DESC:" (5) + 40
});

test("transliterateToSlug: спецсимволы → дефис", () => {
    const result = transliterateToSlug("кран (шаровой) DN50");
    assert.ok(!result.includes("(") && !result.includes(")"));
    assert.ok(result.includes("kran"));
});

test("transliterateToSlug: двойные дефисы схлопываются", () => {
    const result = transliterateToSlug("кран  DN50");
    assert.ok(!result.includes("--"));
});
