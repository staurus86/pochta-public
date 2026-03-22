import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "../src/services/detection-kb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const projectsPath = path.resolve(rootDir, "data", "projects.json");

if (!existsSync(projectsPath)) {
  console.error(`projects.json not found: ${projectsPath}`);
  process.exit(1);
}

const projects = JSON.parse(readFileSync(projectsPath, "utf8"));
const dictionary = detectionKb.exportNomenclatureDictionary(5000);

const topArticles = dictionary
  .filter((item) => isUsefulArticle(item.article))
  .filter((item) => item.source_rows >= 3)
  .sort((a, b) => Number(b.source_rows || 0) - Number(a.source_rows || 0))
  .slice(0, 500);

const template = {
  generatedAt: new Date().toISOString(),
  source: {
    projectsPath: path.relative(rootDir, projectsPath),
    nomenclatureTotal: detectionKb.getNomenclatureStats()
  },
  instructions: [
    "Заполните managerPool.articleOwners для артикулов с выделенным менеджером.",
    "Заполните knownCompanies[].brands/articleHistory/nomenclatureHints для исторического CRM matching.",
    "После редактирования перенесите значения в data/projects.json."
  ],
  projectTemplates: projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    managerPoolTemplate: {
      defaultMop: project.managerPool?.defaultMop || "Не назначен",
      defaultMoz: project.managerPool?.defaultMoz || "Не назначен",
      articleOwners: [],
      brandOwners: project.managerPool?.brandOwners || []
    },
    suggestedArticleOwners: topArticles.slice(0, 100).map((item) => ({
      article: item.article,
      brand: item.brand || "",
      productName: item.product_name || "",
      sourceRows: item.source_rows || 0,
      avgPrice: item.avg_price ?? null,
      mop: "",
      moz: "",
      note: ""
    })),
    knownCompaniesTemplate: (project.knownCompanies || []).map((company) => ({
      id: company.id,
      legalName: company.legalName,
      domain: company.domain || "",
      curatorMop: company.curatorMop || "",
      curatorMoz: company.curatorMoz || "",
      brands: company.brands || [],
      articleHistory: company.articleHistory || [],
      nomenclatureHints: company.nomenclatureHints || []
    }))
  }))
};

const outputPath = path.resolve(rootDir, "data", "routing-template.json");
writeFileSync(outputPath, JSON.stringify(template, null, 2));

console.log(JSON.stringify({
  outputPath,
  projects: template.projectTemplates.length,
  suggestedArticlesPerProject: template.projectTemplates[0]?.suggestedArticleOwners.length || 0
}, null, 2));

function isUsefulArticle(article) {
  const normalized = String(article || "").trim().toUpperCase();
  if (normalized.length < 3) return false;
  if (/^\d{1,3}$/.test(normalized)) return false;
  if (!/[A-ZА-Я0-9]/i.test(normalized)) return false;
  return true;
}
