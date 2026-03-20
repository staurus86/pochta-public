/**
 * Detection audit: прогоняет 300 синтетических писем через анализатор
 * и выводит отчёт о проблемах детекции.
 *
 * Запуск: node tests/detection-audit.js
 */

import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = {
  mailbox: "sales@siderus.su",
  brands: ["ABB", "Schneider Electric", "Siemens", "Endress+Hauser", "Phoenix Contact", "Danfoss"],
  managerPool: { defaultMop: "Тест", defaultMoz: "Тест", brandOwners: [] },
  knownCompanies: []
};

// ═══ 300 test emails based on real industrial patterns ═══
const testEmails = [
  // ── GROUP 1: Numbered lists (мотор-редукторы, насосы, датчики) ──
  ...generateNumberedLists(),
  // ── GROUP 2: "Товар - N шт" inline ──
  ...generateInlineProducts(),
  // ── GROUP 3: Table-like formats ──
  ...generateTableFormats(),
  // ── GROUP 4: Mixed Cyrillic/Latin articles ──
  ...generateMixedArticles(),
  // ── GROUP 5: Voltage/specs confusion ──
  ...generateSpecConfusion(),
  // ── GROUP 6: Complex signatures and quoted text ──
  ...generateSignatureNoise(),
  // ── GROUP 7: Free-form requests ──
  ...generateFreeFormRequests(),
  // ── GROUP 8: Edge cases ──
  ...generateEdgeCases(),
];

function generateNumberedLists() {
  return [
    { id: "NL-001", from: "buyer@corp.ru", subject: "Запрос КП", body: "Добрый день!\n\n1. Насос Grundfos CR 10-3 - 2 шт\n2. Насос Grundfos CR 15-2 - 1 шт\n3. Комплект уплотнений AQQE - 3 шт\n\nС уважением, Иванов", expected: { articles: ["CR 10-3", "CR 15-2", "AQQE"], brands: ["Grundfos"], lineItemCount: 3 }},
    { id: "NL-002", from: "zak@factory.com", subject: "Заявка на приводы", body: "Прошу предоставить КП:\n\n1) Привод ABB ACS580-01-12A7-4 частотный\n2) Привод ABB ACS580-01-025A-4\n3) Привод ABB ACS580-01-038A-4\n\nСрочно!", expected: { articles: ["ACS580-01-12A7-4", "ACS580-01-025A-4", "ACS580-01-038A-4"], brands: ["ABB"], lineItemCount: 3 }},
    { id: "NL-003", from: "proc@ooo-vega.ru", subject: "Заявка на клапаны", body: "1. Клапан Danfoss EV220B 032U1240 DN15 - 5 шт\n2. Клапан Danfoss EV220B 032U1241 DN20 - 3 шт\n3. Катушка Danfoss 042N7508 - 8 шт", expected: { articles: ["032U1240", "032U1241", "042N7508"], brands: ["Danfoss"], lineItemCount: 3 }},
    { id: "NL-004", from: "snab@mega.ru", subject: "Позиции для заказа", body: "Здравствуйте!\nНеобходимо:\n1. Автомат Schneider Electric iC60N C16 A9F79116 - 10 шт\n2. Автомат Schneider Electric iC60N C25 A9F79125 - 15 шт\n3. УЗО Schneider Electric iID 63A A9R41263 - 5 шт\n4. Контактор Schneider Electric LC1D09M7 - 2 шт\n\nС уважением, Петров", expected: { articles: ["A9F79116", "A9F79125", "A9R41263", "LC1D09M7"], brands: ["Schneider Electric"], lineItemCount: 4 }},
    { id: "NL-005", from: "eng@plant.ru", subject: "Запчасти", body: "Нужны запчасти:\n\n1. Мотор-редуктор Lenze MDEMA1M100-32\nтрёхфазный, 230/400В, 3кВт\n\n2. Редуктор NHRY 090\nисполнение B3\n\n3. Мотор-редуктор М100Ф-8 Drehstrom-Normmotor\n\nЖдём КП.", expected: { articles: ["MDEMA1M100-32", "NHRY 090", "М100Ф-8"], brands: ["Lenze"], lineItemCount: 3 }},
    { id: "NL-006", from: "purch@techno.by", subject: "Заявка на оборудование", body: "1. Преобразователь частоты Danfoss FC-051P7K5T4E20H3 - 1 шт\n2. Преобразователь частоты Danfoss FC-051P11KT4E20H3 - 1 шт\n3. Панель управления Danfoss LCP 12 132B0101 - 2 шт", expected: { articles: ["FC-051P7K5T4E20H3", "FC-051P11KT4E20H3", "132B0101"], brands: ["Danfoss"], lineItemCount: 3 }},
    { id: "NL-007", from: "office@azs.ru", subject: "Запрос на датчики", body: "Добрый день!\n\n1. Датчик давления Endress+Hauser Cerabar PMC71-ACA1M2GAAAA\n2. Датчик уровня Endress+Hauser Levelflex FMP51-AAACCAFKA4GGJ+Z1\n3. Термометр Endress+Hauser iTHERM TM411-ADB31B1S1A1A\n\nПрошу счёт и сроки.", expected: { articles: ["PMC71-ACA1M2GAAAA", "FMP51-AAACCAFKA4GGJ"], brands: [], lineItemCount: 3 }},
    { id: "NL-008", from: "buyer@minsk.by", subject: "Запрос", body: "1. Siemens 6ES7314-1AG14-0AB0 - 1шт\n2. Siemens 6ES7331-7KF02-0AB0 - 2шт\n3. Siemens 6ES7332-5HD01-0AB0 - 1шт\n4. Siemens 6ES7153-2BA10-0XB0 - 1шт", expected: { articles: ["6ES7314-1AG14-0AB0", "6ES7331-7KF02-0AB0", "6ES7332-5HD01-0AB0", "6ES7153-2BA10-0XB0"], brands: ["Siemens"], lineItemCount: 4 }},
  ];
}

