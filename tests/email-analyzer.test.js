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

// --- Own brand blacklist tests ---

runTest("does not detect Siderus as brand from forwarded email signature", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Казанцев А.Н.",
    fromEmail: "robot-mail-siderus@klvrt.ru",
    subject: "Re: Запрос",
    attachments: "",
    body: `
      Извините, меня ваше предложение не устраивает.

      --
      Отправлено из мобильного приложения

      От: 'Казанцев Андрей' <kazansev.a.n@yandex.ru>;
      Дата: Вторник;
      18.03.2026, 12:11, "SIDERUS" <info@siderus.ru>:
       В ожидании вашего подтверждения.

       С уважением,

       Менеджер отдела
       ООО «Сидерус» | SIDERUS

       i n f o @siderus.ru

       siderus.ru

       +7 499 647-47-07

       107061, г. Москва, Преображенская площадь
    `
  });

  assert.ok(!analysis.detectedBrands.includes("Siderus"));
  assert.ok(!analysis.detectedBrands.includes("SIDERUS"));
  assert.ok(!analysis.lead.detectedBrands.includes("Siderus"));
});

runTest("does not detect KLVRT/Коловрат as brands", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Иванов",
    fromEmail: "buyer@factory.ru",
    subject: "Заявка ABB от KLVRT",
    attachments: "",
    body: `
      Добрый день. Нужна цена по ABB S201-C16 x 10 шт.
      Компания Коловрат, отдел закупок.
    `
  });

  assert.ok(!analysis.detectedBrands.includes("KLVRT"));
  assert.ok(!analysis.detectedBrands.includes("Коловрат"));
  assert.ok(analysis.detectedBrands.includes("ABB"));
});

// --- Numeric article tests ---

runTest("detects numeric article with dash from subject (509-1720)", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Закупщик",
    fromEmail: "buyer@factory.ru",
    subject: "509-1720 запрос на КП",
    attachments: "",
    body: `
      Добрый день.
      Нужен артикул 509-1720, 2 шт.
      С уважением.
    `
  });

  assert.ok(analysis.lead.articles.includes("509-1720"), `Expected 509-1720, got: ${analysis.lead.articles}`);
});

runTest("detects numeric articles from body and subject together", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@corp.ru",
    subject: "Запрос цен",
    attachments: "",
    body: `
      Добрый день.
      Позиции:
      509-1720 — 2 шт
      6ES7-315-2AH14 x 1
    `
  });

  assert.ok(analysis.lead.articles.includes("509-1720"), `Should detect 509-1720`);
});

runTest("does not treat dates as numeric articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@corp.ru",
    subject: "Заявка от 15-03",
    attachments: "",
    body: `
      Добрый день. Поставка до 25/12/2026.
      Артикул S201-C16 x 5 шт.
    `
  });

  assert.ok(!analysis.lead.articles.includes("15-03"));
  assert.ok(!analysis.lead.articles.includes("25/12/2026"));
  assert.ok(!analysis.lead.articles.includes("25/12"));
  assert.ok(analysis.lead.articles.includes("S201-C16"));
});

runTest("extracts articles from attachment filenames", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@corp.ru",
    subject: "Запрос по деталям",
    attachments: "509-1720_datasheet.pdf, photo.jpg",
    body: `
      Добрый день. Нужна цена.
    `
  });

  assert.ok(analysis.lead.articles.includes("509-1720"), `Should extract from attachment name`);
});

// --- Phone validation tests ---

runTest("rejects invalid phone code 032", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Тест",
    fromEmail: "test@factory.ru",
    subject: "Тест телефонов",
    attachments: "",
    body: `
      Добрый день. Тел: 8 (032) 485-77-21
      Моб: +7 (916) 123-45-67
    `
  });

  // Invalid city code 032 should be rejected
  assert.equal(analysis.sender.cityPhone, null);
  assert.equal(analysis.sender.mobilePhone, "+7 (916) 123-45-67");
});

