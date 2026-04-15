import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeEmail } from "../src/services/email-analyzer.js";
import { detectionKb } from "../src/services/detection-kb.js";

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

function withStoredAttachment(messageKey, filename, contents, fn) {
  const dir = path.resolve(process.cwd(), "data", "attachments", messageKey);
  mkdirSync(dir, { recursive: true });
  const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
  const filePath = path.join(dir, safeName);
  writeFileSync(filePath, contents);
  try {
    return fn({ safeName, size: Buffer.byteLength(contents) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withArchiveAttachment(messageKey, filename, files, fn) {
  const dir = path.resolve(process.cwd(), "data", "attachments", messageKey);
  const buildDir = path.join(dir, "__build__");
  mkdirSync(buildDir, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(buildDir, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  }

  const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
  const archivePath = path.join(dir, safeName);
  const entries = Object.keys(files);
  const result = spawnSync("tar", ["-a", "-cf", archivePath, "-C", buildDir, ...entries], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar failed: ${result.stderr || result.stdout}`);
  }

  try {
    return fn({ safeName, size: statSync(archivePath).size });
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

runTest("enriches sender from company directory when email is known", () => {
  detectionKb.importCompanyDirectory([
    {
      name: "ООО ДоменТест",
      inn: "7812345678",
      fio: "Соколова Анна",
      post: "Специалист по закупкам",
      email: "procurement@domain-test.ru",
      okved: "46.69.5",
      okved_title: "Оптовая торговля оборудованием"
    }
  ], { sourceFile: "tests-email-analyzer" });

  const analysis = analyzeEmail(project, {
    fromName: "",
    fromEmail: "procurement@domain-test.ru",
    subject: "Нужна цена по позиции",
    attachments: "",
    body: `
      Добрый день.
      Прошу выставить КП на позицию 6GK7343-2AH01.
    `
  });

  assert.equal(analysis.sender.companyName, "ООО ДоменТест");
  assert.equal(analysis.sender.inn, "7812345678");
  assert.equal(analysis.sender.position, "Специалист по закупкам");
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

// --- P1-03: INN/КПП combined format ---

runTest("extracts INN and KPP from combined ИНН/КПП: X/Y format", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Менеджер",
    fromEmail: "sales@factory.ru",
    subject: "Запрос",
    attachments: "",
    body: `
      Добрый день.
      ООО "Завод"
      ИНН/КПП: 7701234567/770101001
      Нужен артикул A9N18346 x 1 шт.
    `
  });

  assert.equal(analysis.sender.inn, "7701234567");
  assert.equal(analysis.sender.kpp, "770101001");
});

// --- P1-04: Phone без +7/8 после лейбла ---

runTest("extracts phone without +7 prefix when labeled", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Иванов Иван",
    fromEmail: "ivan@company.ru",
    subject: "Запрос",
    attachments: "",
    body: `
      Добрый день, нужен артикул ABB S201-C16 х 2 шт.
      Тел: 495-123-45-67
    `
  });

  assert.ok(analysis.sender.cityPhone || analysis.sender.mobilePhone, "phone should be extracted");
});

// --- P1-08: Company from short corporate domain ---

runTest("extracts company from short corporate domain (3 chars)", () => {
  const analysis = analyzeEmail(project, {
    fromName: "Петров Иван",
    fromEmail: "ivan@mmk.ru",
    subject: "Запрос",
    attachments: "",
    body: `Добрый день, нужен артикул ABB S201-C16 х 1 шт.`
  });

  assert.ok(analysis.sender.companyName, "company should be inferred from short domain");
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

runTest("caps detected brands at 15 even when attachment is a full catalog", () => {
  // Simulate huge attachment with many brand names
  const brandNames = ["Siemens", "ABB", "Schneider", "Phoenix Contact", "Weidmuller",
    "Pepperl+Fuchs", "Turck", "Sick", "Banner", "Balluff",
    "IFM", "Omron", "Keyence", "Leuze", "Pilz",
    "Wago", "Murr", "Beckhoff", "Festo", "Bosch Rexroth", "Parker"];
  const analysis = analyzeEmail(project, {
    fromName: "Buyer",
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    attachments: brandNames.map((b) => `${b} catalog.pdf`),
    body: `Нужен артикул ABB S201-C16 x 1 шт.`
  });

  assert.ok(
    (analysis.detectedBrands || []).length <= 15,
    `Brand count should be ≤15, got ${(analysis.detectedBrands || []).length}`
  );
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

  assert.ok(analysis.detectedBrands.some((b) => b.toLowerCase() === "lenze"), `Should detect Lenze`);
  assert.ok(analysis.detectedBrands.some((b) => b.toLowerCase() === "heidenhain"), `Should detect Heidenhain`);
  assert.ok(analysis.detectedBrands.some((b) => b.toLowerCase() === "sick"), `Should detect SICK`);
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

// ═══ Letter 1: Numbered list with motor-reducers (Lenze) ═══
runTest("detects numbered list items with articles and descriptions", () => {
  const analysis = analyzeEmail(project, {
    fromEmail: "smc@noxangroup.by",
    fromName: "Макаренко Татьяна",
    subject: "Запрос на мотор-редукторы",
    attachments: "",
    body: `Добрый день. Надо вот эти мотор-редукторы:

1. Мотор-редуктор Drehstrom-Normmotor М100Ф-8 трёхфазный
{переменный} ток - асинхронный: электродвигатель 230/400 В +/-1096,50 Гц,
мощность-0,75 кВт

2. Moтоp-редуктор Lenze MDEMA1M100-32 трёхфазный (переменный)ток-
асинхронный электродвигатель 230/400 В +/-10%, 50 Гц, мощность 3 кВт

3. Редуктор NHRY 090, ВЗ-В6-В7 80,00

Может что-то есть ? буду благодарна за ответ.

С уважением,
Макаренко Татьяна,
Менеджер по ВЭС
ООО "Ноксан групп"
220033, Минск, Республика Беларусь,
ул. Аранская, 13, офис 18
Тел.: +375173500423
Velcom: +375296156910`
  });

  // Should NOT detect 230/400 as article (voltage)
  assert.ok(!analysis.lead.articles.includes("230/400"), "230/400 is voltage, not article");
  // Should detect MDEMA1M100-32 as article (not split into MDEMA1M100 + 32 qty)
  assert.ok(analysis.lead.articles.some((a) => a.includes("MDEMA1M100")), "Should detect MDEMA1M100-32");
  // Should detect Lenze as brand
  assert.ok(analysis.detectedBrands.some((b) => b.toLowerCase() === "lenze") || analysis.classification.detectedBrands.some((b) => b.toLowerCase() === "lenze"), "Should detect Lenze brand");
  // Should have multiple line items (at least 2)
  assert.ok(analysis.lead.lineItems.length >= 2 || analysis.lead.articles.length >= 2, `Should have >= 2 items, got ${analysis.lead.lineItems.length} items, ${analysis.lead.articles.length} articles`);
  // Should detect sender company
  assert.equal(analysis.sender.companyName, 'ООО "Ноксан групп"');
});

// ═══ Letter 2: Joystick dust cover GESSMANN VV64:KMD 66 ═══
runTest("detects product with quantity pattern: Description ARTICLE - N шт", () => {
  const analysis = analyzeEmail(project, {
    fromEmail: "popova1982v@yandex.ru",
    fromName: "Валентина Попова",
    subject: "Запрос на пыльник",
    attachments: "",
    body: `Добрый день! Подскажите, пожалуйста, есть ли у вас данный товар:   Пыльник резиновый для джойстика GESSMANN VV64:KMD 66 - 4 шт   По возможности счет,  данные по доставке до г. Череповец (габариты груза для расчета стоимости доставки) Просьба уточнить сроки поставки   --  С Уважением Валентина Попова ООО"Ресурс" раб.тел.: 59 65 23 моб.тел.: +7 911 544 60 53 Popova1982V @  yandex.ru Наш сайт: http://ресурсметалл35.рф/`
  });

  // Should detect article with quantity
  const hasArticle = analysis.lead.articles.some((a) => a.includes("VV64") || a.includes("KMD"));
  assert.ok(hasArticle || analysis.lead.lineItems.some((li) => li.article.includes("VV64") || li.descriptionRu?.includes("VV64")), "Should detect VV64:KMD 66 or similar article");
  // Should detect quantity 4
  const item4 = analysis.lead.lineItems.find((li) => li.quantity === 4);
  assert.ok(item4 || analysis.lead.totalPositions >= 1, "Should detect quantity 4 шт");
});

// ═══ Letter 3: IS7000 stabilizer — should not detect "ип стабилизатора" as company ═══
runTest("does not extract 'ип стабилизатора' as company name", () => {
  const analysis = analyzeEmail(project, {
    fromEmail: "lutsenko@snipermail.ru",
    fromName: "ИП Луценко Оксана Анатольевна",
    subject: "Запрос на стабилизатор IS7000",
    attachments: "",
    body: `Здравствуйте. Прошу выставить счет на следующие позиции: Стабилизатор напряжения Штиль Инстаб IS7000 - 1.00 шт Код ОКПД2:26.51.45.190 Код ЕАТ:070801005 Описание предложения:Установка настенный Тип стабилизатора напряжения инверторный Тип входного напряжения однофазный Полная выходная мощность 7000 ВА ЖК-дисплей есть Поставка в Москва->Якутск. Карточка предприятия прилагается.

С уважением, Евгений.
+7-916-545-68-88
e-mail: lutsenko@snipermail.ru
#58794:`
  });

  // Should NOT detect "ип стабилизатора напряжения инверторный" as company
  assert.ok(
    !analysis.sender.companyName || !analysis.sender.companyName.toLowerCase().includes("стабилизатор"),
    `Company should not be '${analysis.sender.companyName}'`
  );
  // Should detect IS7000 as article
  assert.ok(analysis.lead.articles.includes("IS7000"), "Should detect IS7000 as article");
});

// ═══ Product name detection tests ═══

runTest("does not create DESC: item when article code is already extracted from request phrase", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: "Нужен датчик давления PR200-24-4-2-0 в количестве 2 шт."
  });
  const articles = result.lead.articles || [];
  const descItems = articles.filter((a) => a && a.startsWith("DESC:"));
  const realItems = articles.filter((a) => a && !a.startsWith("DESC:"));
  assert.ok(realItems.length > 0, "should extract real article code");
  assert.ok(descItems.length === 0, `should not create DESC: when article is present, got: ${descItems.join(", ")}`);
});