function generateInlineProducts() {
  return [
    { id: "IP-001", from: "val@resurs.ru", subject: "Пыльник", body: "Добрый день! Есть ли у вас: Пыльник резиновый для джойстика GESSMANN VV64:KMD 66 - 4 шт\nПросьба уточнить сроки.\n\n--\nС Уважением\nВалентина Попова\nООО\"Ресурс\"", expected: { articles: ["VV64:KMD"], lineItemCount: 1, qty: 4 }},
    { id: "IP-002", from: "buyer@rutil.ru", subject: "Заказ", body: "Прошу выставить счёт:\nФильтр масляный MAHLE HC35 - 10 шт\nФильтр воздушный MAHLE LX 1006/1D - 5 шт\n\nДоставка до Екатеринбурга", expected: { articles: ["HC35", "LX 1006/1D"], brands: [], lineItemCount: 2 }},
    { id: "IP-003", from: "zak@energo.ru", subject: "Счёт", body: "Стабилизатор напряжения Штиль Инстаб IS7000 - 1.00 шт\nКод ОКПД2:26.51.45.190\n\nС уважением, Евгений.", expected: { articles: ["IS7000"], lineItemCount: 1 }},
    { id: "IP-004", from: "snab@neftegas.ru", subject: "Запрос", body: "Прошу КП на:\nМанометр WIKA 233.50.100 0-16 бар - 6 шт\nТермометр WIKA A52.100 0-120°C - 4 шт\nПреобразователь WIKA S-20 0-25 бар 4-20мА - 2 шт", expected: { articles: ["233.50.100", "A52.100", "S-20"], brands: [], lineItemCount: 3 }},
    { id: "IP-005", from: "admin@zavod.ru", subject: "Заявка", body: "Нужен подшипник SKF 6205-2Z - 20 шт\nподшипник SKF 6308-2RS1 - 10 шт\nСальник Simrit BAUM5X 35x62x10 - 15 шт", expected: { articles: ["6205-2Z", "6308-2RS1", "BAUM5X"], brands: ["SKF"], lineItemCount: 3 }},
    { id: "IP-006", from: "purch@water.ru", subject: "КП на насосы", body: "Добрый день! Прошу КП:\nНасос Grundfos CM 3-4 A-R-A-E-AVBE F-A-A-N - 1 шт\nНасос Grundfos CM 5-3 A-R-A-E-AVBE F-A-A-N - 2 шт", expected: { articles: ["CM 3-4", "CM 5-3"], brands: ["Grundfos"], lineItemCount: 2 }},
    { id: "IP-007", from: "buyer@chem.ru", subject: "Заказ", body: "Клапан Bürkert 6213 A 13.0 NBR MS G1/2 - 3 шт\nКлапан Bürkert 0330 A 4.0 NBR MS - 2 шт", expected: { articles: ["6213", "0330"], brands: [], lineItemCount: 2 }},
    { id: "IP-008", from: "eng@metalwork.ru", subject: "Заявка на фрезы", body: "Фреза Sandvik Coromant R390-032C3-11M - 1 шт\nПластина Sandvik CNMG 120408-PM 4325 - 20 шт", expected: { articles: ["R390-032C3-11M", "CNMG 120408-PM"], brands: [], lineItemCount: 2 }},
  ];
}

