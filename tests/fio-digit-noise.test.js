import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSenderFields } from "../src/services/email-analyzer.js";

// Manager ground-truth (n8n needs_rework): sender.fullName filled with digit garbage —
// address lines, INN/KPP, phones, Telegram/URLs — instead of a person name.
// Corpus scan (research18, 1895 Клиент): 36 messages whose fullName contains digits.
// A person name never contains a digit → reject; recover a clean leading name if present.

function nameAfter(fullName) {
    const s = { fullName };
    validateSenderFields(s);
    return s.fullName;
}

test("fio-digit: чистый мусор с цифрами отбрасывается в null", () => {
    assert.equal(nameAfter("Адрес: 194064, Санкт-Петербург"), null);
    assert.equal(nameAfter("Инн 7804418217, Кпп 781401001"), null);
    assert.equal(nameAfter("Telegram +7(977) 503-43-69"), null);
    assert.equal(nameAfter("Тел. 8-908-114-25-85"), null);
    assert.equal(nameAfter("Телефон Для Связи (4852)64-55-49"), null);
});

test("fio-digit: реальное имя с контакт-хвостом восстанавливается", () => {
    assert.equal(nameAfter("Харитонов Александр 8 800 600 8161"), "Харитонов Александр");
});

test("fio-digit: чистое имя без цифр не затрагивается", () => {
    assert.equal(nameAfter("Иван Петров"), "Иван Петров");
    assert.equal(nameAfter("Куцевич Татьяна Ивановна"), "Куцевич Татьяна Ивановна");
});