runTest("does not create DESC: from PDF metadata lines", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос ПЛК",
    attachments: ["spec.pdf"],
    body: `Нужен ПЛК.
StructTreeRoot 23 0 R
DescendantFonts encoding identity-h
ImageMask true
ViewerPreferences PickTrayByPDFSize true`
  });
  const descItems = (result.lead.articles || []).filter((a) => a && a.startsWith("DESC:"));
  const pdfDesc = descItems.filter((a) =>
    /structtree|descendant|imagemask|viewerpref/i.test(a)
  );
  assert.ok(pdfDesc.length === 0, `PDF metadata should not become DESC: articles, got: ${pdfDesc.join(", ")}`);
});

runTest("extractLead detects product names from context", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос КП",
    body: "Прошу выставить счёт на датчик давления PMC51-AA21, клапан электромагнитный VZWM-L-M22C, и насос CR10-3"
  });
  const lead = result.lead;
  assert.ok(Array.isArray(lead.productNames));
  assert.ok(lead.productNames.length > 0);
  // At least one should have a name with "датчик" or "клапан" or "насос"
  const names = lead.productNames.map(p => p.name).filter(Boolean);
  assert.ok(names.length > 0, "Should detect at least one product name from context");
});

runTest("extractLead trims product name noise around line item requests", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@energy.ru",
    subject: "Запрос КП",
    body: 'Здравствуйте. Просим прислать счет или КП на следующие позиции: 1. Модуль канавочный левый MSS-T25L03-GX16-2 - 30 шт. Прописать срок доставки. Карточка предприятия во вложении. Пономарева Валерия Владимировна ПАО "Энергия"'
  });

  const match = result.lead.productNames.find((item) => item.article === "MSS-T25L03-GX16-2");
  assert.ok(match, "Should have a product name entry for MSS-T25L03-GX16-2");
  assert.equal(match.name, "Модуль канавочный левый");
});

runTest("extracts requisites and article data from stored txt attachment", () => {
  const messageKey = "attach-test-msg-1";
  withStoredAttachment(
    messageKey,
    "rekvizity.txt",
    'ООО "Энергия"\nИНН 7702802784\nКПП 770201001\nОГРН 1234567890123\nАртикул MSS-T25L03-GX16-2\nКоличество 30 шт',
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@energy.ru",
        subject: "Запрос",
        body: "См. вложение",
        attachments: ["rekvizity.txt"],
        attachmentFiles: [{ filename: "rekvizity.txt", safeName, size, contentType: "text/plain" }]
      });

      assert.equal(result.sender.inn, "7702802784");
      assert.equal(result.sender.kpp, "770201001");
      assert.equal(result.sender.ogrn, "1234567890123");
      assert.ok(result.lead.articles.includes("MSS-T25L03-GX16-2"));
      assert.equal(result.attachmentAnalysis.meta.processedCount, 1);
      assert.equal(result.attachmentAnalysis.files[0].status, "processed");
    }
  );
});

runTest("skips oversized stored attachment by limit without breaking analysis", () => {
  const result = analyzeEmail(project, {
    messageKey: "attach-test-msg-2",
    fromEmail: "buyer@energy.ru",
    subject: "Запрос",
    body: "См. вложение",
    attachments: ["big-spec.txt"],
    attachmentFiles: [{ filename: "big-spec.txt", safeName: "big-spec.txt", size: 9 * 1024 * 1024, contentType: "text/plain" }]
  });

  assert.equal(result.attachmentAnalysis.meta.processedCount, 0);
  assert.equal(result.attachmentAnalysis.meta.skippedCount, 1);
  assert.match(result.attachmentAnalysis.files[0].reason, /file_too_large/);
});

runTest("skips low quality pdf text so pdf internals do not pollute article detection", () => {
  const messageKey = "attach-test-msg-3";
  withStoredAttachment(
    messageKey,
    "spec.pdf",
    "%PDF-1.4 BT /F1 12 Tf (Filter/FlateDecode Type/XObject BaseFont FontDescriptor ColorSpace BitsPerComponent) Tj ET",
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@energy.ru",
        subject: "Запрос",
        body: "См. вложение",
        attachments: ["spec.pdf"],
        attachmentFiles: [{ filename: "spec.pdf", safeName, size, contentType: "application/pdf" }]
      });

      assert.equal(result.attachmentAnalysis.meta.processedCount, 0);
      assert.ok(["low_quality_pdf_text", "no_text_extracted"].includes(result.attachmentAnalysis.files[0].reason));
      assert.deepEqual(result.lead.articles, []);
    }
  );
});

runTest("marks image attachments as waiting for OCR instead of unsupported", () => {
  const result = analyzeEmail(project, {
    messageKey: "attach-test-msg-image",
    fromEmail: "buyer@energy.ru",
    subject: "Фото шильдика",
    body: "См. фото",
    attachments: ["photo.jpg"],
    attachmentFiles: [{ filename: "photo.jpg", safeName: "photo.jpg", size: 1024, contentType: "image/jpeg" }]
  });

  assert.equal(result.attachmentAnalysis.meta.processedCount, 0);
  assert.equal(result.attachmentAnalysis.files[0].reason, "ocr_unavailable_image");
});

runTest("extracts article from stored docx attachment", () => {
  const messageKey = "attach-test-msg-4";
  withArchiveAttachment(
    messageKey,
    "spec.docx",
    {
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Модуль канавочный левый MSS-T25L03-GX16-2</w:t></w:r></w:p></w:body></w:document>"
    },
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@energy.ru",
        subject: "Запрос",
        body: "Во вложении docx",
        attachments: ["spec.docx"],
        attachmentFiles: [{ filename: "spec.docx", safeName, size, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]
      });

      assert.equal(result.attachmentAnalysis.meta.processedCount, 1);
      assert.ok(result.lead.articles.includes("MSS-T25L03-GX16-2"));
      assert.ok(result.lead.lineItems.some((item) => item.article === "MSS-T25L03-GX16-2" && String(item.source || "").startsWith("attachment:")));
    }
  );
});

runTest("extracts article and inn from stored xlsx attachment", () => {
  const messageKey = "attach-test-msg-5";
  withArchiveAttachment(
    messageKey,
    "spec.xlsx",
    {
      "[Content_Types].xml": "<Types/>",
      "xl/sharedStrings.xml": "<sst><si><t>Артикул</t></si><si><t>Количество</t></si><si><t>ИНН</t></si><si><t>MSS-T25L03-GX16-2</t></si><si><t>7702802784</t></si></sst>",
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c t=\"s\"><v>0</v></c><c t=\"s\"><v>1</v></c><c t=\"s\"><v>2</v></c></row><row><c t=\"s\"><v>3</v></c><c><v>30</v></c><c t=\"s\"><v>4</v></c></row></sheetData></worksheet>"
    },
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@energy.ru",
        subject: "Запрос",
        body: "Во вложении xlsx",
        attachments: ["spec.xlsx"],
        attachmentFiles: [{ filename: "spec.xlsx", safeName, size, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
      });

      assert.equal(result.attachmentAnalysis.meta.processedCount, 1);
      assert.ok(result.lead.articles.includes("MSS-T25L03-GX16-2"));
      assert.equal(result.sender.inn, "7702802784");
      assert.ok(result.lead.lineItems.some((item) => item.article === "MSS-T25L03-GX16-2" && item.quantity === 30));
      assert.ok(result.lead.productNames.some((item) => item.article === "MSS-T25L03-GX16-2"));
    }
  );
});

runTest("extracts requisites from legacy doc attachment without OCR", () => {
  const messageKey = "attach-test-msg-legacy-doc";
  withStoredAttachment(
    messageKey,
    "Карточка предприятия.doc",
    'ООО "Реновация"\nИНН 7702802784\nКПП 770201001\nОГРН 1234567890123\nАртикул WRD3416\nКоличество 2 шт',
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@renova.ru",
        subject: "Запрос",
        body: "См. реквизиты во вложении",
        attachments: ["Карточка предприятия.doc"],
        attachmentFiles: [{ filename: "Карточка предприятия.doc", safeName, size, contentType: "application/msword" }]
      });

      assert.equal(result.attachmentAnalysis.meta.processedCount, 1);
      assert.equal(result.sender.inn, "7702802784");
      assert.ok(result.lead.articles.includes("WRD3416"));
    }
  );
});

