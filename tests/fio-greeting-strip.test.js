// Regression: Russian greetings ("Добрый день", "Здравствуйте", …) must not be
// returned as a person name when they leak into the signature block. The greeting
// prefix strip in fio-extractor only knew "С уважением"/English; this pins the
// Russian greeting set and the stacked-prefix case ("Добрый день, с уважением X").

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractPersonName } from "../src/services/fio-extractor.js";

const name = (sig) => {
    const r = extractPersonName({ signature: sig });
    return r ? r.primary : null;
};

test("greeting-only signature lines are not names", () => {
    assert.equal(name("Добрый день!"), null);
    assert.equal(name("Доброе утро"), null);
    assert.equal(name("Добрый вечер"), null);
    assert.equal(name("Доброго времени суток"), null);
    assert.equal(name("Здравствуйте"), null);
    assert.equal(name("Приветствую"), null);
});

test("greeting prefix is stripped, real name recovered", () => {
    assert.equal(name("Добрый вечер, Сидоров Пётр"), "Сидоров Пётр");
    // stacked greeting + sign-off prefix before the name
    assert.equal(name("Добрый день, с уважением Иван Петров"), "Иван Петров");
});

test("existing sign-off greeting still works (no regression)", () => {
    assert.equal(name("С уважением, Иван Петров"), "Иван Петров");
});
