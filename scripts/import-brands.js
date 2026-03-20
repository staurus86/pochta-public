/**
 * Import brands from бренды.txt into brand-catalog.json
 * Generates canonical names and aliases for brand detection.
 *
 * Run: node scripts/import-brands.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputFile = path.resolve(__dirname, "..", "бренды.txt");
const outputFile = path.resolve(__dirname, "..", "data", "brand-catalog.json");

const lines = fs.readFileSync(inputFile, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const catalog = [];
const seen = new Set();

for (const line of lines) {
  // Parse: "Brand Name (alias1 / alias2)" or "Brand / Alias"
  const canonical = line
    .replace(/\s*\(.*?\)\s*/g, "")  // remove parenthetical
    .replace(/\s*\/\s*$/, "")        // trailing slash
    .trim();

  if (!canonical || canonical.length < 2) continue;

  const canonicalUpper = canonical.toUpperCase();
  if (seen.has(canonicalUpper)) continue;
  seen.add(canonicalUpper);

  const aliases = new Set();

  // Canonical name as alias
  aliases.add(canonical);
  aliases.add(canonical.toLowerCase());
  aliases.add(canonicalUpper);

  // Handle "Brand / Alternative" format
  if (line.includes(" / ")) {
    for (const part of line.split(" / ")) {
      const clean = part.replace(/\(.*?\)/g, "").trim();
      if (clean.length >= 2) {
        aliases.add(clean);
        aliases.add(clean.toUpperCase());
        aliases.add(clean.toLowerCase());
      }
    }
  }

  // Handle parenthetical aliases: "Brand (Alias1 / Alias2)"
  const parenMatch = line.match(/\(([^)]+)\)/);
  if (parenMatch) {
    for (const part of parenMatch[1].split(/[/,;]/)) {
      const clean = part.trim();
      if (clean.length >= 2) {
        aliases.add(clean);
        aliases.add(clean.toUpperCase());
      }
    }
  }

  // Slug: replace spaces/special chars with nothing
  const slug = canonical.replace(/[\s&.,'+\-()]/g, "").toLowerCase();
  if (slug.length >= 3) aliases.add(slug);

  // First word if multi-word (but only if 4+ chars to avoid noise)
  const firstWord = canonical.split(/[\s-]/)[0];
  if (firstWord.length >= 4) {
    aliases.add(firstWord);
    aliases.add(firstWord.toUpperCase());
  }

  // Remove own company names
  const own = /^(siderus|коловрат|kolovrat|klvrt|ersa\b)/i;
  if (own.test(canonical)) continue;

  catalog.push({
    brand: canonical,
    aliases: [...aliases].filter((a) => a.length >= 2)
  });
}

// Write
fs.writeFileSync(outputFile, JSON.stringify(catalog, null, 2), "utf-8");
console.log(`Imported ${catalog.length} brands with ${catalog.reduce((n, b) => n + b.aliases.length, 0)} total aliases`);
console.log(`Output: ${outputFile}`);

// Stats
const shortAliases = catalog.flatMap((b) => b.aliases).filter((a) => a.length <= 3);
console.log(`Short aliases (<=3 chars): ${shortAliases.length}`);
console.log(`Sample short: ${shortAliases.slice(0, 20).join(", ")}`);