runTest("rejects email address, disclaimer text, and department names as company", () => {
  const withEmail = analyzeEmail(project, {
    fromEmail: "ivan@company.ru",
    subject: "Запрос",
    body: `
      ООО Ромашка sales@romashka.ru
      Нужен артикул ABB S201-C16 x 1 шт.
    `
  });
  assert.ok(withEmail.sender.companyName !== "ООО Ромашка sales@romashka.ru", "email in company should be rejected");

  const withDisclaimer = analyzeEmail(project, {
    fromEmail: "ivan@company.ru",
    subject: "Запрос",
    body: `
      Нужен артикул ABB S201-C16 x 1 шт.

      Mail may contain co
    `
  });
  assert.ok(withDisclaimer.sender.companyName !== "Mail may contain co", "disclaimer phrase should not become company");

  const withDepartment = analyzeEmail(project, {
    fromEmail: "ivan@firma.ru",
    subject: "Запрос",
    body: `
      С уважением,
      Иванов Иван
      Отдел закупок
      +7 (495) 111-22-33
      Нужен артикул ABB S201-C16 x 1 шт.
    `
  });
  assert.ok(withDepartment.sender.companyName !== "Отдел закупок", "department name should not become company");
});

runTest("cleans company names from trailing contact labels and nested quotes", () => {
  const malformedCompany = analyzeEmail(project, {
    fromEmail: "pkf-monarh@yandex.ru",
    subject: "Re: Заявка",
    body: `
      -- 
      С Уважением,
      Мальцев Алексей, ООО ПКФ Монарх
      тел.(8452) 46-85-13
      сайт: www.optgaz.ru
      Эл. почта: pkf-monarh@yandex.ru
    `
  });

  assert.equal(malformedCompany.sender.companyName, "ООО ПКФ Монарх");

  const nestedQuotes = analyzeEmail(project, {
    fromEmail: "buyer@agat.ru",
    subject: "от АО \"Концерн \"Моринсис - Агат\"",
    body: `
      от АО "Концерн "Моринсис - Агат"
      тел. +7 (499) 647-47-07
    `
  });

  assert.equal(nestedQuotes.sender.companyName, 'АО "Концерн "Моринсис - Агат"');
});

runTest("rejects contact and cid noise as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    subject: "RE: запрос на поставку",
    body: `
      Иванова.Н.А1
      ул. Металлургов, 15
      cid:image001.png
      office: 8-800-600-6-600
      Нужен артикул BTL7-E501-M0800-P-S32 - 1 шт
    `
  });

  assert.ok(result.lead.articles.includes("BTL7-E501-M0800-P-S32"));
  assert.ok(!result.lead.articles.includes("ivanova.n.a1"));
  assert.ok(!result.lead.articles.includes("Металлургов"));
  assert.ok(!result.lead.articles.some((item) => /^cid:/i.test(item)));
  assert.ok(!result.lead.articles.some((item) => /^8-800-/.test(item)));
});

runTest("reapplies company directory hints after attachment inn extraction", () => {
  detectionKb.importCompanyDirectory([
    {
      name: "ООО ГЕЛЛЕР РУС",
      inn: "7731304374",
      email: "buyer@geller-rus.ru",
      fio: "Анна",
      post: "Менеджер"
    }
  ], { sourceFile: "tests-reapply-company-directory" });

  const messageKey = "attach-test-msg-company-reapply";
  withStoredAttachment(
    messageKey,
    "Карточка предприятия.doc",
    'ИНН 7731304374\nКПП 770101001\nОГРН 1167746069380',
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "unknown.sender@yandex.ru",
        subject: "Запрос",
        body: "См. реквизиты во вложении",
        attachments: ["Карточка предприятия.doc"],
        attachmentFiles: [{ filename: "Карточка предприятия.doc", safeName, size, contentType: "application/msword" }]
      });

      assert.equal(result.sender.inn, "7731304374");
      assert.equal(result.sender.companyName, "ООО ГЕЛЛЕР РУС");
      assert.equal(result.sender.sources.company, "company_directory");
    }
  );
});

runTest("adds brand from nomenclature semantic fallback when description matches dictionary", () => {
  detectionKb.importNomenclatureCatalog([
    {
      "ID сделки": 910099,
      "Бренд": "Frontmatec",
      "Артикул": "FMT-777",
      "Наименование": "санитайзер роторный пищевой",
      "Описание": "санитайзер Frontmatec для пищевой линии",
      "Кол-во": 1
    }
  ], { sourceFile: "semantic-brand-fixture" });

  const result = analyzeEmail(project, {
    fromEmail: "buyer@foodline.ru",
    subject: "Запрос на санитайзер для пищевой линии",
    body: "Добрый день. Нужен санитайзер роторный пищевой для линии мойки."
  });

  assert.ok(result.lead.detectedBrands.includes("Frontmatec"));
});

runTest("filters requisites and engineering ids from attachment-derived articles", () => {
  const messageKey = "attach-test-msg-noise";
  withStoredAttachment(
    messageKey,
    "Реквизиты.txt",
    'АО "ГЕЛЛЕР РУС" Юридический и фактический адрес\n2BM-9701077015-770101001-201711021137514319612\n8-800-201-42-41\n1167746069380\nDN 80\nWRD0004',
    ({ safeName, size }) => {
      const result = analyzeEmail(project, {
        messageKey,
        fromEmail: "buyer@geller-rus.ru",
        subject: "Запрос",
        body: "См. вложение",
        attachments: ["Реквизиты.txt"],
        attachmentFiles: [{ filename: "Реквизиты.txt", safeName, size, contentType: "text/plain" }]
      });

      assert.ok(result.lead.articles.includes("WRD0004"));
      assert.ok(!result.lead.articles.includes("2BM-9701077015-770101001-201711021137514319612"));
      assert.ok(!result.lead.articles.includes("8-800-201-42-41"));
      assert.ok(!result.lead.articles.includes("1167746069380"));
      assert.ok(!result.lead.articles.includes("DN 80"));
      assert.equal(result.sender.companyName, 'АО "ГЕЛЛЕР РУС"');
    }
  );
});

runTest("filters office xml namespace noise from detected articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос по вложению",
    body: `Артикул: 6EP1334-3BA10
THEME/THEME/THEME1
1TABLE
UTF-8
DRAWINGML/2006/MAIN
97-2003
BG1
LT1
TX1`
  });

  assert.ok(result.lead.articles.includes("6EP1334-3BA10"));
  assert.ok(!result.lead.articles.includes("THEME/THEME/THEME1"));
  assert.ok(!result.lead.articles.includes("1TABLE"));
  assert.ok(!result.lead.articles.includes("UTF-8"));
  assert.ok(!result.lead.articles.includes("DRAWINGML/2006/MAIN"));
  assert.ok(!result.lead.articles.includes("97-2003"));
  assert.ok(!result.lead.articles.includes("BG1"));
  assert.ok(!result.lead.articles.includes("LT1"));
  assert.ok(!result.lead.articles.includes("TX1"));
});

runTest("does not extract prefix fragment from composite cyrillic article", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: "Прошу КП на артикул 00БП-015839 - 1 шт."
  });

  assert.ok(result.lead.articles.includes("00BP-015839") || result.lead.articles.includes("00БП-015839"));
  assert.ok(!result.lead.articles.includes("00БП"));
  assert.ok(!result.lead.articles.includes("00BP"));
});

runTest("does not extract certification and electrical spec fragments as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Техническое описание",
    body: `Маркировка: II 2 G Ex db IIC T6 Gb
Степень защиты IP 66
Сертификат PTB 06.0046
Питание 220-254 VAC 50/60HZ
Корпус VA 1.4571
Юр. форма производителя GMBH 2`
  });

  assert.equal(result.lead.articles.length, 0);
});

runTest("does not extract pdf internal metadata and rdf tokens as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Нужен насос AP025 - 1 шт.
www.w3.org/1999/02/22-rdf-syntax-ns
ns.adobe.com/xap/1.0/mm
R/F2
R/F3
CA 1
595.32
841.92
456789:CDEFGHIJSTUVWXYZCDEFGHIJSTUVWXYZ
Type/Font/Subtype/Type0
1/KIDS
D:20250702083531`
  });

  assert.ok(result.lead.articles.includes("AP025"));
  assert.ok(!result.lead.articles.includes("R/F2"));
  assert.ok(!result.lead.articles.includes("R/F3"));
  assert.ok(!result.lead.articles.includes("CA 1"));
  assert.ok(!result.lead.articles.includes("595.32"));
  assert.ok(!result.lead.articles.includes("841.92"));
  assert.ok(!result.lead.articles.includes("456789:CDEFGHIJSTUVWXYZCDEFGHIJSTUVWXYZ"));
  assert.ok(!result.lead.articles.some((item) => /rdf-syntax-ns/i.test(item)));
  assert.ok(!result.lead.articles.some((item) => /ns\.adobe\.com/i.test(item)));
  assert.ok(!result.lead.articles.some((item) => /^d:\d{8,14}$/i.test(item)));
});

runTest("does not extract eof markers pdf sentinels and 5-digit colon gibberish as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Нужен насос AP025 - 1 шт.
EOF 0
65535
56789:CDEFGHIJSTUVWXYZCDEFGHIJSTUVWXYZ`
  });

  assert.ok(result.lead.articles.includes("AP025"));
  assert.ok(!result.lead.articles.includes("EOF 0"));
  assert.ok(!result.lead.articles.includes("65535"));
  assert.ok(!result.lead.articles.includes("56789:CDEFGHIJSTUVWXYZCDEFGHIJSTUVWXYZ"));
});