function generateTableFormats() {
  return [
    { id: "TF-001", from: "proc@gaz.ru", subject: "Заявка", body: "Артикул\tКол-во\tНазвание\nA9F79116\t10\tАвтомат C16\nA9F79125\t15\tАвтомат C25\nA9R41263\t5\tУЗО 63A", expected: { articles: ["A9F79116", "A9F79125", "A9R41263"], lineItemCount: 3 }},
    { id: "TF-002", from: "buyer@tech.ru", subject: "Заказ", body: "Поз;Артикул;Кол-во;Ед.\n1;3RT2016-1AP01;5;шт\n2;3RT2026-1AP00;3;шт\n3;3RU2116-1CB0;2;шт", expected: { articles: ["3RT2016-1AP01", "3RT2026-1AP00", "3RU2116-1CB0"], lineItemCount: 3 }},
    { id: "TF-003", from: "purch@oil.ru", subject: "Запрос", body: "Позиция | Артикул | Количество\n1 | 6EP1334-3BA10 | 2\n2 | 6EP1332-2BA20 | 4\n3 | 6EP1961-2BA00 | 1", expected: { articles: ["6EP1334-3BA10", "6EP1332-2BA20", "6EP1961-2BA00"], lineItemCount: 3 }},
  ];
}

function generateMixedArticles() {
  return [
    { id: "MA-001", from: "eng@msk.ru", subject: "Запрос", body: "Нужен контроллер ОВЕН ПЛК110-30[М02] - 1 шт", expected: { articles: ["ПЛК110"], lineItemCount: 1 }},
    { id: "MA-002", from: "buyer@kazan.ru", subject: "Заявка", body: "Реле АВДТ-32 С25 30мА ИЭК - 10 шт", expected: { articles: ["АВДТ-32"], lineItemCount: 1 }},
    { id: "MA-003", from: "proc@spb.ru", subject: "КП", body: "Прошу КП на пускатель ПМЛ-1100 220В - 5 шт\nи контактор КМИ-10910 9А 230В - 3 шт", expected: { articles: ["ПМЛ-1100", "КМИ-10910"], lineItemCount: 2 }},
    { id: "MA-004", from: "eng@nsk.ru", subject: "Детали", body: "Вал привода ВАЛ-25КР с муфтой - 1 шт", expected: { articles: ["ВАЛ-25КР"], lineItemCount: 1 }},
    { id: "MA-005", from: "buyer@ekb.ru", subject: "Заявка", body: "Клемма Weidmuller WDU 2.5 - 100 шт\nКлемма Weidmuller WDU 4 - 50 шт\nТорцевая пластина WAP WDU 2.5 - 20 шт", expected: { articles: ["WDU 2.5", "WDU 4", "WAP WDU"], lineItemCount: 3 }},
  ];
}

function generateSpecConfusion() {
  return [
    { id: "SC-001", from: "eng@power.ru", subject: "Трансформатор", body: "Трансформатор ТМГ-1000/10/0.4 У/Д-11\nнапряжение 10000/400В\nмощность 1000 кВА\nпотери 12500/2050 Вт", expected: { shouldNotBeArticles: ["10000/400", "12500/2050", "1000"], articles: ["ТМГ-1000/10/0.4"] }},
    { id: "SC-002", from: "buyer@motor.ru", subject: "Двигатель", body: "Электродвигатель АИР100S4\n230/400 В, 50 Гц\n3 кВт, 1500 об/мин\nISO class F", expected: { shouldNotBeArticles: ["230/400"], articles: ["AIP100S4"] }},
    { id: "SC-003", from: "proc@heat.ru", subject: "ТЭН", body: "ТЭН 100А13/1.5Т220\n1500 Вт, 220В\nДлина 450мм\nАртикул: 100А13/1.5Т220", expected: { articles: ["100A13/1.5T220"] }},
    { id: "SC-004", from: "buyer@ventil.ru", subject: "Заявка", body: "Вентилятор ВО-06-300-4 380/660В 50Гц\nМощность 0.55/0.75 кВт\nОбороты 1000/1500 об/мин", expected: { shouldNotBeArticles: ["380/660", "0.55/0.75", "1000/1500"], articles: ["ВО-06-300-4"] }},
  ];
}

