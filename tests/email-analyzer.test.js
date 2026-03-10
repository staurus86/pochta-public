import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = {
  mailbox: "inbox@example.com",
  brands: ["ABB", "Schneider Electric"],
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