runTest("does not extract bank account pdf css and type tokens as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Нужен AP025 - 1 шт.
30101810400000000225
30101810145250000411
TYPE0
PDF-1
FONT-SIZE:17PX
C2_0`
  });

  assert.ok(result.lead.articles.includes("AP025"));
  assert.ok(!result.lead.articles.includes("30101810400000000225"));
  assert.ok(!result.lead.articles.includes("30101810145250000411"));
  assert.ok(!result.lead.articles.includes("TYPE0"));
  assert.ok(!result.lead.articles.includes("PDF-1"));
  assert.ok(!result.lead.articles.includes("FONT-SIZE:17PX"));
  assert.ok(!result.lead.articles.includes("C2_0"));
});

runTest("does not extract emails generic css word internals and standards as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Нужен AP025 - 1 шт.
ALLLEX86@SNIPERMAIL.RU
LINE-HEIGHT:165
WW8NUM1Z0
WW8NUM1Z1
IEC61966-2
Type/Font/Subtype/Type0
R/F2`
  });

  assert.ok(result.lead.articles.includes("AP025"));
  assert.ok(!result.lead.articles.includes("ALLLEX86@SNIPERMAIL.RU"));
  assert.ok(!result.lead.articles.includes("LINE-HEIGHT:165"));
  assert.ok(!result.lead.articles.includes("WW8NUM1Z0"));
  assert.ok(!result.lead.articles.includes("WW8NUM1Z1"));
  assert.ok(!result.lead.articles.includes("IEC61966-2"));
  assert.ok(!result.lead.articles.includes("R/F2"));
  assert.ok(!result.lead.articles.some((item) => /TYPE\/FONT/i.test(item)));
});