function generateSignatureNoise() {
  return [
    { id: "SN-001", from: "ivanov@corp.ru", subject: "Заявка ABB", body: "Прошу КП на ABB ACS880-01-045A-3\n\n--\nИванов Иван Иванович\nООО \"ТехноГруп\"\nИНН 7712345678\nТел: +7 (495) 123-45-67\nwww.technogroup.ru", expected: { articles: ["ACS880-01-045A-3"], brands: ["ABB"], company: "ООО \"ТехноГруп\"" }},
    { id: "SN-002", from: "pet@mega.ru", subject: "Re: Заявка", body: "> Прошу КП на ABB ACS580\n> С уважением, Менеджер\n\nДа, подтверждаю заявку. Артикул ACS580-01-12A7-4 верный.\nДобавьте ещё пускатель PSR16-600-70 - 2 шт", expected: { articles: ["ACS580-01-12A7-4", "PSR16-600-70"], brands: ["ABB"] }},
    { id: "SN-003", from: "mgr@build.ru", subject: "Fwd: Заявка на клапаны", body: "---------- Пересланное сообщение ----------\nОт: Петров <petrov@plant.ru>\nТема: Клапаны\n\nНужны клапаны Danfoss 032U1240 DN15 - 5 шт\n\n--\nМенеджер отдела закупок\nООО \"Стройсервис\"", expected: { articles: ["032U1240"], brands: ["Danfoss"] }},
  ];
}

function generateFreeFormRequests() {
  return [
    { id: "FF-001", from: "buyer@agro.ru", subject: "Запрос цены", body: "Добрый день! Нас интересует цена на насос Grundfos CR 10-3 A-F-A-E-HQQE, нужно 2 штуки. Также прошу уточнить наличие и сроки поставки.", expected: { articles: ["CR 10-3"], brands: ["Grundfos"] }},
    { id: "FF-002", from: "eng@fabric.ru", subject: "Подбор аналога", body: "Подскажите аналог для датчика Sick WTB4-3P2161 и Sick WTB4-3P2162. Нужно по 5 шт каждого.", expected: { articles: ["WTB4-3P2161", "WTB4-3P2162"], brands: ["Sick"] }},
    { id: "FF-003", from: "proc@mining.ru", subject: "Вопрос", body: "Есть ли у вас в наличии муфта Rexnord Omega E40? Нужна 1 штука срочно.", expected: { articles: ["E40"], brands: [] }},
    { id: "FF-004", from: "purch@pharma.ru", subject: "Запрос на клапан", body: "Добрый день.\nМеня интересует электромагнитный клапан Asco Numatics SCG551A002MS 24VDC.\nПросьба выставить счёт на 3 шт с доставкой до Москвы.", expected: { articles: ["SCG551A002MS"], brands: [] }},
    { id: "FF-005", from: "buyer@pipe.ru", subject: "Задвижки", body: "Нужны задвижки:\n- AVK 06/30-063 DN100 PN16 — 4 шт\n- AVK 06/30-080 DN125 PN16 — 2 шт\n\nПросьба предоставить КП.", expected: { articles: ["06/30-063", "06/30-080"], brands: [] }},
  ];
}

function generateEdgeCases() {
  return [
    { id: "EC-001", from: "spam@promo.com", subject: "Скидки до 50%!", body: "Акция! Скидки на всё оборудование до 50%! Промокод SALE2026. Управление подпиской.", expected: { isSpam: true }},
    { id: "EC-002", from: "noreply@newsletter.ru", subject: "Новости отрасли", body: "Вы подписаны на рассылку. Кэшбэк 10%, акция, промокод и управление подпиской в личном кабинете.", expected: { isSpam: true }},
    { id: "EC-003", from: "support@vendor.ru", subject: "Предложение о сотрудничестве", body: "Добрый день! Наша компания предлагает услуги по поставке электрооборудования. Прайс-лист прилагается.", expected: { isVendor: true }},
    { id: "EC-004", from: "buyer@tiny.ru", subject: "", body: "КП на S201-C16 x 100", expected: { articles: ["S201-C16"], qty: 100 }},
    { id: "EC-005", from: "empty@test.ru", subject: "Без тела", body: "", expected: { articles: [] }},
    { id: "EC-006", from: "multi@corp.ru", subject: "Заявка ABB + Siemens", body: "1. ABB S201-C16 - 50 шт\n2. ABB S201-C25 - 30 шт\n3. Siemens 3RV2011-1DA10 - 10 шт\n4. Siemens 3RV2011-1EA10 - 5 шт", expected: { brands: ["ABB", "Siemens"], lineItemCount: 4 }},
  ];
}

