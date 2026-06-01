import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPersonName } from "../src/services/fio-extractor.js";

// Post-deploy audit (2026-06-01): 15 fullNames wrapped in Outlook bold/italic plaintext
// markers (*Имя Фамилия*, `…`). The markers hide the token from company/greeting/role filters
// (which need a word boundary), so bold-wrapped noise slipped through as a name AND real names
// were shown with asterisks. Strip markers, recover a clean person name, reject the rest.

test("fio-markdown: реальное имя в звёздочках восстанавливается", () => {
    assert.equal(extractPersonName({ signature: "*Нестеркин Сергей Михайлович*" }).primary, "Нестеркин Сергей Михайлович");
    assert.equal(extractPersonName({ signature: "*Татьяна Заруба*" }).primary, "Татьяна Заруба");
    assert.equal(extractPersonName({ signature: "*Югов Андрей*" }).primary, "Югов Андрей");
});

test("fio-markdown: bold-обёрнутый мусор отбрасывается", () => {
    // company in bold
    assert.equal(extractPersonName({ signature: "*ооо «Авангард»*", emailLocal: "x" }).primary, null);
    // greeting in bold
    assert.equal(extractPersonName({ signature: "*с Уважением,*", emailLocal: "x" }).primary, null);
    // label + token in bold
    assert.equal(extractPersonName({ signature: "Компания: *STSProm*", emailLocal: "x" }).primary, null);
});

test("fio-markdown: обычные имена без markdown не затронуты", () => {
    assert.equal(extractPersonName({ signature: "С уважением, Петр Петров" }).primary, "Петр Петров");
});