runTest("does not extract word style tokens like roman v1 and ww labels as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Нужен AP025 - 1 шт.
20ROMAN
V1
WW-ABSATZ-STANDARDSCHRIFTART1`
  });

  assert.ok(result.lead.articles.includes("AP025"));
  assert.ok(!result.lead.articles.includes("20ROMAN"));
  assert.ok(!result.lead.articles.includes("V1"));
  assert.ok(!result.lead.articles.includes("WW-ABSATZ-STANDARDSCHRIFTART1"));
});

runTest("keeps high confidence industrial article patterns", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос на 6ES7-214-1AG40-0XB0",
    body: `Прошу КП на позиции:
1. 6ES7-214-1AG40-0XB0 - 1 шт
2. 3RT2026-1BB40 - 2 шт
3. 2711P-T6C20D - 1 шт
4. 8040/1260-R5A/0-120 - 1 шт
5. 8146/1073-3GRP - 1 шт`
  });

  assert.ok(result.lead.articles.includes("6ES7-214-1AG40-0XB0"));
  assert.ok(result.lead.articles.includes("3RT2026-1BB40"));
  assert.ok(result.lead.articles.includes("2711P-T6C20D"));
  assert.ok(result.lead.articles.includes("8040/1260-R5A/0-120"));
  assert.ok(result.lead.articles.includes("8146/1073-3GRP"));
});

runTest("rejects pure numbers standards and classifier-like dotted codes without strong context", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `1000
25
IEC61966-2.1
46.69.5
2338
2480`
  });

  assert.equal(result.lead.articles.length, 0);
});

runTest("allows long numeric code only with strong article context", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `Артикул: 12345678
part number 87654321
Нужно КП`
  });

  assert.ok(result.lead.articles.includes("12345678"));
  assert.ok(result.lead.articles.includes("87654321"));
});

runTest("enriches articles from nomenclature dictionary when name is missing in email", () => {
  detectionKb.importNomenclatureCatalog([
    {
      "ID сделки": 910001,
      "Бренд": "Acme Controls",
      "Артикул": "RAG-EMAIL-01",
      "Наименование": "Датчик давления",
      "Описание": "Pressure transmitter 4-20mA",
      "Кол-во": 2,
      "Цена продажи 1 шт.": 210.5
    }
  ], { sourceFile: "email-test-fixture" });

  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос по RAG-EMAIL-01",
    body: "Добрый день. Прошу выставить счет на RAG-EMAIL-01 - 2 шт."
  });

  assert.ok(result.detectedBrands.includes("Acme Controls"));
  assert.ok(result.lead.productNames.some((item) => item.article === "RAG-EMAIL-01" && item.name === "Датчик давления"));
  assert.ok(result.lead.nomenclatureMatches.some((item) => item.article === "RAG-EMAIL-01"));
});

runTest("prioritizes managers by article owner before brand owner", () => {
  detectionKb.importNomenclatureCatalog([
    {
      "ID сделки": 910002,
      "Бренд": "ABB",
      "Артикул": "VIP-ABB-01",
      "Наименование": "Спецпривод",
      "Описание": "ABB drive",
      "Кол-во": 1,
      "Цена продажи 1 шт.": 500
    }
  ], { sourceFile: "manager-priority-fixture" });

  const projectWithArticleOwners = {
    ...project,
    managerPool: {
      ...project.managerPool,
      articleOwners: [
        { article: "VIP-ABB-01", mop: "Спец МOP", moz: "Спец MOZ" }
      ]
    }
  };

  const result = analyzeEmail(projectWithArticleOwners, {
    fromEmail: "buyer@unknown.ru",
    subject: "Запрос на VIP-ABB-01",
    body: "Прошу КП на VIP-ABB-01 - 1 шт"
  });

  assert.equal(result.crm.curatorMop, "Спец МOP");
  assert.equal(result.crm.curatorMoz, "Спец MOZ");
});

runTest("matches CRM company by historical nomenclature when legal data absent", () => {
  detectionKb.importNomenclatureCatalog([
    {
      "ID сделки": 910003,
      "Бренд": "Acme Controls",
      "Артикул": "HIST-MATCH-77",
      "Наименование": "Контроллер",
      "Описание": "PLC controller",
      "Кол-во": 2,
      "Цена продажи 1 шт.": 990
    }
  ], { sourceFile: "crm-history-fixture" });

  const projectWithHistory = {
    ...project,
    knownCompanies: [
      ...project.knownCompanies,
      {
        id: "client-history-1",
        legalName: "ООО Исторический клиент",
        domain: "history-client.ru",
        curatorMop: "Исторический МOP",
        curatorMoz: "Исторический MOZ",
        brands: ["Acme Controls"],
        articleHistory: ["HIST-MATCH-77"],
        contacts: []
      }
    ]
  };

  const result = analyzeEmail(projectWithHistory, {
    fromEmail: "buyer@gmail.com",
    subject: "Нужен HIST-MATCH-77",
    body: "Добрый день. Прошу выставить счет на HIST-MATCH-77 - 2 шт."
  });

  assert.equal(result.crm.isExistingCompany, true);
  assert.equal(result.crm.company?.id, "client-history-1");
  assert.equal(result.crm.matchMethod, "nomenclature_history");
  assert.ok(result.crm.matchConfidence >= 0.3);
});

runTest("does not extract generic camera image filename as article", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Фото шильдика",
    attachments: "IMG_20260310_144651.jpg, photo_12345.png",
    body: "Добрый день. Направляю фотографии."
  });

  assert.ok(!result.lead.articles.includes("IMG-20260310-144651"));
  assert.equal(result.lead.articles.length, 0);
});

runTest("does not detect noisy short alias TOP as brand", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Re: Запрос",
    body: "Подтверждаю, спасибо. top level discussion without brand context."
  });

  assert.ok(!result.detectedBrands.includes("TOP"));
});

runTest("does not detect PULS brand from Vegapuls compound product name", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос_Уровнемер радарный Vegapuls 31",
    body: "Прошу выставить КП на уровнемер VEGAPULS 31 — 1 шт."
  });

  assert.ok(!result.detectedBrands.some((b) => b.toUpperCase() === "PULS"), `PULS should not be detected from Vegapuls, got: ${result.detectedBrands}`);
});

runTest("does not detect Indu-Sol brand from word industrial (alias fix)", () => {
  // The brand alias "Indu" was causing false positives — "indu" inside "industrial"
  // This test verifies the alias-based detection is fixed (nomenclature FTS may still match other brands)
  const result = analyzeEmail(project, {
    fromEmail: "tony@company.com",
    subject: "industrial valves from tony",
    body: "We supply industrial valves and process equipment. Please send your price list."
  });

  assert.ok(!result.detectedBrands.some((b) => b === "Indu-Sol"), `Indu-Sol should not be detected from 'industrial', got: ${result.detectedBrands}`);
});

runTest("detects PULS brand when mentioned standalone", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос блоков питания PULS",
    body: "Нужен блок питания PULS 24V 20A, арт. QS20.241 — 3 шт."
  });

  assert.ok(result.detectedBrands.some((b) => b.toUpperCase() === "PULS"), `PULS should be detected when standalone, got: ${result.detectedBrands}`);
});

runTest("parses vertical article-unit-quantity blocks without taking qty from article tail", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@it-mo.ru",
    subject: "Заявка",
    body: `соединение RIX
ESX20S-9534Y
Арт.: H0019-0008-28
шт.
3
Узел
гидравлического
зажима
Арт.: 95.101.808.2.2
шт.
1
Встроенная
зажимная головка
Арт.: 9510451992
шт.
1
Ротационное
соединение. Rotary
joint
Арт.: 1114-160-318
шт.
1

ООО «ИТ-МО» ИНН7702802784

С Уважением
Артем Алексеевич`
  });

  assert.ok(result.lead.lineItems.some((item) => item.article === "H0019-0008-28" && item.quantity === 3));
  assert.ok(result.lead.lineItems.some((item) => item.article === "95.101.808.2.2" && item.quantity === 1));
  assert.ok(result.lead.lineItems.some((item) => item.article === "9510451992" && item.quantity === 1));
  assert.ok(result.lead.lineItems.some((item) => item.article === "1114-160-318" && item.quantity === 1));
  assert.ok(!result.lead.lineItems.some((item) => item.quantity === 9534));
});

// ═══ Urgency detection tests ═══

runTest("extractLead detects urgent requests", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "СРОЧНО! Нужны запчасти",
    body: "Стоит линия, срочно нужен клапан Festo"
  });
  assert.strictEqual(result.lead.urgency, "urgent");
});

runTest("extractLead detects planned requests", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Плановая заявка",
    body: "Планируем закупку на следующий квартал"
  });
  assert.strictEqual(result.lead.urgency, "planned");
});

runTest("extractLead defaults to normal urgency", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос КП",
    body: "Прошу выставить счёт на датчик PMC51"
  });
  assert.strictEqual(result.lead.urgency, "normal");
});

runTest("applies sender profile hints to company and brands on future emails", () => {
  const senderEmail = "repeat-buyer@test-feedback.ru";
  const profile = detectionKb.upsertSenderProfile({
    senderEmail,
    senderDomain: "test-feedback.ru",
    classification: "client",
    companyHint: "ООО Повторный клиент",
    brandHint: "ABB, Siemens",
    notes: "email-analyzer-test"
  });

  try {
    const result = analyzeEmail(project, {
      fromEmail: senderEmail,
      subject: "Нужен счёт",
      body: "Добрый день. Прошу подготовить КП без явного бренда в тексте."
    });

    assert.equal(result.sender.companyName, "ООО Повторный клиент");
    assert.ok(result.detectedBrands.includes("ABB"));
    assert.ok(result.detectedBrands.includes("Siemens"));
  } finally {
    if (profile?.id) detectionKb.deactivateSenderProfile(profile.id);
  }
});

runTest("builds recognition diagnostics with high confidence for well-structured request", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    fromName: "Иван Петров",
    subject: "Запрос по S201-C16",
    body: `Добрый день
ООО "Ромашка" ИНН 7701234567
Телефон: +7 (495) 123-45-67
Просим выставить счет на ABB S201-C16 - 5 шт`
  });

  assert.equal(result.lead.recognitionDiagnostics.riskLevel, "low");
  assert.ok(result.lead.recognitionDiagnostics.completenessScore >= 80);
  assert.ok(result.lead.recognitionDiagnostics.fields.article.confidence >= 0.8);
  assert.equal(result.lead.recognitionSummary.hasConflicts, false);
  assert.equal(result.lead.recognitionDecision.priority, "medium");
  assert.match(result.lead.recognitionDecision.decisionReason, /класс:Клиент/i);
});

runTest("detects conflicting quantities and names for same article", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    subject: "Спецификация",
    body: `1. Клапан KV-100 - 2 шт
2. Клапан специальный KV-100 - 4 шт`
  });

  const conflicts = result.lead.recognitionDiagnostics.conflicts || [];
  assert.ok(conflicts.some((item) => item.code === "article_quantity_conflict" && item.article === "KV-100"));
  assert.ok(conflicts.some((item) => item.code === "article_name_conflict" && item.article === "KV-100"));
  assert.equal(result.lead.recognitionDiagnostics.riskLevel, "high");
  assert.equal(result.lead.recognitionSummary.hasConflicts, true);
});

// ── Auto-reply detection tests ──

runTest("detects auto-reply by subject and ignores brands from embedded original request", () => {
  const result = analyzeEmail(project, {
    fromEmail: "noreply@helpdesk.factory.ru",
    subject: "Ваша заявка принята и зарегистрирована №12345",
    body: `Уважаемый клиент!

Ваша заявка №12345 принята в обработку. Ожидайте ответа специалиста в течение 24 часов.

Не отвечайте на это письмо.

--- Текст вашего обращения ---
Добрый день! Прошу предоставить КП на:
1. Датчик давления Endress+Hauser Cerabar PMP51 - 3 шт
2. Клапан Bürkert 2000-A-13.0 - 2 шт
Артикул: PMP51-AA21JA1PGCGXJA1+AK

С уважением,
Иванов Петр`
  });

  assert.equal(result.extractionMeta.autoReplyDetected, true);
  assert.equal(result.classification.label, "СПАМ");
  assert.ok(result.classification.signals.autoReply);
  // Brands from the embedded original request should NOT be detected
  const brands = result.detectedBrands || [];
  assert.ok(!brands.some((b) => /endress/i.test(b)), `Should not detect Endress+Hauser from embedded request, got: ${brands}`);
  assert.ok(!brands.some((b) => /b[uü]rkert/i.test(b)), `Should not detect Bürkert from embedded request, got: ${brands}`);
  // Articles from the embedded original should NOT be detected
  const articles = result.lead.articles || [];
  assert.ok(!articles.some((a) => /PMP51/i.test(a)), `Should not detect PMP51 from embedded request, got: ${articles}`);
});

runTest("detects auto-reply from noreply sender with ticket number", () => {
  const result = analyzeEmail(project, {
    fromEmail: "noreply@crm.partner.com",
    subject: "Re: Запрос на ABB ACS580",
    body: `Заявка #8801 создана.

Ваше обращение зарегистрировано. Менеджер свяжется с вами.

-----Original Message-----
Прошу коммерческое предложение на ABB ACS580-01-09A5-4 - 1шт
Schneider Electric LC1D09M7 - 5 шт`
  });

  assert.equal(result.extractionMeta.autoReplyDetected, true);
  assert.equal(result.classification.label, "СПАМ");
  const articles = result.lead.articles || [];
  assert.ok(!articles.some((a) => /ACS580/i.test(a)), `Should not detect ACS580 from quoted original, got: ${articles}`);
  assert.ok(!articles.some((a) => /LC1D09M7/i.test(a)), `Should not detect LC1D09M7 from quoted original, got: ${articles}`);
});

runTest("detects body-pattern auto-reply with embedded request copy", () => {
  const result = analyzeEmail(project, {
    fromEmail: "support@vendor.com",
    subject: "Re: Запрос КП на Phoenix Contact",
    body: `Это автоматически сгенерированное письмо.

Ваша заявка получена и передана менеджеру.

Копия вашего обращения:
Добрый день! Интересует Phoenix Contact QUINT-PS/1AC/24DC/10 - 2 шт
Арт: 2866763`
  });

  assert.equal(result.extractionMeta.autoReplyDetected, true);
  assert.equal(result.classification.label, "СПАМ");
  const articles = result.lead.articles || [];
  assert.ok(!articles.includes("2866763"), `Should not detect 2866763 from embedded copy, got: ${articles}`);
});

runTest("does NOT flag real client email as auto-reply", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    subject: "Запрос на Endress+Hauser Cerabar",
    body: `Добрый день!

Прошу предоставить КП на датчик давления Endress+Hauser Cerabar PMP51 - 3 шт.
Артикул: PMP51-AA21JA1PGCGXJA1+AK

С уважением,
Иванов Петр
ООО "Завод Металлист"
Тел: +7 (495) 123-45-67`
  });

  assert.equal(result.extractionMeta.autoReplyDetected, false);
  assert.notEqual(result.classification.label, "СПАМ");
  const articles = result.lead.articles || [];
  assert.ok(articles.length > 0, "Should detect articles from real client email");
});

runTest("extracts articles from pipe-delimited table", () => {
  const result = analyzeEmail(project, {
    fromEmail: "purch@oil.ru",
    subject: "Запрос",
    body: `Позиция | Артикул | Количество
1 | 6EP1334-3BA10 | 2
2 | 6EP1332-2BA20 | 4
3 | 6EP1961-2BA00 | 1`
  });

  assert.ok(result.lead.articles.includes("6EP1334-3BA10"));
  assert.ok(result.lead.articles.includes("6EP1332-2BA20"));
  assert.ok(result.lead.articles.includes("6EP1961-2BA00"));
  assert.ok(result.lead.lineItems.length >= 3, `Expected 3+ lineItems, got ${result.lead.lineItems.length}`);
});

runTest("does not treat G1/2, DN15, PN16 pipe specs as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    subject: "Заказ клапанов",
    body: `Клапан Bürkert 6213 A 13.0 NBR MS G1/2 - 3 шт
Клапан DN50 PN16 фланцевый - 2 шт`
  });

  const articles = result.lead.articles;
  assert.ok(!articles.includes("G1/2"), `G1/2 should not be an article, got: ${articles}`);
  assert.ok(!articles.some((a) => /^DN\d+$/i.test(a)), `DN spec should not be an article, got: ${articles}`);
  assert.ok(!articles.some((a) => /^PN\d+$/i.test(a)), `PN spec should not be an article, got: ${articles}`);
  assert.ok(articles.includes("6213"), `Should detect 6213 as brand-adjacent article`);
});

runTest("rejects remaining dashboard numeric and classifier noise", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: `1000
25
IEC61966-2.1
2338
2480
2025
1015
1653
46.69.5
3507
2340`
  });

  assert.equal(result.lead.articles.length, 0, `Expected no articles, got: ${result.lead.articles}`);
});

runTest("rejects PDF binary residue, year numbers, and JPEG DCT markers as articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@factory.ru",
    subject: "Запрос на поставку",
    body: `Добрый день!
456789:CDEFGHIJSTUVWXYZ
IEC61966-2.1
2025 2026 2024 2023
1000 2480 2338 1653 1015 595 842
endobj stream xref
12 0 obj
Прошу предоставить КП на ABB ACS580-01-02A6-4 — 2 шт`
  });

  // Real article should be detected
  assert.ok(result.lead.articles.includes("ACS580-01-02A6-4"), `Expected ACS580-01-02A6-4, got: ${result.lead.articles}`);
  // False positives should be rejected
  const falsePositives = ["456789", "IEC61966-2.1", "IEC61966", "2025", "2026", "1000", "2480", "2338", "1653", "1015", "595", "842"];
  for (const fp of falsePositives) {
    assert.ok(!result.lead.articles.includes(fp), `${fp} should not be detected as article, got: ${result.lead.articles}`);
  }
});

runTest("extracts article from lowercase brand plus numeric code product line", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@lemz-lg.ru",
    subject: "Запрос",
    body: `Подскажите, у вас есть возможность поставки данных позиций?
- Клапан электромагнитный jaksa 340442 (24V DC)`
  });

  assert.ok(result.lead.articles.includes("340442"), `Expected 340442, got: ${result.lead.articles}`);
  assert.ok(!result.lead.articles.includes("24V"), `24V should not be article`);
});

runTest("extracts article when article appears before brand marker phrase", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@instrum-rand.pro",
    subject: "Запрос",
    body: "Мы ищем поставщика пневмоштуцера RBE 03.6904 фирмы Staubli в кол-ве 50 шт."
  });

  assert.ok(result.lead.articles.includes("RBE 03.6904"), `Expected RBE 03.6904, got: ${result.lead.articles}`);
});

runTest("extracts mixed-case segmented code after multiword brand", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@vector.ru",
    subject: "Запрос",
    body: "Прошу сообщить о возможности поставки барабан кабельный Hartmann und König мLT220/151"
  });

  assert.ok(
    result.lead.articles.includes("мLT220/151")
      || result.lead.articles.includes("mLT220/151")
      || result.lead.articles.includes("MLT220/151"),
    `Expected mLT220/151, got: ${result.lead.articles}`
  );
});

runTest("extracts alphanumeric article and ignores id suffix in parentheses", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@company.ru",
    subject: "Запрос",
    body: "Клапан HAWE NSMD2D/M/G4PK-G24 (id3619179)"
  });

  assert.ok(result.lead.articles.includes("NSMD2D/M/G4PK-G24"), `Expected NSMD2D/M/G4PK-G24, got: ${result.lead.articles}`);
  assert.ok(!result.lead.articles.includes("3619179"), `id3619179 should not be article, got: ${result.lead.articles}`);
});

runTest("extracts brand-adjacent alphanumeric codes like Danfoss 032U1240", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@test.ru",
    subject: "Запрос",
    body: "Нужны клапаны Danfoss 032U1240 DN15 - 5 шт",
    brands: ["Danfoss"]
  });

  assert.ok(result.lead.articles.includes("032U1240"), `Should detect 032U1240, got: ${result.lead.articles}`);
  assert.ok(!result.lead.articles.some((a) => /^DN\d+$/i.test(a)), "DN15 should not be article");
});

runTest("extracts line items with brand-adjacent codes and correct quantities", () => {
  const result = analyzeEmail(project, {
    fromEmail: "buyer@chem.ru",
    subject: "Заказ",
    body: "Клапан Bürkert 6213 A 13.0 NBR MS G1/2 - 3 шт\nКлапан Bürkert 0330 A 4.0 NBR MS - 2 шт"
  });

  assert.equal(result.lead.lineItems.length, 2, `Expected 2 lineItems, got ${result.lead.lineItems.length}`);
  const item1 = result.lead.lineItems.find((li) => li.article === "6213");
  const item2 = result.lead.lineItems.find((li) => li.article === "0330");
  assert.ok(item1, "Should have lineItem for 6213");
  assert.ok(item2, "Should have lineItem for 0330");
  assert.equal(item1.quantity, 3);
  assert.equal(item2.quantity, 2);
});

runTest("treats forwarded email as primary body when no new content", () => {
  const result = analyzeEmail({ ...project, brands: ["Danfoss"] }, {
    fromEmail: "mgr@build.ru",
    subject: "Fwd: Заявка на клапаны",
    body: `---------- Пересланное сообщение ----------
От: Петров <petrov@plant.ru>
Тема: Клапаны

Нужны клапаны Danfoss 032U1240 DN15 - 5 шт`
  });

  assert.ok(result.lead.articles.includes("032U1240"), `Should detect 032U1240 from forwarded body, got: ${result.lead.articles}`);
  assert.ok(result.detectedBrands.some((b) => /danfoss/i.test(b)), "Should detect Danfoss");
  assert.equal(result.classification.label, "Клиент");
});

runTest("detects out-of-office auto-reply", () => {
  const result = analyzeEmail(project, {
    fromEmail: "manager@partner.com",
    subject: "Вне офиса: Re: Запрос на Schneider Electric",
    body: `Буду отсутствовать до 28.03. По срочным вопросам обращайтесь к Петрову А.В. (petrov@partner.com).

> Добрый день! Прошу КП на Schneider Electric ATV320U06M2C - 5 шт
> Артикул ATV320U06M2C`
  });

  assert.equal(result.extractionMeta.autoReplyDetected, true);
  assert.equal(result.classification.label, "СПАМ");
  const articles = result.lead.articles || [];
  assert.ok(!articles.some((a) => /ATV320/i.test(a)), `Should not detect ATV320 from quoted text in OOO reply, got: ${articles}`);
});

runTest("extracts name from Latin Best regards signature", () => {
  const result = analyzeEmail(project, {
    fromEmail: "info@company.com",
    subject: "Request for quote",
    body: "Hello, please provide pricing for ABB ACS355.\n\nBest regards,\nJohn Smith"
  });
  assert.equal(result.sender.fullName, "John Smith");
});

runTest("extracts name from structured signature block with context", () => {
  const result = analyzeEmail(project, {
    fromEmail: "info@partner.ru",
    subject: "Запрос",
    body: `Добрый день, нужен счёт на Siemens S7-300.

Иван Петров
Менеджер по закупкам
+7 (495) 123-45-67`
  });
  assert.equal(result.sender.fullName, "Иван Петров");
});

runTest("infers name from email local part when no signature", () => {
  const result = analyzeEmail(project, {
    fromEmail: "anton.smirnov@factory.ru",
    subject: "Запрос КП",
    body: "Прошу выставить счёт на датчик PMC51."
  });
  assert.equal(result.sender.fullName, "Anton Smirnov");
});

runTest("does not infer name from generic info@ mailbox", () => {
  const result = analyzeEmail(project, {
    fromEmail: "info@factory.ru",
    subject: "Запрос",
    body: "Прошу КП на оборудование."
  });
  assert.equal(result.sender.fullName, "Не определено");
});

runTest("uses quoted sender signature for company and phone and keeps full numbered articles", () => {
  const result = analyzeEmail(project, {
    fromEmail: "artur@oilgis.ru",
    subject: "Re: Запрос",
    body: `Клапана:
1) WK06Y-01-C-N-0
2) WK06J-01-C-N-0

