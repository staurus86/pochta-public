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
