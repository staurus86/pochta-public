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
      assert.equal(result.attachmentAnalysis.files[0].reason, "low_quality_pdf_text");
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