Электрические катушки для управления гидравлическими распределителями (solenoid coils):
1) Coil 230DG-32-1329

Насос:
1) Bieri AKP20-0,012-300-V
2) Bieri AKP30-0,012-300-V

----------------

Кому: info@siderus.ru (info@siderus.ru);

Тема: Запрос;

09.04.2026, 09:20, "artur@oilgis.ru" <artur@oilgis.ru>:

Добрый день
Интересует поставка следующего оборудования:
1. Насос гидравлический Bieri AKP20 и AKP30 (2 шт любого, приоритет на АКР20)
2. Электрогидравлический клапан Hydac WK06Y и WK06J. (по 10шт каждого)
интересует возможность поставки, цена сроки

--
Алик Шарифгалиев М.
ООО ОйлГИС
8 903 351 9285

Наше предприятие работает в ЭДО Диадок ( со СБИС не работаем )
Идентификатор 2BM-0278106553-2012052808163395382630000000000
Ожидаем приглашения на обмен`
  });

  assert.equal(result.sender.companyName, "ООО ОйлГИС");
  assert.equal(result.sender.mobilePhone, "+7 (903) 351-92-85");
  assert.ok(result.lead.articles.includes("WK06Y-01-C-N-0"));
  assert.ok(result.lead.articles.includes("WK06J-01-C-N-0"));
  assert.ok(result.lead.articles.includes("230DG-32-1329"));
  assert.ok(result.lead.articles.includes("AKP20-0,012-300-V"));
  assert.ok(result.lead.articles.includes("AKP30-0,012-300-V"));
  assert.ok(!result.lead.articles.includes("AKP20-0"));
  assert.ok(!result.lead.articles.includes("AKP30-0"));
  assert.ok(!result.lead.articles.includes("012-300-V"));
  assert.ok(!result.lead.lineItems.some((item) => item.article === "WK06Y-01-C-N"));
  assert.ok(!result.lead.lineItems.some((item) => item.article === "WK06J-01-C-N"));
  assert.ok(!result.lead.lineItems.some((item) => item.article === "DG-32"));
  assert.ok(!result.lead.lineItems.some((item) => item.article === "230DG-32"));
  assert.ok(!/solenoid co/i.test(result.sender.companyName || ""));
});

runTest("extracts article from quoted tabular reply row without false brand enrichment", () => {
  const result = analyzeEmail(project, {
    fromEmail: "m14@interprom24.ru",
    fromName: "Роман Нестеров",
    subject: "Re: запрос 1174943",
    body: `Добрый день!

