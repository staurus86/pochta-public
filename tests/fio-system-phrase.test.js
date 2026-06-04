// Regression: client/system-generated phrases must not survive as a person name.
// Mobile mail clients append "Отправлено из ..." / "Sent from ..." and quoted
// threads leave "Вложения удалены" markers; the FIO extractor grabbed the first
// two words ("Отправлено Из", "Вложения Удалены") and emitted them as client_name.
// The isBadPersonName gate must reject these so the cascade falls through to the
// From-header name.
//
// Ground truth: unsent ready_for_crm batch 2026-06-05 — 7 of 10 "no company/INN"
// messages had fio="Отправлено Из" (5× Степан Медведев) or "Вложения Удалены"
// (0bc5d396 Аралов).

import { test } from "node:test";
import assert from "node:assert/strict";

import { isBadPersonName } from "../src/services/fio-filters.js";

test("isBadPersonName rejects mobile/system sign-off phrases", () => {
    assert.ok(isBadPersonName("Отправлено Из"));
    assert.ok(isBadPersonName("Отправлено из"));
    assert.ok(isBadPersonName("Отправлено из мобильного приложения"));
    assert.ok(isBadPersonName("Отправлено с iPhone"));
    assert.ok(isBadPersonName("Отправлено со смартфона"));
    assert.ok(isBadPersonName("Sent from my iPhone"));
    assert.ok(isBadPersonName("Sent from Mail.ru"));
});

test("isBadPersonName rejects 'Вложения удалены' attachment markers", () => {
    assert.ok(isBadPersonName("Вложения Удалены"));
    assert.ok(isBadPersonName("вложения удалены"));
    assert.ok(isBadPersonName("Вложение удалено"));
});

test("isBadPersonName keeps real names that merely start with similar letters", () => {
    // single-word surnames sharing a prefix must NOT be rejected
    assert.ok(!isBadPersonName("Отправленко Иван"));   // surname "Отправленко" + name
    assert.ok(!isBadPersonName("Сергей Вложенов"));     // surname "Вложенов"
    assert.ok(!isBadPersonName("Степан Медведев"));
    assert.ok(!isBadPersonName("Лев Александрович"));
    assert.ok(!isBadPersonName("Иван Петров"));
});