runTest("normalizes phone numbers to consistent format", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Тест",
    fromEmail: "test@factory.ru",
    subject: "Тест",
    attachments: "",
    body: `
      Тел: +7(495)764-16-58
      Моб: 89161234567
    `
  });

  assert.equal(analysis.sender.cityPhone, "+7 (495) 764-16-58");
  assert.equal(analysis.sender.mobilePhone, "+7 (916) 123-45-67");
});

// --- Smoke tests: own company filtering ---

runTest("does not extract ООО Коловрат as sender company name", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Менеджер",
    fromEmail: "buyer@factory.ru",
    subject: "Запрос КП",
    attachments: "",
    body: `
      Добрый день.
      Нужна цена на ABB S201-C16.

      С уважением,
      Менеджер отдела продаж
      ООО «Коловрат» | SIDERUS
      info@siderus.ru
      +7 499 647-47-07
    `
  });

  assert.ok(!/коловрат/i.test(analysis.sender.companyName || ""), `companyName should not be Коловрат, got: ${analysis.sender.companyName}`);
  assert.ok(!/сидерус/i.test(analysis.sender.companyName || ""), `companyName should not be Сидерус`);
  assert.ok(!analysis.detectedBrands.includes("Siderus"));
  assert.ok(!analysis.detectedBrands.includes("SIDERUS"));
});

runTest("does not detect SIDERUS or Support as articles", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Казанцев",
    fromEmail: "robot-mail-siderus@klvrt.ru",
    subject: "Re: Запрос",
    attachments: "",
    body: `
      Спасибо за информацию.

      18.03.2026, "SIDERUS" <info@siderus.ru>:
      В ожидании подтверждения.
      ООО «Сидерус» | SIDERUS
      siderus.ru
      +7 499 647-47-07
    `
  });

  assert.ok(!analysis.lead.articles.includes("SIDERUS"), `SIDERUS should not be an article`);
  assert.ok(!analysis.lead.articles.includes("Support"), `Support should not be an article`);
  assert.ok(!analysis.detectedBrands.includes("Siderus"));
});

runTest("smoke: brand catalog detects known brands from catalog", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@corp.ru",
    subject: "Запрос LENZE и Heidenhain",
    attachments: "",
    body: `
      Добрый день. Нужны:
      1. Привод LENZE i550 — 2 шт
      2. Энкодер Heidenhain ROD 426 — 1 шт
      3. Датчик SICK WTB27 — 3 шт
    `
  });

  assert.ok(analysis.detectedBrands.includes("LENZE"), `Should detect LENZE`);
  assert.ok(analysis.detectedBrands.includes("Heidenhain"), `Should detect Heidenhain`);
  assert.ok(analysis.detectedBrands.includes("SICK"), `Should detect SICK`);
  assert.equal(analysis.lead.requestType, "Мультибрендовая");
});

runTest("smoke: numeric articles with brand-adjacent codes", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@corp.ru",
    subject: "509-1720 запрос",
    attachments: "METROHM_63032220.pdf",
    body: `
      Добрый день. Нужно:
      Артикул 509-1720 — 2 шт
      METROHM 63032220 бюретка дозирующая
    `
  });

  assert.ok(analysis.lead.articles.includes("509-1720"), `Should detect 509-1720`);
  assert.ok(analysis.lead.articles.includes("63032220"), `Should detect 63032220 (brand-adjacent)`);
});

runTest("smoke: 8-800 toll-free number preserved as cityPhone", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Test",
    fromEmail: "test@factory.ru",
    subject: "Тест",
    attachments: "",
    body: `
      Контакты: 8-800-555-85-19
      Моб: +7 (916) 123-45-67
    `
  });

  assert.equal(analysis.sender.cityPhone, "+7 (800) 555-85-19");
  assert.equal(analysis.sender.mobilePhone, "+7 (916) 123-45-67");
});