Подскажите, когда ожидать ответ по запросу?

----------------
To: info@siderus.ru (info@siderus.ru);
Subject: запрос 1174943;
09.04.2026, 11:03, "Роман Нестеров" <m14@interprom24.ru>:
Добрый день!
Подскажите, пожалуйста, по наличию и стоимости
нужна минимальная цена

№ Наименование Кол-во Ед.изм.
1 Уплотнение масляное 122571 NBR G 60х75х8 10`
  });

  assert.ok(result.lead.articles.includes("122571"));
  assert.ok(result.lead.lineItems.some((item) => item.article === "122571" && item.quantity === 10));
  assert.ok(result.lead.productNames.some((item) => item.article === "122571" && /Уплотнение масляное/i.test(item.name || "")));
  assert.ok(!(result.classification.detectedBrands || []).includes("Kromschroeder"));
  assert.ok(!(result.lead.detectedBrands || []).includes("Kromschroeder"));
  assert.ok(!result.lead.lineItems.some((item) => /^DESC:/i.test(item.article || "") && /минимальная цена/i.test(item.descriptionRu || "")));
});

runTest("extracts quoted robot form request without tracking site or generic control brand noise", () => {
  const result = analyzeEmail(project, {
    fromEmail: "gurevaa18@mail.ru",
    fromName: "Алиса Гурьева",
    subject: "Re: FW: Вопрос через обратную связь с сайта SIDERUS",
    body: `--
Алиса Гурьева
Отправлено из Почты Mail ( https://trk.mail.ru/c/zzm979 )

>
> Четверг, 9 апреля 2026, 17:30 +03:00 от SIDERUS :
>
> Добрый день!
>
> Для обработки запроса, нужны реквизиты компании.
>
> *From:* robot@siderus.ru
> *Sent:* Thursday, April 9, 2026 11:38 AM
> *To:* info@siderus.ru
> *Subject:* Вопрос через обратную связь с сайта SIDERUS
>
> Новый вопрос на сайте SIDERUS (8391)
> Имя посетителя: Алиса
> Телефон:+7 917 908-14-54
> Email: gurevaa18@mail.ru
> Вопрос:Добрый день. Прошу указать цену и срок поставки. Спасибо!
> Модуль управления MV2067512015 IGEL - 2шт
> Тип: CMOD (ISA-HD Control Module) MVSTMB-GN271210
>
> Страница отправки: https://siderus.ru/orders/processed/mv2067512015-silovoy-modul-plavnogo-puska-igel-electric-isa-hd-400-10000-230-230-i-rab-temp-5-55os-s/?ysclid=mnr7xi98od792868556`
  });

  assert.equal(result.classification.label, "Клиент");
  assert.equal(result.sender.mobilePhone, "+7 (917) 908-14-54");
  assert.equal(result.sender.website, null);
  assert.ok(result.lead.articles.includes("MV2067512015"));
  assert.ok(result.lead.articles.includes("MVSTMB-GN271210"));
  assert.ok(!result.lead.articles.includes("400-10000-230-230-i-rab-temp-5-55os-s"));
  assert.ok((result.lead.detectedBrands || []).includes("IGEL Electric"));
  assert.ok(!(result.lead.detectedBrands || []).includes("Control Techniques"));
});

runTest("ЭДО-идентификатор Диадок не попадает в артикулы", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "artur@oilgis.ru",
    fromName: "",
    body: `Добрый день
Интересует поставка:
1. Насос Bieri AKP20-0,012-300-V

Алик Шарифгалиев М.
ООО ОйлГИС
8 903 351 9285

Наше предприятие работает в ЭДО Диадок
Идентификатор 2BM-0278106553-2012052808163395382630000000000
Ожидаем приглашения на обмен`,
    attachments: []
  });
  const articles = result.lead?.articles || [];
  const edoInArticles = articles.some(a => /^2BM-/i.test(a));
  assert.equal(edoInArticles, false, `ЭДО-идентификатор не должен быть артикулом, найдено: ${articles.join(", ")}`);
});

runTest("Форма не перезаписывает полное display name (Алиса Гурьева → Алиса)", () => {
  // Симулируем ответ на форму: fromName из заголовка — полное имя,
  // но цитированная форма содержит только имя
  const result = analyzeEmail(project, {
    subject: "Re: FW: Вопрос через обратную связь с сайта SIDERUS",
    fromEmail: "gurevaa18@mail.ru",
    fromName: "Алиса Гурьева",
    body: `-\nАлиса Гурьева\nОтправлено из Почты Mail\n\n> Четверг, 9 апреля 2026, 17:30 +03:00 от SIDERUS:\n>\n> -----Original Message-----\n> From: robot@siderus.ru\n> Subject: Вопрос через обратную связь с сайта SIDERUS\n>\n> Новый вопрос на сайте SIDERUS (8391)\n> Имя посетителя: Алиса\n> Телефон:+7 917 908-14-54\n> Email: gurevaa18@mail.ru\n> Вопрос: Прошу указать цену\n> Модуль управления MV2067512015 IGEL - 2шт`,
    attachments: []
  });
  assert.equal(result.sender?.fullName, "Алиса Гурьева", `Ожидали "Алиса Гурьева", получили "${result.sender?.fullName}"`);
});

runTest("Org-unit display name не используется как ФИО — находим Бастрыкову Марию", async () => {
  // Тест намеренно использует подпись с телефоном-соседом (не зависит от Task 4),
  // чтобы убедиться что isOrgUnitName работает независимо
  const result = analyzeEmail(project, {
    subject: "Запрос коммерческого предложения",
    fromEmail: "sfkzc@ntiim.ru",
    fromName: "филиал «НТИИМ»",
    body: `Доброе утро!\nПросьба выставить коммерческое предложение на поставку:\n1. Считывающей головки RA26BTA104B50F - 2 шт.\n\n--\nБастрыкова Мария\n+7(3435)47-51-24\nФилиал «НТИИМ» ФКП«НИО«ГБИП России»\nНижний Тагил, ул. Гагарина, д. 29\nИНН 5023002050`,
    attachments: []
  });
  assert.equal(
    result.sender?.fullName, "Бастрыкова Мария",
    `Ожидали "Бастрыкова Мария", получили "${result.sender?.fullName}"`
  );
});

runTest("ФИО: Имя Фамилия И. из подписи без приветствия (oilgis)", () => {
  const result = analyzeEmail(project, {
    subject: "Re: Запрос",
    fromEmail: "artur@oilgis.ru",
    fromName: "",
    body: `Добрый день\nИнтересует поставка:\n1. Насос Bieri AKP20-0,012-300-V\n\n--\nАлик Шарифгалиев М.\nООО ОйлГИС\n8 903 351 9285`,
    attachments: []
  });
  assert.equal(
    result.sender?.fullName, "Алик Шарифгалиев М.",
    `Ожидали "Алик Шарифгалиев М.", получили "${result.sender?.fullName}"`
  );
});

runTest("ФИО: С уважением + строка должности + имя (ntiim)", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "test@example.ru",
    fromName: "",
    body: `Прошу выставить КП на поставку деталей.\n\nС уважением,\nначальник отдела закупок\nИванов Сергей\n+7 912 345-67-89`,
    attachments: []
  });
  assert.equal(
    result.sender?.fullName, "Иванов Сергей",
    `Ожидали "Иванов Сергей", получили "${result.sender?.fullName}"`
  );
});

runTest("Должность: начальник СФКЗЦ извлекается из подписи", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос КП",
    fromEmail: "sfkzc@ntiim.ru",
    fromName: "",
    body: `Просьба выставить КП на поставку:\n1. Считывающая головка RA26BTA104B50F - 2 шт.\n\n--\nС уважением,\nначальник СФКЗЦ\nБастрыкова Мария\n+7(3435)47-51-24\nИНН 5023002050`,
    attachments: []
  });
  assert.ok(
    result.sender?.position,
    `Должность не должна быть пустой, получили: "${result.sender?.position}"`
  );
  assert.match(
    result.sender?.position,
    /начальник/i,
    `Должность должна содержать "начальник", получили: "${result.sender?.position}"`
  );
});

