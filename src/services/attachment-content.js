import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "./detection-kb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_ROOT = path.resolve(__dirname, "../../data/attachments");

const DEFAULT_LIMITS = {
  maxFiles: 8,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxExtractedCharsPerFile: 12000,
  maxCombinedChars: 24000,
  maxBudgetMs: 1500
};

const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".eml", ".log", ".md"
]);

const PDF_EXTENSIONS = new Set([".pdf"]);
const OOXML_EXTENSIONS = new Set([".docx", ".xlsx"]);
const PHASE3_EXTENSIONS = new Set([".xls", ".doc"]);

const INN_PATTERN = /\b\d{10,12}\b/g;
const KPP_PATTERN = /\b\d{9}\b/g;
const OGRN_PATTERN = /\b\d{13,15}\b/g;
const ARTICLE_PATTERN = /\b([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9./:_-]{2,})\b/gi;

export function analyzeStoredAttachments(messageKey, attachmentFiles = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const startedAt = Date.now();
  const files = [];
  const textParts = [];
  let processedCount = 0;
  let skippedCount = 0;
  let totalBytes = 0;
  let totalChars = 0;

  for (const attachment of attachmentFiles || []) {
    const filename = attachment?.filename || attachment?.name || "";
    const safeName = attachment?.safeName || sanitizeFilename(filename);
    const contentType = attachment?.contentType || "";
    const size = Number(attachment?.size || 0);
    const ext = path.extname(filename || safeName || "").toLowerCase();
    const result = {
      filename,
      safeName: safeName || null,
      contentType: contentType || null,
      size,
      ext,
      status: "skipped",
      reason: null,
      extractedChars: 0,
      category: categorizeAttachment(filename, ext, contentType),
      preview: null,
      detectedArticles: [],
      detectedBrands: [],
      detectedInn: [],
      detectedKpp: [],
      detectedOgrn: []
    };

    if (processedCount >= limits.maxFiles) {
      result.reason = `batch_limit:${limits.maxFiles}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (Date.now() - startedAt > limits.maxBudgetMs) {
      result.reason = `time_budget:${limits.maxBudgetMs}ms`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (size > limits.maxFileBytes) {
      result.reason = `file_too_large:${limits.maxFileBytes}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (totalBytes + size > limits.maxTotalBytes) {
      result.reason = `total_size_budget:${limits.maxTotalBytes}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (PHASE3_EXTENSIONS.has(ext)) {
      result.reason = "phase3_format";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (!TEXT_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext) && !OOXML_EXTENSIONS.has(ext)) {
      result.reason = "unsupported_format";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    const filePath = safeName ? path.join(ATTACHMENTS_ROOT, messageKey, safeName) : null;
    if (!filePath || !existsSync(filePath)) {
      result.reason = "missing_on_disk";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    try {
      const buffer = readFileSync(filePath);
      totalBytes += buffer.length;
      let extractedText = "";

      if (TEXT_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromPlainBuffer(buffer);
      } else if (PDF_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromPdfBuffer(buffer);
      } else if (OOXML_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromOfficeOpenXml(filePath, ext);
      }

      extractedText = cleanupExtractedText(extractedText).slice(0, limits.maxExtractedCharsPerFile);
      if (!extractedText) {
        result.reason = "no_text_extracted";
        files.push(result);
        skippedCount += 1;
        continue;
      }

      if (PDF_EXTENSIONS.has(ext) && !isUsablePdfText(extractedText)) {
        result.reason = "low_quality_pdf_text";
        result.preview = extractedText.slice(0, 200);
        files.push(result);
        skippedCount += 1;
        continue;
      }

      processedCount += 1;
      result.status = "processed";
      result.extractedChars = extractedText.length;
      result.preview = extractedText.slice(0, 400);
      result.detectedArticles = detectAttachmentArticles(extractedText);
      result.detectedBrands = detectionKb.detectBrands(extractedText, []);
      result.detectedInn = uniqueMatches(extractedText, INN_PATTERN).filter((value) => value.length === 10 || value.length === 12);
      result.detectedKpp = uniqueMatches(extractedText, KPP_PATTERN);
      result.detectedOgrn = uniqueMatches(extractedText, OGRN_PATTERN).filter((value) => value.length === 13 || value.length === 15);

      if (totalChars < limits.maxCombinedChars) {
        const remaining = limits.maxCombinedChars - totalChars;
        const chunk = extractedText.slice(0, remaining);
        if (chunk) {
          textParts.push(`Вложение: ${filename}\n${chunk}`);
          totalChars += chunk.length;
        }
      }
    } catch (error) {
      result.reason = `read_error:${error.message}`;
      skippedCount += 1;
    }

    files.push(result);
  }

  return {
    files,
    combinedText: textParts.join("\n\n").trim(),
    meta: {
      processedCount,
      skippedCount,
      totalBytes,
      totalChars,
      budgetMs: Date.now() - startedAt,
      limits
    }
  };
}

function sanitizeFilename(filename) {
  return String(filename || "").replace(/[<>:"/\\|?*]/g, "_");
}

function categorizeAttachment(filename, ext, contentType) {
  const lower = String(filename || "").toLowerCase();
  if (/реквиз|card|details|банк/i.test(lower)) return "requisites";
  if (/сч[её]т|invoice/i.test(lower)) return "invoice";
  if (/спецификац|specification|spec/i.test(lower)) return "specification";
  if (/прайс|price/i.test(lower)) return "price_list";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (OOXML_EXTENSIONS.has(ext)) return "office_document";
  if (PHASE3_EXTENSIONS.has(ext)) return "phase3_document";
  if ((contentType || "").startsWith("image/")) return "image";
  return "other";
}

function extractTextFromPlainBuffer(buffer) {
  return buffer.toString("utf8");
}

function extractTextFromPdfBuffer(buffer) {
  const text = buffer.toString("latin1", 0, Math.min(buffer.length, 1024 * 1024));
  const parts = [];

  for (const match of text.matchAll(/\(([^()]*)\)\s*Tj/g)) {
    parts.push(match[1]);
  }

  for (const match of text.matchAll(/\[(.*?)\]\s*TJ/g)) {
    const chunk = match[1];
    for (const sub of chunk.matchAll(/\(([^()]*)\)/g)) {
      parts.push(sub[1]);
    }
  }

  if (parts.length === 0) {
    for (const match of text.matchAll(/[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.,;:()"/\\_-]{15,}/g)) {
      parts.push(match[0]);
    }
  }

  return parts.join(" ");
}

function extractTextFromOfficeOpenXml(filePath, ext) {
  if (ext === ".docx") {
    return extractTextFromDocx(filePath);
  }
  if (ext === ".xlsx") {
    return extractTextFromXlsx(filePath);
  }
  return "";
}

function extractTextFromDocx(filePath) {
  const entries = listArchiveEntries(filePath)
    .filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry))
    .slice(0, 6);
  const parts = [];

  for (const entry of entries) {
    const xml = extractArchiveEntry(filePath, entry);
    if (!xml) continue;
    const lines = [];
    for (const match of xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
      lines.push(decodeXmlEntities(match[1]));
    }
    if (lines.length > 0) {
      parts.push(lines.join(" "));
    }
  }

  return parts.join("\n");
}

function extractTextFromXlsx(filePath) {
  const entries = listArchiveEntries(filePath);
  const sharedStringsXml = extractArchiveEntry(filePath, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const worksheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry))
    .slice(0, 10);
  const lines = [];

  for (const entry of worksheetEntries) {
    const xml = extractArchiveEntry(filePath, entry);
    if (!xml) continue;
    lines.push(...parseWorksheetXml(xml, sharedStrings));
  }

  return lines.join("\n");
}

function listArchiveEntries(filePath) {
  const result = spawnSync("tar", ["-tf", filePath], { encoding: "utf8", timeout: 1200 });
  if (result.status !== 0 || result.error) return [];
  return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function extractArchiveEntry(filePath, entry) {
  const result = spawnSync("tar", ["-xOf", filePath, entry], { encoding: "utf8", timeout: 1200 });
  if (result.status !== 0 || result.error) return "";
  return String(result.stdout || "");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si[\s\S]*?<\/si>/g), (match) => {
    const texts = Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (part) => decodeXmlEntities(part[1]));
    return texts.join("").trim();
  });
}

function parseWorksheetXml(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const inlineStringMatch = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      let value = "";
      if (inlineStringMatch) {
        value = decodeXmlEntities(inlineStringMatch[1]);
      } else if (valueMatch) {
        value = decodeXmlEntities(valueMatch[1]);
        if (/t="s"/.test(attrs)) {
          value = sharedStrings[Number(value)] || "";
        }
      }
      value = cleanupCellValue(value);
      if (value) values.push(value);
    }
    if (values.length > 0) {
      rows.push(values.join("\t"));
    }
  }
  return rows;
}

function cleanupCellValue(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanupExtractedText(text) {
  return String(text || "")
    .replace(/\\([()\\])/g, "$1")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsablePdfText(text) {
  const sample = String(text || "").slice(0, 4000);
  const badMarkers = (sample.match(/(?:Filter|FlateDecode|Type\/|XObject|BaseFont|FontDescriptor|ColorSpace|BitsPerComponent|DCTDecode|CIDFont|ToUnicode)/gi) || []).length;
  const slashTokens = (sample.match(/\/[A-Za-z][A-Za-z0-9]+/g) || []).length;
  const cyrillicWords = (sample.match(/[А-Яа-яЁё]{3,}/g) || []).length;
  const latinWords = (sample.match(/[A-Za-z]{4,}/g) || []).length;
  const naturalWords = cyrillicWords + latinWords;

  if (badMarkers >= 3) return false;
  if (slashTokens >= 8 && naturalWords < 12) return false;
  if (naturalWords < 6) return false;
  return true;
}

function detectAttachmentArticles(text) {
  return uniqueMatches(text.toUpperCase(), ARTICLE_PATTERN)
    .filter((value) => value.length >= 4)
    .filter((value) => /\d/.test(value))
    .filter((value) => !/^(ИНН|КПП|ОГРН)$/.test(value))
    .slice(0, 30);
}

function uniqueMatches(text, pattern) {
  return [...new Set(Array.from(String(text || "").matchAll(pattern), (match) => String(match[1] || match[0] || "").trim()).filter(Boolean))];
}
