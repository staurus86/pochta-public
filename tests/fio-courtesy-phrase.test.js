// Regression: courtesy / sign-off phrases ("Sincerely", "За понимание",
// "Спасибо", "С уважением") must not survive as a person name. They reach
// fullName via the sender/display path (reanalysis feeds the prior fullName
// back in as senderDisplay), bypassing the signature greeting strip. The
// central isBadPersonName gate must reject a candidate that is *entirely* a
// courtesy phrase — while leaving real names (and "greeting + name") intact.
//
// Ground truth: manager needs_rework #2 (b16af540 → "Sincerely") and
// #12 (e09c3074 → "За Понимание", from "спасибо за понимание").

import { test } from "node:test";
import assert from "node:assert/strict";

import { isBadPersonName } from "../src/services/fio-filters.js";
import { extractPersonName } from "../src/services/fio-extractor.js";

test("isBadPersonName rejects pure courtesy / sign-off phrases", () => {
    assert.ok(isBadPersonName("Sincerely"));
    assert.ok(isBadPersonName("За Понимание"));
    assert.ok(isBadPersonName("за понимание"));
    assert.ok(isBadPersonName("Спасибо"));
    assert.ok(isBadPersonName("Благодарю"));
    assert.ok(isBadPersonName("С уважением"));
    assert.ok(isBadPersonName("Best regards"));
    assert.ok(isBadPersonName("Thank you"));
});

test("isBadPersonName keeps real names", () => {
    assert.ok(!isBadPersonName("Иван Петров"));
    assert.ok(!isBadPersonName("Дмитрий Вавилов"));
    assert.ok(!isBadPersonName("Anna Zimmermann"));
    // courtesy word as a prefix of a real name must NOT reject the whole string
    // (the cascade strips the prefix elsewhere; here we only guard whole-string)
    assert.ok(!isBadPersonName("Вера Михайловна"));
});

test("extractPersonName: courtesy phrase from sender path is rejected", () => {
    assert.equal(extractPersonName({ senderDisplay: "Sincerely" }).primary, null);
    assert.equal(extractPersonName({ senderDisplay: "За Понимание" }).primary, null);
});