runTest("Фильтр: телефон siderus не попадает в sender из Re: письма", () => {
  const result = analyzeEmail(project, {
    subject: "Re: Запрос",
    fromEmail: "client@somecompany.ru",
    fromName: "Иван Петров",
    body: `Добрый день, спасибо за ответ!\n\nС уважением,\nИван Петров\n+7 (916) 123-45-67\n\n> От: Менеджер Сайдерус <manager@siderus.ru>\n> Тел: +7 (499) 647-47-07\n> 8 (800) 777-47-07`,
    attachments: []
  });
  assert.ok(
    result.sender?.mobilePhone !== "+7 (499) 647-47-07",
    `Телефон siderus не должен быть в sender, получили: ${result.sender?.mobilePhone}`
  );
  assert.ok(
    result.sender?.cityPhone !== "+7 (800) 777-47-07",
    `Телефон 800 не должен быть в sender, получили: ${result.sender?.cityPhone}`
  );
});

runTest("Фильтр: ИНН коловрата не попадает в sender", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "buyer@factory.ru",
    fromName: "Покупатель",
    body: `Прошу выставить КП.\n\nООО Коловрат\nИНН 9701077015\nКПП 773101001\nОГРН 1177746518740`,
    attachments: []
  });
  assert.equal(result.sender?.inn, null, `ИНН коловрата не должен быть в sender, получили: ${result.sender?.inn}`);
  assert.ok(
    !/коловрат/i.test(result.sender?.companyName || ""),
    `Название коловрата не должно быть в companyName, получили: ${result.sender?.companyName}`
  );
});

// --- Task 3: deduplicateByAbsorption ---

runTest("Дедуп: усечённый 99L-0159-0409 не должен быть если есть A99L-0159-0409", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "buyer@factory.ru",
    fromName: "",
    body: "Прошу выставить КП:\nФильтроэлемент гидравлический А99L-0159-0409#SSET Novotec Ultra-Clean — 30 шт.",
    attachments: []
  });
  const articles = result.lead?.articles || [];
  const hasTruncated = articles.some((a) => a === "99L-0159-0409");
  const hasFull = articles.some((a) => /A99L-0159-0409/i.test(a));
  assert.ok(!hasTruncated, `Усечённый артикул 99L-0159-0409 не должен присутствовать, articles: ${articles}`);
  assert.ok(hasFull, `Полный A99L-0159-0409 должен быть, articles: ${articles}`);
});

runTest("Дедуп: Ultra-Clean не является артикулом (CamelWord-CamelWord без цифр)", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "buyer@factory.ru",
    fromName: "",
    body: "Фильтроэлемент А99L-0159-0409 Novotec Ultra-Clean — 30 шт.",
    attachments: []
  });
  const articles = result.lead?.articles || [];
  assert.ok(
    !articles.some((a) => /^Ultra-Clean$/i.test(a)),
    `Ultra-Clean не должен быть артикулом, articles: ${articles}`
  );
});

runTest("Дедуп lineItems: одна физическая позиция не дублируется", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "buyer@factory.ru",
    fromName: "",
    body: "Запрашиваю:\nФильтроэлемент А99L-0159-0409 Novotec Ultra-Clean — 30 шт.",
    attachments: []
  });
  const items = result.lead?.lineItems || [];
  const a99Items = items.filter((i) => /A99L-0159-0409/i.test(i.article || ""));
  assert.ok(a99Items.length <= 1, `Должна быть одна позиция A99L-0159-0409, получили ${a99Items.length}: ${JSON.stringify(a99Items)}`);
});

// --- Task 4: Должности расширенные паттерны ---

runTest("Должность: юрист перед именем извлекается", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "oksana@law-firm.ru",
    fromName: "",
    body: "Прошу выставить КП.\n\nС уважением,\nюрист\nКаратун Оксана Юрьевна\n8 (3462) 33-04-05",
    attachments: []
  });
  assert.ok(
    /юрист/i.test(result.sender?.position || ""),
    `Должность юрист не извлечена, получили: "${result.sender?.position}"`
  );
});

runTest("Должность: Менеджер отдела продаж — полная, не обрезанная", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос",
    fromEmail: "irina@kolvrat.ru",
    fromName: "",
    body: "Прошу КП.\n\nС уважением,\nТарасова Ирина\nМенеджер отдела продаж\nООО КОЛОВРАТ",
    attachments: []
  });
  assert.ok(
    /Менеджер отдела продаж/i.test(result.sender?.position || ""),
    `Должность должна быть полной "Менеджер отдела продаж", получили: "${result.sender?.position}"`
  );
});

runTest("Должность: Procurement manager of ITER PPTF Project — латинская многословная", () => {
  const result = analyzeEmail(project, {
    subject: "Request",
    fromEmail: "a.zimmermann@gkmp32.com",
    fromName: "Anna Zimmermann",
    body: "Dear team,\n\nPlease quote for our project.\n\nAnna Zimmermann\n\nProcurement manager of ITER PPTF Project\nLLC\n\ntel. +7 (495) 150-14-50",
    attachments: []
  });
  assert.ok(
    /Procurement manager/i.test(result.sender?.position || ""),
    `Должность Procurement manager не извлечена, получили: "${result.sender?.position}"`
  );
});

// --- Task 5: Форм-заявка полное название товара ---

runTest("Форм-заявка: полное название товара AT 051 DA F04 N 11 DS Пневмопривод", () => {
  const result = analyzeEmail(project, {
    subject: "Заполнена форма \"Товар под заказ\" на сайте SIDERUS (8413)",
    fromEmail: "robot@siderus.ru",
    fromName: "",
    body: `Заполнена форма "Товар под заказ" на сайте SIDERUS (8413)
Имя посетителя: ООО"РЕЦЕПС" Николай
Телефон:
Email: recepson@mail.ru
WhatsApp:
Название товара: AT 051 DA F04 N 11 DS Пневмопривод
Ссылка на товар: https://siderus.ru/orders/processed/at-051-da-f04-n-11-ds-pnevmoprivod/
ID товара: 1056655
Название организации:
ИНН:
Сообщение:
Страница отправки: https://siderus.ru/orders/processed/at-051-da-f04-n-11-ds-pnevmoprivod/
Запрос отправлен: 13.04.2026 12:52:24`,
    attachments: []
  });
  const items = result.lead?.lineItems || [];
  const descriptions = items.map((i) => i.descriptionRu || i.description || "").join(" ");
  assert.ok(
    /AT 051 DA F04 N 11 DS Пневмопривод/i.test(descriptions),
    `Полное название товара не найдено в lineItems, получили: ${JSON.stringify(items.map((i) => ({ article: i.article, desc: i.descriptionRu })))}`
  );
});

// --- Task 6: Мультибренд classifyBrandSignal ---

runTest("Мультибренд: каталожный текст с несколькими брендами — не Мультибрендовая", () => {
  const result = analyzeEmail(project, {
    subject: "Вопрос",
    fromEmail: "buyer@plant.ru",
    fromName: "",
    body: "Добрый день! Мы также работаем с такими производителями как ABB, Schneider Electric. Можем предложить широкий ассортимент. Пожалуйста, уточните наличие.",
    attachments: []
  });
  assert.notEqual(
    result.lead?.requestType, "Мультибрендовая",
    `Каталожный текст не должен давать Мультибрендовую, получили: "${result.lead?.requestType}"`
  );
});

runTest("Мультибренд: два бренда с артикулами в теле — Мультибрендовая", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос ABB и Schneider Electric",
    fromEmail: "buyer@plant.ru",
    fromName: "",
    body: "Прошу КП на ABB ACS580-01 — 1 шт. и Schneider Electric ATV320U07M2B — 1 шт.",
    attachments: []
  });
  assert.equal(
    result.lead?.requestType, "Мультибрендовая",
    `Два бренда с артикулами должны дать Мультибрендовую, получили: "${result.lead?.requestType}"`
  );
});

// --- Task 7: mass_request CC флаг ---

runTest("Флаг массового запроса: CC с двумя внешними адресами", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос КП",
    fromEmail: "buyer@somecompany.ru",
    fromName: "Иван",
    body: "Прошу КП на ABB ACS580-01 — 1 шт.",
    attachments: [],
    cc: ["supplier2@other.ru", "supplier3@third.ru"]
  });
  assert.ok(
    result.intakeFlow?.flags?.includes("mass_request"),
    `Ожидался флаг mass_request при CC >= 2, intakeFlow: ${JSON.stringify(result.intakeFlow)}`
  );
});

runTest("Флаг массового запроса: CC пустой — флага нет", () => {
  const result = analyzeEmail(project, {
    subject: "Запрос КП",
    fromEmail: "buyer@somecompany.ru",
    fromName: "Иван",
    body: "Прошу КП на ABB ACS580-01.",
    attachments: [],
    cc: []
  });
  assert.ok(
    !(result.intakeFlow?.flags || []).includes("mass_request"),
    `Флаг mass_request не должен быть при пустом CC`
  );
});
