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

runTest("imports nomenclature dictionary and finds articles by RAG search", () => {
  const result = detectionKb.importNomenclatureCatalog([
    {
      "ID сделки": 900001,
      "Бренд": "Acme Controls",
      "Артикул": "RAG-TEST-001",
      "Наименование": "Датчик давления",
      "Описание": "Pressure sensor 4-20mA",
      "Кол-во": 3,
      "Цена продажи 1 шт.": 150.25
    },
    {
      "ID сделки": 900002,
      "Бренд": "Acme Controls",
      "Артикул": "RAG-TEST-001",
      "Наименование": "Датчик давления",
      "Описание": "Pressure sensor 4-20mA",
      "Кол-во": 1,
      "Цена продажи 1 шт.": 175.5
    }
  ], { sourceFile: "tests-fixture" });

  assert.ok(result.imported >= 1);

  const exact = detectionKb.findNomenclatureByArticle("rag-test-001");
  assert.equal(exact?.brand, "Acme Controls");
  assert.equal(exact?.source_rows, 2);

  const search = detectionKb.searchNomenclature("pressure sensor RAG-TEST-001", { limit: 5 });
  assert.ok(search.some((item) => item.article === "RAG-TEST-001"));
});

runTest("upserts sender profile and merges company and brand hints", () => {
  const uniqueEmail = "feedback-auto@example.com";
  const uniqueDomain = "example.com";

  const first = detectionKb.upsertSenderProfile({
    senderEmail: uniqueEmail,
    senderDomain: uniqueDomain,
    classification: "client",
    companyHint: "ООО Автофидбек",
    brandHint: "ABB",
    notes: "test-1"
  });

  const second = detectionKb.upsertSenderProfile({
    senderEmail: uniqueEmail,
    senderDomain: uniqueDomain,
    classification: "client",
    companyHint: "",
    brandHint: "Siemens, ABB",
    notes: "test-2"
  });

  assert.equal(first.id, second.id);
  assert.equal(second.company_hint, "ООО Автофидбек");
  assert.match(second.brand_hint, /ABB/i);
  assert.match(second.brand_hint, /Siemens/i);

  detectionKb.deactivateSenderProfile(second.id);
});

runTest("learns nomenclature from manual feedback", () => {
  detectionKb.learnNomenclatureFeedback({
    article: "FB-LEARN-001",
    brand: "Feedback Brand",
    productName: "Ручной датчик",
    sourceFile: "tests-manual-feedback"
  });

  const exact = detectionKb.findNomenclatureByArticle("fb-learn-001");
  assert.equal(exact?.brand, "Feedback Brand");
  assert.equal(exact?.product_name, "Ручной датчик");
});

runTest("invalidates cached sender profiles after add and deactivate", () => {
  const created = detectionKb.addSenderProfile({
    senderEmail: "cache-check@example.com",
    senderDomain: "example.com",
    classification: "client",
    companyHint: "ООО Кэш",
    brandHint: "ABB",
    notes: "cache-check"
  });

  const found = detectionKb.matchSenderProfile("cache-check@example.com");
  assert.equal(found?.id, created.id);

  detectionKb.deactivateSenderProfile(created.id);
  const afterDeactivate = detectionKb.matchSenderProfile("cache-check@example.com");
  assert.equal(afterDeactivate, null);
});

runTest("stores and reads client-specific API presets", () => {
  const clientId = "test-client-preset";
  const saved = detectionKb.upsertApiClientPreset(clientId, {
    presetKey: "my-problem-view",
    name: "My Problem View",
    description: "Only problematic messages",
    query: {
      preset: "problem_queue",
      priority: "high,critical"
    }
  });

  assert.equal(saved.clientId, clientId);
  assert.equal(saved.presetKey, "my-problem-view");
  assert.equal(saved.query.priority, "high,critical");

  const listed = detectionKb.listApiClientPresets(clientId);
  assert.ok(listed.some((item) => item.presetKey === "my-problem-view"));

  detectionKb.deleteApiClientPreset(clientId, "my-problem-view");
  const afterDelete = detectionKb.getApiClientPreset(clientId, "my-problem-view");
  assert.equal(afterDelete, null);
});

runTest("prefers project-scoped API presets over client-wide presets", () => {
  const clientId = "test-client-project-preset";
  detectionKb.upsertApiClientPreset(clientId, {
    presetKey: "ops_view",
    name: "Ops View",
    query: { confirmed: "false" }
  });
  detectionKb.upsertApiClientPreset(clientId, {
    presetKey: "ops_view_project",
    projectId: "project-1",
    name: "Ops View Project",
    query: { priority: "high" }
  });

  const scoped = detectionKb.listApiClientPresets(clientId, { projectId: "project-1" });
  assert.ok(scoped.some((item) => item.projectId === "project-1" && item.presetKey === "ops_view_project"));
  assert.ok(scoped.some((item) => item.projectId === null && item.presetKey === "ops_view"));

  const resolved = detectionKb.getApiClientPreset(clientId, "ops_view_project", { projectId: "project-1" });
  assert.equal(resolved?.projectId, "project-1");

  detectionKb.deleteApiClientPreset(clientId, "ops_view");
  detectionKb.deleteApiClientPreset(clientId, "ops_view_project", { projectId: "project-1" });
});
