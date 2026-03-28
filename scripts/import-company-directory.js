import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "../src/services/detection-kb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const inputArg = process.argv[2];
const inputPath = inputArg
  ? path.resolve(rootDir, inputArg)
  : path.resolve(rootDir, "data", "company-directory.json");

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const entries = JSON.parse(raw);
if (!Array.isArray(entries)) {
  console.error("Expected JSON array of company directory rows.");
  process.exit(1);
}

const result = detectionKb.importCompanyDirectory(entries, {
  sourceFile: path.relative(rootDir, inputPath)
});

console.log(JSON.stringify({
  inputPath,
  ...result
}, null, 2));
