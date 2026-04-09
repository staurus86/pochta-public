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

const baseProject = {
  mailbox: "info@siderus.ru",
  brands: [],
  managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
  knownCompanies: []
};

function analyze(subject, body) {
  return analyzeEmail(baseProject, { fromEmail: "test@test.ru", fromName: "", subject, body, attachments: [] });
}

// ── Trigger A: количество + единица измерения ──

test("triggerA: 'описание — N шт' создаёт позицию", () => {
  const result = analyze("Запрос", "Добрый день!\nШаровой кран DN50 PN16 — 2 шт\nС уважением");
  const items = result.lead.lineItems || [];
  const ft = items.filter((i) => i.article?.startsWith("DESC:"));
  assert.ok(ft.length >= 1, `Ожидалась freetext-позиция, получено: ${JSON.stringify(items.map(i=>i.article))}`);
  assert.equal(ft[0].quantity, 2);
  assert.ok(ft[0].descriptionRu?.toLowerCase().includes("шар"));
});

test("triggerA: 'описание N штук' без дефиса", () => {
  const result = analyze("Запрос", "редуктор давления 1 компл");
  const items = result.lead.lineItems || [];
  const ft = items.filter((i) => i.article?.startsWith("DESC:"));
  assert.ok(ft.length >= 1);
  assert.equal(ft[0].quantity, 1);
  assert.equal(ft[0].unit, "компл");
});

test("triggerA: строка без единиц измерения НЕ создаёт DESC-позицию", () => {
  const result = analyze("Запрос", "просто текст про оборудование");
  const items = result.lead.lineItems || [];
  const ft = items.filter((i) => i.article?.startsWith("DESC:"));
  assert.equal(ft.length, 0);
});

test("triggerA: ИНН в строке → не позиция", () => {
  const result = analyze("Запрос", "ИНН 7801234567 КПП 780101001");
  const items = result.lead.lineItems || [];
  const ft = items.filter((i) => i.article?.startsWith("DESC:"));
  assert.equal(ft.length, 0);
});
