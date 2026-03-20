import assert from "node:assert/strict";
import { detectionKb } from "../src/services/detection-kb.js";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runTest("classifies client request with KB rules", () => {
  const result = detectionKb.classifyMessage({
    subject: "Заявка на коммерческое предложение ABB",
    body: "Прошу выставить счет и обработать заявку по ABB",
    attachments: ["rekvizity.pdf"],
    fromEmail: "buyer@factory.ru",
    projectBrands: ["ABB"]
  });

  assert.equal(result.label, "Клиент");
  assert.ok(result.scores.client > result.scores.spam);
  assert.ok(result.detectedBrands.includes("ABB"));
});

runTest("detects brand aliases from knowledge base", () => {
  const brands = detectionKb.detectBrands("Запрос по endress и hauser на датчики", []);
  assert.ok(brands.includes("Endress & Hauser"));
});

runTest("classifies marketing newsletter as spam", () => {
  const result = detectionKb.classifyMessage({
    subject: "Весна, скидки до -70% на технику",
    body: "Вы подписаны на рассылку. Кэшбэк 10%, акция, промокод и управление подпиской в личном кабинете.",
    attachments: [],
    fromEmail: "promo@shop.example",
    projectBrands: []
  });

  assert.equal(result.label, "СПАМ");
  assert.ok(result.scores.spam > result.scores.client);
});

runTest("searchCorpus returns results via FTS5", () => {
  // Insert test record into corpus
  detectionKb.db.prepare(`
    INSERT OR IGNORE INTO message_corpus (project_id, message_key, subject, classification, confidence, body_excerpt, sender_email, company_name, brand_names, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("p-test", "fts-test-1", "Заявка на ABB ACS580", "client", 0.9, "Нужен привод ABB ACS580-01-12A7", "test@corp.ru", "ТестКорп", '["ABB"]', new Date().toISOString());

  // Rebuild index
  detectionKb.rebuildFtsIndex();

  const r1 = detectionKb.searchCorpus("ABB");
  assert.ok(r1.length >= 1, "FTS should find ABB");
  assert.ok(r1.some((r) => r.message_key === "fts-test-1"));

  const r2 = detectionKb.searchCorpus("ACS580");
  assert.ok(r2.length >= 1, "FTS should find ACS580");

  const r3 = detectionKb.searchCorpus("nonexistent_xyz_brand");
  assert.equal(r3.length, 0, "FTS should not find garbage");

  // Cleanup
  detectionKb.db.prepare("DELETE FROM message_corpus WHERE message_key = ?").run("fts-test-1");
  detectionKb.rebuildFtsIndex();
});
