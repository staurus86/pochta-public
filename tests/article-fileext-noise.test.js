import { test } from "node:test";
import assert from "node:assert/strict";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";

// Manager ground-truth (n8n needs_rework): a filename leaks into lead.articles as a
// phantom position. Case 4fc194fe: "R007.pdf" extracted alongside the real "AB050-R007".
// Corpus scan (research18, 1895 Клиент): 34 messages, 41 tokens ending in a file extension.
// No catalog article ends in .pdf/.jpg/.xlsx/etc. — these are always noise.

test("article-noise: имя файла с расширением документа отбрасывается", () => {
    assert.equal(isObviousArticleNoise("R007.pdf"), true);
    assert.equal(isObviousArticleNoise("220.PDF"), true);
    assert.equal(isObviousArticleNoise("doc02011520260402075257.pdf"), true);
    assert.equal(isObviousArticleNoise("5000plus.docx"), true);
    assert.equal(isObviousArticleNoise("TRAFAG1.pdf"), true);
    assert.equal(isObviousArticleNoise("451.pdf"), true);
});

test("article-noise: имя файла с расширением таблицы/изображения отбрасывается", () => {
    assert.equal(isObviousArticleNoise("00004473.xlsx"), true);
    assert.equal(isObviousArticleNoise("2000423780.xlsx.xls"), true); // double extension
    assert.equal(isObviousArticleNoise("1342447151.jpg"), true);
    assert.equal(isObviousArticleNoise("623483122.jpg"), true);
});

test("article-noise: реальные артикулы с точками НЕ отбрасываются как файлы", () => {
    // Dotted catalog codes must survive — they do not end in a file extension.
    assert.equal(isObviousArticleNoise("80.364.40.FHN"), false);
    assert.equal(isObviousArticleNoise("8316/22-24-100"), false);
    assert.equal(isObviousArticleNoise("10.02.071-ATX-211"), false);
});
