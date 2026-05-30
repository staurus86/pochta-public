import { analyzeEmail } from "../src/services/email-analyzer.js";
import { isObviousArticleNoise } from "../src/services/email-analyzer.js";
const a = analyzeEmail(
  { mailbox: "x", brands: [], managerPool: { brandOwners: [] }, knownCompanies: [] },
  {
    fromName: "Виталий Косинский",
    fromEmail: "vkosinsky@hhr.works",
    subject: "FW: Запрос",
    body: `Добрый день.\n\nУ вас есть в наличии водорегулирующие клапаны SAGINOMIYA для морской воды и применением фреона R407C, R404A:\n\n1. 3-х ходовой_Bronze_1"_подсоединение_Rc_тип WR- 2510GLW - 10 шт.\n2. 2-х ходовой_Bronze_2"_подсоединение_ Flange _тип МWR- 5020FLWH - 10 шт.\n\nС уважением,\nВиталий Косинский`,
  }
);
console.log("articles:", JSON.stringify(a.lead.articles));
console.log("isObviousArticleNoise('R407C'):", isObviousArticleNoise("R407C", "применением фреона R407C, R404A"));
console.log("lineItems:", JSON.stringify((a.lead.lineItems || []).map((i) => ({ a: i.article, s: i.source }))));
