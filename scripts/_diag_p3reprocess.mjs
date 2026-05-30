import { analyzeEmail } from "../src/services/email-analyzer.js";
const a = analyzeEmail(
  { id: "project-3-mailbox-file", type: "mailbox-file-parser", mailbox: "m@project3.local", brands: ["ABB", "Endress & Hauser"], managerPool: { brandOwners: [] }, knownCompanies: [] },
  {
    fromName: "WordPress",
    fromEmail: "wordpress@endress-hauser.pro",
    subject: "Отправка заявки с сайта Endress - Hauser",
    body: "<b>Заявка с формы обратной связи</b> <p>Имя: тест5</p><p>Телефон: +7 (899) 999-99-99</p><p>Артикул A9N18346 x 2 шт</p>",
  }
);
console.log("classification:", a.classification?.label);
console.log("lead present:", !!a.lead, "lead.articles:", JSON.stringify(a.lead?.articles));
console.log("lead keys:", a.lead ? Object.keys(a.lead).slice(0, 20) : "none");
