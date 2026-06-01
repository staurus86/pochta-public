import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPersonName } from "../src/services/fio-extractor.js";
import { isBadPersonName } from "../src/services/fio-filters.js";

// Manager ground-truth (b3ae7966): the From-header carries a clean name
// ("Куцевич Татьяна Ивановна") but the cascade picked a digit-garbage signature line
// ("Адрес: 194064, Санкт-Петербург"). A person name never contains a digit → the garbage
// candidate must be rejected so the cascade falls through to the From-header display name.

test("fio-filters: имя с цифрой считается плохим", () => {
    assert.equal(isBadPersonName("Иван Петров 8 800 600 8161"), true);
    assert.equal(isBadPersonName("Адрес: 194064, Санкт-Петербург"), true);
    assert.equal(isBadPersonName("Иван Петров"), false);
});

test("header-recovery: мусорная подпись с цифрами → имя из From", () => {
    const r = extractPersonName({
        senderDisplay: "Куцевич Татьяна Ивановна",
        signature: "Адрес: 194064, Санкт-Петербург",
        emailLocal: "t.kucevich",
    });
    assert.equal(r.primary, "Куцевич Татьяна Ивановна");
    assert.equal(r.source, "sender");
});

test("header-recovery: чистая подпись по-прежнему выигрывает у From (нет регрессии)", () => {
    const r = extractPersonName({
        senderDisplay: "Иван Иванов",
        signature: "С уважением, Петр Петров",
        emailLocal: "ppetrov",
    });
    assert.equal(r.primary, "Петр Петров");
    assert.equal(r.source, "signature");
});
