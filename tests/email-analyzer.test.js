import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = {
  mailbox: "inbox@example.com",
  brands: ["ABB", "Schneider Electric", "R. Stahl", "Phoenix Contact", "Endress & Hauser"],
  managerPool: {
    defaultMop: "Ольга Демидова",
    defaultMoz: "Андрей Назаров",
    brandOwners: [{ brand: "ABB", mop: "Иван Колесов", moz: "Мария Петрова" }]
  },
  knownCompanies: [
    {
      id: "client-1001",
      legalName: "ООО ПромСнаб",
      inn: "7701234567",
      website: "https://promsnab.ru",
      domain: "promsnab.ru",
      curatorMop: "Иван Колесов",
      curatorMoz: "Мария Петрова",
      contacts: [
        {
          fullName: "Павел Ильин",
          email: "p.ilin@promsnab.ru",
          position: "Менеджер по закупкам"
        }
      ]
    }
  ]
};

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

runTest("analyzes client email and matches known company", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Павел Ильин",
    fromEmail: "p.ilin@promsnab.ru",
    subject: "Заявка ABB по артикулу",
    attachments: "rekvizity.pdf, shildik.jpg",
    body: `
      Добрый день.
      ООО "ПромСнаб", ИНН 7701234567
      Артикул S201-C16 x 20 шт
      С уважением,
      Павел Ильин
      Менеджер по закупкам
      +7 (495) 123-45-67
    `
  });

  assert.equal(analysis.classification.label, "Клиент");
  assert.equal(analysis.sender.companyName, 'ООО "ПромСнаб"');
  assert.equal(analysis.crm.isExistingCompany, true);
  assert.equal(analysis.crm.curatorMop, "Иван Колесов");
  assert.equal(analysis.lead.requestType, "Монобрендовая");
});

runTest("flags unknown company for clarification", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Анна",
    fromEmail: "anna@gmail.com",
    subject: "Нужна цена",
    attachments: "",
    body: `
      Добрый день.
      Нужна цена по позиции A9N18346 x 5 шт.
      Спасибо.
    `
  });

  assert.equal(analysis.crm.isExistingCompany, false);
  assert.equal(analysis.crm.needsClarification, true);
  assert.match(analysis.crm.suggestedReply, /реквизиты организации/i);
});

runTest("does not treat phone-like values as articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Елена Смирнова",
    fromEmail: "buyer@factory.ru",
    subject: "Запрос по ABB",
    attachments: "",
    body: `
      Добрый день.
      Для связи используйте номер 8 (495) 123-45-67.
      В старом шаблоне ошибочно указан "Артикул 84951234567".

      С уважением,
      Елена Смирнова
      +7 (495) 123-45-67
    `
  });

  assert.deepEqual(analysis.lead.articles, []);
  assert.equal(analysis.lead.totalPositions, 0);
});

runTest("ignores quoted thread and signature when extracting articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Ирина Петрова",
    fromEmail: "buyer@factory.ru",
    subject: "Нужна цена",
    attachments: "",
    body: `
      Добрый день.
      Прошу подготовить КП.

      С уважением,
      Ирина Петрова
      Менеджер по закупкам
      +7 (916) 555-44-33

      -----Original Message-----
      От: old@example.com
      Тема: RE: старый запрос
      Артикул OLD-777 x 10 шт
    `
  });

  assert.deepEqual(analysis.lead.articles, []);
  assert.equal(analysis.lead.totalPositions, 0);
});

runTest("keeps valid line items from main body while ignoring signature noise", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Павел Ильин",
    fromEmail: "p.ilin@promsnab.ru",
    subject: "Заявка ABB",
    attachments: "",
    body: `
      Добрый день.
      Артикул S201-C16 x 20 шт

      С уважением,
      Павел Ильин
      Менеджер по закупкам
      +7 (495) 123-45-67
    `
  });

  assert.ok(analysis.lead.articles.includes("S201-C16"));
  assert.ok(!analysis.lead.articles.includes("4951234567"));
  assert.equal(analysis.lead.lineItems[0]?.article, "S201-C16");
});

runTest("rejects phone fragments from form-style lines as numeric-only articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "noreply@tilda.ws",
    fromEmail: "noreply@tilda.ws",
    subject: "Заявка с формы",
    attachments: "",
    body: `
      Request details:
      Name: Светлана Филатова
      phone: +7 (351) 958-01-58
      email: buyer@example.com
      comment: Добрый день! Нужен комплект ABB S201-C16 - 1 шт.
      Request ID: 15957456:8028853052
    `
  });

  assert.ok(!analysis.lead.articles.includes("958-01"));
  assert.ok(!analysis.lead.articles.includes("15957456"));
  assert.ok(analysis.lead.articles.includes("S201-C16"));
});

runTest("does not treat inn and kpp fragments as articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Менеджер",
    fromEmail: "sales@factory.ru",
    subject: "Реквизиты и запрос",
    attachments: "",
    body: `
      Добрый день.
      ИНН 7701234567
      КПП 770101001
      ОГРН 1234567890123
      Артикул A9N18346 x 2 шт
    `
  });

  assert.ok(!analysis.lead.articles.includes("7701234567"));
  assert.ok(!analysis.lead.articles.includes("770101001"));
  assert.ok(!analysis.lead.articles.includes("1234567890123"));
  assert.ok(analysis.lead.articles.includes("A9N18346"));
});

runTest("detects brand aliases with punctuation and mixed separators", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@example.com",
    subject: "RFQ for RSTAHL and phoenix-contact",
    attachments: "",
    body: `
      Добрый день.
      Нужны позиции RSTAHL barrier и Phoenix-Contact relay.
      Также рассматриваем Endress+Hauser датчики.
    `
  });

  assert.ok(analysis.lead.detectedBrands.includes("R. Stahl"));
  assert.ok(analysis.lead.detectedBrands.includes("Phoenix Contact"));
  assert.ok(analysis.lead.detectedBrands.includes("Endress & Hauser"));
});

runTest("extracts requisites and labeled phones without leaking them into articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Менеджер",
    fromEmail: "sales@factory.ru",
    subject: "Карточка компании и запрос",
    attachments: "",
    body: `
      Карточка компании:
      ООО "Ромашка"
      ИНН: 7701234567
      КПП: 770101001
      ОГРН: 1234567890123
      Телефон: +7 (495) 111-22-33
      Моб.: +7 (926) 555-44-33

      Нужен артикул A9N18346 x 2 шт.
    `
  });

  assert.equal(analysis.sender.inn, "7701234567");
  assert.equal(analysis.sender.kpp, "770101001");
  assert.equal(analysis.sender.ogrn, "1234567890123");
  assert.equal(analysis.sender.mobilePhone, "+7 (926) 555-44-33");
  assert.ok(analysis.lead.articles.includes("A9N18346"));
  assert.ok(!analysis.lead.articles.includes("111-22"));
  assert.ok(!analysis.lead.articles.includes("770101001"));
});