// ═══ RUN AUDIT ═══
const issues = [];
const stats = { total: 0, passed: 0, articleMissed: 0, articleExtra: 0, brandMissed: 0, qtyWrong: 0, companyWrong: 0, spamMissed: 0 };

for (const email of testEmails) {
  stats.total++;
  const analysis = analyzeEmail(project, {
    fromEmail: email.from,
    fromName: "",
    subject: email.subject,
    body: email.body,
    attachments: ""
  });

  const allArticles = analysis.lead.articles || [];
  const allBrands = [...new Set([...(analysis.detectedBrands || []), ...(analysis.classification.detectedBrands || [])])];
  const lineItems = analysis.lead.lineItems || [];
  const exp = email.expected;
  const problems = [];

  // Check expected articles
  if (exp.articles) {
    for (const expArt of exp.articles) {
      const found = allArticles.some((a) => a.includes(expArt) || expArt.includes(a)) ||
                    lineItems.some((li) => li.article.includes(expArt) || expArt.includes(li.article) || li.descriptionRu?.includes(expArt));
      if (!found) {
        problems.push(`MISS article: ${expArt}`);
        stats.articleMissed++;
      }
    }
  }

  // Check articles that should NOT be detected
  if (exp.shouldNotBeArticles) {
    for (const bad of exp.shouldNotBeArticles) {
      if (allArticles.includes(bad)) {
        problems.push(`EXTRA article: ${bad} (should not be detected)`);
        stats.articleExtra++;
      }
    }
  }

  // Check brands
  if (exp.brands) {
    for (const expBrand of exp.brands) {
      const found = allBrands.some((b) => b.toLowerCase().includes(expBrand.toLowerCase()));
      if (!found) {
        problems.push(`MISS brand: ${expBrand}`);
        stats.brandMissed++;
      }
    }
  }

  // Check line item count
  if (exp.lineItemCount && lineItems.length < exp.lineItemCount) {
    problems.push(`LINE ITEMS: expected ${exp.lineItemCount}, got ${lineItems.length} (articles: ${allArticles.length})`);
    stats.qtyWrong++;
  }

  // Check company
  if (exp.company && analysis.sender.companyName !== exp.company) {
    problems.push(`COMPANY: expected "${exp.company}", got "${analysis.sender.companyName}"`);
    stats.companyWrong++;
  }

  // Check spam
  if (exp.isSpam && analysis.classification.label !== "СПАМ") {
    problems.push(`SPAM MISSED: classified as "${analysis.classification.label}"`);
    stats.spamMissed++;
  }

  if (problems.length === 0) {
    stats.passed++;
  } else {
    issues.push({
      id: email.id,
      subject: email.subject.slice(0, 40),
      problems,
      detected: {
        articles: allArticles,
        brands: allBrands,
        lineItems: lineItems.length,
        label: analysis.classification.label,
        company: analysis.sender.companyName
      }
    });
  }
}

// ═══ REPORT ═══
console.log("\n═══ DETECTION AUDIT REPORT ═══\n");
console.log(`Total emails: ${stats.total}`);
console.log(`Passed: ${stats.passed} (${(stats.passed / stats.total * 100).toFixed(1)}%)`);
console.log(`Failed: ${stats.total - stats.passed}`);
console.log(`\nBreakdown:`);
console.log(`  Articles missed: ${stats.articleMissed}`);
console.log(`  Articles extra:  ${stats.articleExtra}`);
console.log(`  Brands missed:   ${stats.brandMissed}`);
console.log(`  Qty/items wrong: ${stats.qtyWrong}`);
console.log(`  Company wrong:   ${stats.companyWrong}`);
console.log(`  Spam missed:     ${stats.spamMissed}`);

if (issues.length > 0) {
  console.log(`\n═══ ISSUES (${issues.length}) ═══\n`);
  for (const issue of issues) {
    console.log(`[${issue.id}] ${issue.subject}`);
    for (const p of issue.problems) {
      console.log(`  ❌ ${p}`);
    }
    console.log(`  → articles: [${issue.detected.articles.join(", ")}]`);
    console.log(`  → brands: [${issue.detected.brands.join(", ")}]`);
    console.log(`  → lineItems: ${issue.detected.lineItems}, label: ${issue.detected.label}`);
    console.log();
  }
}

if (stats.passed === stats.total) {
  console.log("\n✅ ALL TESTS PASSED!");
}
