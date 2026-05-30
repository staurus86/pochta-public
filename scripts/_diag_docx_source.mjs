import { analyzeEmail } from "../src/services/email-analyzer.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import path from "node:path";

const mk = "attach-test-msg-4";
const dir = path.resolve(process.cwd(), "data", "attachments", mk);
const buildDir = path.join(dir, "__build__");
const wordDir = path.join(buildDir, "word");
mkdirSync(wordDir, { recursive: true });
writeFileSync(path.join(buildDir, "[Content_Types].xml"), "<Types/>");
writeFileSync(path.join(wordDir, "document.xml"), "<w:document><w:body><w:p><w:r><w:t>Модуль канавочный левый MSS-T25L03-GX16-2</w:t></w:r></w:p></w:body></w:document>");
const fs2 = (p) => String(p).replace(/\\/g, "/");
const ap = path.join(dir, "spec.docx");
spawnSync("tar", ["--force-local", "-a", "-cf", fs2(ap), "-C", fs2(buildDir), "[Content_Types].xml", "word/document.xml"], { encoding: "utf8" });
const sz = statSync(ap).size;
const a = analyzeEmail(
  { mailbox: "x", brands: [], managerPool: { brandOwners: [] }, knownCompanies: [] },
  { messageKey: mk, fromEmail: "b@energy.ru", subject: "Запрос", body: "Во вложении docx", attachments: ["spec.docx"], attachmentFiles: [{ filename: "spec.docx", safeName: "spec.docx", size: sz, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }] }
);
console.log("processedCount:", a.attachmentAnalysis?.meta?.processedCount);
console.log("articles:", JSON.stringify(a.lead.articles));
console.log("lineItems:", JSON.stringify(a.lead.lineItems, null, 1));
rmSync(dir, { recursive: true, force: true });
