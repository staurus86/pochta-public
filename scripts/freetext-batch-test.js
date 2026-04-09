/**
 * Batch test: 200+ emails through analyzer, report free-text item detection.
 * Usage: node scripts/freetext-batch-test.js
 */
import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = {
  mailbox: "info@siderus.ru",
  brands: ["ABB","Schneider Electric","Siemens","Endress+Hauser","Danfoss",
           "Vahle","KIESEL","Vega","Grundfos","WIKA","Phoenix Contact",
           "SKF","Yokogawa","Lenze","Bürkert","Sandvik","WAGO","Festo"],
  managerPool: { defaultMop: "Test", defaultMoz: "Test", brandOwners: [] },
  knownCompanies: []
};

// [subject, body, expectedMinFreetext]
const cases = [
  // Trigger A: qty signal
  ["Запрос","Шаровой кран DN50 PN16 — 2 шт\nС уважением",1],
  ["Запрос","Редуктор давления 1 компл\nФильтр сетчатый DN25 3 шт",2],
  ["Запрос","кабель ВВГнг 3×2.5 — 50 м",1],
  ["Запрос","насос центробежный 380В 3 кВт — 1 шт",1],
  ["Запрос","манометр 0-16 бар — 6 шт\nтермометр 0-120°C — 4 шт",2],
  ["Запрос","уплотнение торцевое — 10 шт\nподшипник опорный — 5 шт",2],
  ["Запрос","клапан обратный 1 дюйм — 3 шт",1],
  ["Запрос","задвижка чугунная DN100 — 2 шт",1],
  ["Запрос","преобразователь давления 4-20мА — 1 шт",1],
  ["Запрос","датчик температуры PT100 — 4 шт\nтермопара ХА — 2 шт",2],
  ["Запрос","прокладка паронитовая DN50 — 20 шт",1],
  ["Запрос","болт М16х80 — 100 шт",1],
  ["Запрос","муфта стальная DN25 — 5 шт",1],
  ["Запрос","вентиль игольчатый DN10 — 3 шт",1],
  ["Запрос","фланец стальной DN100 PN16 — 4 шт",1],
  // Trigger B: request keywords
  ["Запрос","нужен шаровой кран DN50",1],
  ["Запрос","нужна задвижка DN100 PN16",1],
  ["Запрос","нужны подшипники для насоса",1],
  ["КП","прошу счёт на редуктор давления",1],
  ["КП","прошу кп на насос центробежный 3кВт",1],
  ["Заявка","требуется преобразователь частоты 7.5кВт",1],
  ["Заявка","необходим датчик уровня радарный",1],
  ["Запрос","интересует расходомер электромагнитный DN80",1],
  ["Запрос","запрос на уплотнения для насоса Grundfos",1],
  ["Запрос","нужен клапан предохранительный DN25",1],
  ["Запрос","нужно реле давления для компрессора",1],
  ["Запрос","нужны фильтры для системы водоподготовки 5 шт",1],
  ["Запрос","необходима арматура трубопроводная DN50",1],
  ["Запрос","требуется насос для перекачки кислоты",1],
  ["Запрос","прошу предложение на трансформатор 100кВА",1],
  // Trigger C: known brand without article
  ["Барабаны Vahle","Барабаны Vahle\n\nС уважением",1],
  ["Запрос KIESEL","Торцевое уплотнение на мешалку KIESEL\n\nИван",1],
  ["Запрос ABB","Нужен привод ABB серии ACS для насоса\n\nС уважением",1],
  ["Festo клапан","клапан Festo пневматический 5/2\n\nПетров",1],
  ["Запрос Danfoss","регулятор давления Danfoss — прошу КП",1],
  // Mixed: real article + freetext
  ["Запрос","ABB ACS580-01-12A7-4 — 2 шт\nшаровой кран DN50 — 1 шт",1],
  ["Запрос","Siemens 6ES7314-1AG14-0AB0 — 1шт\nкабель монтажный — 10 м",1],
  // NOT positions (шум)
  ["RE: счёт","ИНН 7801234567 КПП 780101001\n\nС уважением",0],
  ["Ответ","Спасибо за заявку!\n\nС уважением",0],
  ["Ответ","Здравствуйте!\n\nС уважением, Иванов И.И.",0],
  ["Запрос","test@test.ru\n\nС уважением",0],
  // Real Georgiy emails
  ["Запрос счета Вентинтех - уплотнение KIESEL","Добрый день!\nПрошу счёт с учётом доставки.\n\nС уважением",1],
  ["Запрос_Уровнемер радарный Vegapuls 31","Уровнемер радарный Vegapuls 31\n1 шт\n\nС уважением",1],
  ["Барабаны Vahle","Добрый день!\nБарабаны Vahle — 3 шт\nПожалуйста, пришлите КП.",1],
  // Long list
  ["Запрос на оборудование","Шаровой кран DN25 — 5 шт\nШаровой кран DN50 — 3 шт\nЗадвижка DN100 — 1 шт\nКлапан обратный DN50 — 4 шт\nФильтр грязевик DN25 — 2 шт",5],
  // Edge cases
  ["Запрос","X — 1 шт",0],
  ["Запрос","",0],
];

let passed = 0, failed = 0;
const gaps = [];

console.log(`\n${"═".repeat(65)}`);
console.log("  FREETEXT BATCH TEST — " + cases.length + " кейсов");
console.log(`${"═".repeat(65)}\n`);

for (const [subject, body, expectedMin] of cases) {
  let result;
  try {
    result = analyzeEmail(project, { fromEmail: "test@test.ru", fromName: "", subject, body, attachments: [] });
  } catch(e) {
    console.log(`✗ ERROR [${subject.slice(0,40)}]: ${e.message}`);
    failed++;
    gaps.push({ subject, body: body.slice(0,60), expected: expectedMin, got: "ERROR" });
    continue;
  }
  const ft = (result.lead?.lineItems || []).filter(i => i.article?.startsWith("DESC:"));
  if (ft.length >= expectedMin) {
    passed++;
    if (ft.length > 0) console.log(`✓ [${subject.slice(0,40)}] → ${ft.length} freetext позиц.`);
  } else {
    failed++;
    console.log(`✗ [${subject.slice(0,40)}] → ожидалось ≥${expectedMin}, нашлось ${ft.length}`);
    if (expectedMin > 0) gaps.push({ subject: subject.slice(0,60), body: body.slice(0,80), expected: expectedMin, got: ft.length });
  }
}

console.log(`\n${"─".repeat(65)}`);
console.log(`ИТОГ: ${passed} pass / ${failed} fail из ${cases.length}`);
if (gaps.length) {
  console.log(`\n═══ ГЕПЫ (${gaps.length}) ═══`);
  gaps.forEach(g => console.log(`  [${g.subject}]\n  body: "${g.body}"\n  ожидалось≥${g.expected}, нашлось ${g.got}\n`));
}
if (failed > 0) process.exit(1);
