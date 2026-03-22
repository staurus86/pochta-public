import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "../src/services/detection-kb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const inputArg = process.argv[2];
const inputPath = inputArg
  ? path.resolve(rootDir, inputArg)
  : path.resolve(rootDir, "Номенклатура", "номенклатуры__которые_проходили_калькуляцию_2026-03-20T17_47_34.60147203_00.json");

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const entries = JSON.parse(raw);
if (!Array.isArray(entries)) {
  console.error("Expected JSON array of nomenclature rows.");
  process.exit(1);
}

const result = detectionKb.importNomenclatureCatalog(entries, {
  sourceFile: path.relative(rootDir, inputPath)
});

const outputPath = path.resolve(rootDir, "data", "nomenclature-dictionary.json");
writeFileSync(outputPath, JSON.stringify(detectionKb.exportNomenclatureDictionary(), null, 2));

console.log(JSON.stringify({
  inputPath,
  outputPath,
  ...result
}, null, 2));
