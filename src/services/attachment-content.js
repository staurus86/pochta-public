import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "./detection-kb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_ROOT = path.resolve(__dirname, "../../data/attachments");
const PYTHON_ATTACHMENT_HELPER = path.resolve(__dirname, "../../scripts/extract_attachment_text.py");

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
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"]);

const INN_PATTERN = /\b\d{10,12}\b/g;
const KPP_PATTERN = /\b\d{9}\b/g;
const OGRN_PATTERN = /\b\d{13,15}\b/g;
const ARTICLE_PATTERN = /\b([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9./:_-]{2,})\b/gi;
const UNIT_PATTERN = /^(шт|штук[аи]?|ед|ед\.|pcs|pc|компл|к-т|set|м|кг|л|уп|рул|бух)$/i;
const OFFICE_XML_ARTICLE_NOISE_PATTERNS = [
  /^UTF-?8$/i,
  /^97-2003$/i,
  /^1TABLE$/i,
  /^(?:BG|LT|TX)\d{1,2}$/i,
  /^THEME(?:\/THEME){1,}(?:\/?\d+)?(?:\.XML(?:PK)?)?$/i,
  /^DRAWINGML\/\d{4}\/MAIN$/i,
  /^OPENXMLFORMATS(?:\/[A-Z0-9._-]+){1,}$/i,
  /^SCHEMAS(?:\/[A-Z0-9._:-]+){1,}$/i,
  /^RELATIONSHIPS(?:\/[A-Z0-9._:-]+){1,}$/i,
  /^CONTENT[-_ ]?TYPES$/i
];
const OFFICE_XML_TEXT_NOISE_PATTERNS = [
  /\b(?:_rels|docprops|\[content_types\]\.xml|content[_-]?types|word\/|xl\/|ppt\/)\b/i,
  /\b(?:schemas\.openxmlformats\.org|openxmlformats\.org|drawingml\/\d{4}\/main)\b/i,
  /\b(?:theme\/theme\/theme\d+\.xml(?:PK)?|word\.document\.\d)\b/i,
  /\bPK[\x03\x05\x07]/i
];
const PDF_INTERNAL_TEXT_NOISE_PATTERNS = [
  /\b(?:type\/font|subtype\/|cidfonttype2|fontdescriptor|cidtogidmap|colorspace\/device|filter\/flatedecode|xobject|objstm|xref|italicangle|fontbbox|fontfile2|length1|length2|length3|kids|capheight|ascent|descent|avgwidth|maxwidth|stemv|outputintent)\b/i,
  /\b(?:ns\.adobe\.com|purl\.org|www\.w3\.org\/1999\/02\/22-rdf|rdf-syntax-ns)\b/i,
  /^\s*(?:r\/f\d+|r\/gs\d+|r\/image\d+|image\d+|im\d+|gs\d+|ca\s+\d+|lc\s+\d+|lj\s+\d+|lw\s+\d+|ml\s+\d+)\s*$/i,
  /^\s*d:\d{8,14}\s*$/i,
  /^\s*feff[0-9a-f]{12,}\s*$/i,
  /^\s*[0-9a-f]{24,}\s*$/i,
  // PDF stream object markers and binary content
  /\b(?:endobj|endstream|startxref|\/Width|\/Height|\/Length\b|\/BitsPerComponent|\/DCTDecode|\/FlateDecode|\/Filter|\/BaseFont|\/FontDescriptor|\/ToUnicode|\/CIDFont|\/ColorSpace|\/XObject|\/Resources|\/MediaBox|\/CropBox|\/Rotate|\/Pages|\/Root|\/Info)\b/i,
  // PDF font metrics lines: "DW 1000", "W [67 [500 250]]", "/Ascent 891", "MaxWidth 2614"
  /^\s*(?:DW|W|CW)\s+[\d\[\].\s]+$/i,
  // PDF image dimension lines: standalone numbers after /Width or /Height context
  /\/(?:Width|Height)\s+\d+/i,
  // JPEG DCT decode markers (456789:CDEFGHIJSTUVWXYZ...)
  /\d{4,}:[A-Z]{6,}/i,
  // ICC color profile identifiers (IEC61966-2.1 = sRGB)
  /\bIEC\s*61966(?:[-.]?\d+)*\b/i,
  // PDF object references: "0 obj", "0 R", stream markers
  /^\s*\d+\s+\d+\s+(?:obj|R)\s*$/i,
  /^\s*(?:stream|endstream|endobj|xref|trailer)\s*$/i
];
const CSS_STYLE_TOKEN_PATTERN = /^(?:FONT|LINE|LETTER|WORD|TEXT|MARGIN|PADDING|BORDER|BACKGROUND|COLOR|WIDTH|HEIGHT|TOP|LEFT|RIGHT|BOTTOM|DISPLAY|POSITION)(?:-[A-Z]+)+:\S+$/i;
const WORD_INTERNAL_TOKEN_PATTERN = /^WW8[A-Z0-9]+$/i;
const WORD_STYLE_TOKEN_PATTERN = /^(?:WW-[A-Z0-9-]+|\d+ROMAN|V\d+)$/i;
const STANDARD_TOKEN_PATTERN = /^(?:IEC|ISO|EN|DIN)\d+(?:[-/.]\d+)*$/i;

export function analyzeStoredAttachments(messageKey, attachmentFiles = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const startedAt = Date.now();
  const files = [];
  const textParts = [];
  const articleTextParts = []; // excludes requisites/invoice files
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
      detectedOgrn: [],
      lineItems: [],
      fieldCoverage: {
        hasArticles: false,
        hasNames: false,
        hasQuantities: false,
        hasRequisites: false
      }
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

    if (IMAGE_EXTENSIONS.has(ext)) {
      result.reason = "ocr_unavailable_image";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (!TEXT_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext) && !OOXML_EXTENSIONS.has(ext) && !PHASE3_EXTENSIONS.has(ext)) {
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
        const pdfResult = extractTextFromPdf(filePath, buffer);
        extractedText = pdfResult.text || "";
        if (!extractedText && pdfResult.needsOcr) {
          result.reason = "ocr_unavailable_scan_pdf";
          result.preview = pdfResult.preview || null;
          files.push(result);
          skippedCount += 1;
          continue;
        }
      } else if (OOXML_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromOfficeOpenXml(filePath, ext);
      } else if (PHASE3_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromLegacyOfficeBuffer(buffer, ext);
      }

      const isTabular = TEXT_EXTENSIONS.has(ext) ? false : (ext === ".xlsx" || ext === ".csv" || ext === ".tsv");
      const cleanedFullText = cleanupExtractedText(extractedText);
      // For LLM / brand scan / preview: limit to maxExtractedCharsPerFile
      extractedText = cleanedFullText.slice(0, limits.maxExtractedCharsPerFile);
      // For tabular files: scan the full cleaned text for brand detection (brands can be in any row)
      const brandScanText = isTabular ? cleanedFullText : extractedText;
      if (!extractedText) {
        result.reason = "no_text_extracted";
        files.push(result);
        skippedCount += 1;
        continue;
      }

      if (PDF_EXTENSIONS.has(ext) && !isUsablePdfText(extractedText) && !hasUsefulExtractedSignals(extractedText)) {
        result.reason = "low_quality_pdf_text";
        result.preview = extractedText.slice(0, 200);
        files.push(result);
        skippedCount += 1;
        continue;
      }

      processedCount += 1;
      result.status = "processed";
      result.extractedChars = cleanedFullText.length;
      result.preview = extractedText.slice(0, 400);
      const isRequisitesFile = result.category === "requisites";
      // Requisites files: extract only sender fields (INN/KPP/OGRN). No articles, brands, or line items.
      result.detectedArticles = isRequisitesFile ? [] : detectAttachmentArticles(extractedText);
      result.detectedBrands = isRequisitesFile ? [] : detectionKb.detectBrands(brandScanText, []);
      result.detectedInn = uniqueMatches(extractedText, INN_PATTERN)
        .filter((value) => value.length === 10 || value.length === 12)
        .filter((value) => !value.startsWith("00")); // Real Russian INN never starts with 00 (region code 01-92)
      result.detectedKpp = uniqueMatches(extractedText, KPP_PATTERN);
      result.detectedOgrn = uniqueMatches(extractedText, OGRN_PATTERN).filter((value) => value.length === 13 || value.length === 15);
      // For tabular files: extract from full text (no row limit) — xlsx can have 400+ positions
      // For non-tabular: use truncated text to avoid processing noise from unstructured docs
      // Requisites files never have product line items — skip entirely
      result.lineItems = isRequisitesFile ? [] : extractAttachmentLineItems(
        isTabular ? cleanedFullText : extractedText,
        ext, result.filename
      );
      result.fieldCoverage = {
        hasArticles: result.detectedArticles.length > 0 || result.lineItems.some((item) => item.article),
        hasNames: result.lineItems.some((item) => item.descriptionRu),
        hasQuantities: result.lineItems.some((item) => item.quantity != null),
        hasRequisites: result.detectedInn.length > 0 || result.detectedKpp.length > 0 || result.detectedOgrn.length > 0
      };

      if (totalChars < limits.maxCombinedChars) {
        const remaining = limits.maxCombinedChars - totalChars;
        const chunk = extractedText.slice(0, remaining);
        if (chunk) {
          textParts.push(`Вложение: ${filename}\n${chunk}`);
          totalChars += chunk.length;
          // Requisites/invoice files contain company registration data, not product lists.
          // Exclude them from article extraction to prevent INN/ОКПО/KPP leaking as articles/quantities.
          if (!["requisites", "invoice"].includes(result.category)) {
            articleTextParts.push(`Вложение: ${filename}\n${chunk}`);
          }
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
    articleText: articleTextParts.join("\n\n").trim(),
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

// Patterns that identify company registration/requisites documents (DOC/DOCX).
// These contain INN/KPP/OGRN/OKPO/bank details — never product lists.
// Only sender fields (INN, company, email, name) should be extracted from them.
const REQUISITES_FILENAME_RE = /реквизит|карточк|карт[аы]?(?:[-_ ]|$)|контрагент|(?:^|[-_ ])(ООО|ОАО|ЗАО|ПАО|ИП|ТОО|LLP|LLC|GmbH)(?:[-_ ]|$)|(?:^|[-_ ])ТК(?:[-_ ]|$)|card|details|банк/i;

function categorizeAttachment(filename, ext, contentType) {
  const lower = String(filename || "").toLowerCase();
  // DOC/DOCX requisites files: company cards, registration details, bank requisites
  if (REQUISITES_FILENAME_RE.test(filename) && [".doc", ".docx", ".pdf"].includes(ext)) return "requisites";
  // Any file with explicit requisites/banking keywords
  if (/реквизит|карточк|контрагент|банк|details/i.test(lower)) return "requisites";
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
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }
  const utf16 = buffer.toString("utf16le");
  if (countNaturalWords(utf16) > countNaturalWords(utf8)) {
    return utf16;
  }
  return utf8;
}

function extractTextFromPdf(filePath, buffer) {
  const pyResult = extractPdfWithPython(filePath);
  if (pyResult.ok) {
    return {
      text: pyResult.text || "",
      needsOcr: Boolean(pyResult.needs_ocr),
      preview: String(pyResult.text || "").slice(0, 200),
      parser: pyResult.parser || "python"
    };
  }

  const fallbackText = extractTextFromPdfBuffer(buffer);
  return {
    text: fallbackText,
    needsOcr: false,
    preview: fallbackText.slice(0, 200),
    parser: "legacy"
  };
}

function extractPdfWithPython(filePath) {
  const result = spawnSync("python", [PYTHON_ATTACHMENT_HELPER, "pdf", filePath], {
    encoding: "utf8",
    timeout: 4000
  });
  if (result.status !== 0 || result.error) {
    return { ok: false, error: result.error?.message || result.stderr || result.stdout || "python_failed" };
  }
  try {
    return JSON.parse(String(result.stdout || "{}"));
  } catch {
    return { ok: false, error: "python_invalid_json" };
  }
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
  const pythonKind = ext === ".docx" ? "docx" : ext === ".xlsx" ? "xlsx" : null;
  if (pythonKind) {
    const pyResult = extractOoxmlWithPython(filePath, pythonKind);
    if (pyResult.ok && pyResult.text) {
      return pyResult.text;
    }
  }
  if (ext === ".docx") {
    return extractTextFromDocx(filePath);
  }
  if (ext === ".xlsx") {
    return extractTextFromXlsx(filePath);
  }
  return "";
}

function extractOoxmlWithPython(filePath, kind) {
  const result = spawnSync("python", [PYTHON_ATTACHMENT_HELPER, kind, filePath], {
    encoding: "utf8",
    timeout: 4000
  });
  if (result.status !== 0 || result.error) {
    return { ok: false, error: result.error?.message || result.stderr || result.stdout || "python_failed" };
  }
  try {
    return JSON.parse(String(result.stdout || "{}"));
  } catch {
    return { ok: false, error: "python_invalid_json" };
  }
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
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Strip JPEG DCT markers that leak from PDF binary streams (456789:CDEFGHIJSTUVWXYZ...)
    .replace(/\d{4,}:[A-Z]{6,}[A-Za-z]*/g, "")
    // Strip ICC color profile references (IEC61966-2.1 sRGB)
    .replace(/\bIEC\s*61966(?:[-.]?\d+)*/gi, "")
    // Strip PDF font metric fragments: "DW 1000", "/Ascent 891", "/MaxWidth 2614"
    .replace(/\/(?:Ascent|Descent|AvgWidth|MaxWidth|StemV|CapHeight|ItalicAngle|FontBBox|DW|CW|W)\s+[-\d\[\].\s]+/gi, "")
    // Strip PDF dimension fragments: "/Width 2480", "/Height 2338"
    .replace(/\/(?:Width|Height|Length|BitsPerComponent)\s+\d+/gi, "")
    // Strip Office binary structure markers (1Table, CompObj, WordDocument)
    .replace(/\b(?:1Table|0Table|CompObj|WordDocument|SummaryInformation|DocumentSummaryInformation)\b/gi, "")
    // Strip theme/xml paths with PK zip signatures
    .replace(/\b(?:theme\/theme\/theme\d+\.xml(?:PK)?|word\.document\.\d)\b/gi, "")
    // Strip PDF version markers (1.0, 2.0 at start of content)
    .replace(/(?:^|\s)(?:PDF-?\d+\.\d+|\d\.\d)(?:\s|$)/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n\t]+/g, " ").trim())
    .filter((line) => line
      && !OFFICE_XML_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(line))
      && !PDF_INTERNAL_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(line))
      // Filter lines that are mostly PDF object syntax
      && !isPdfBinaryNoiseLine(line))
    .join("\n")
    .trim();
}

function isPdfBinaryNoiseLine(line) {
  // Lines that are pure PDF object syntax: "12 0 obj", "endobj", "stream", "/Type /Font"
  if (/^\s*\d+\s+\d+\s+obj\s*$/.test(line)) return true;
  if (/^\s*(?:endobj|endstream|stream|startxref|xref|trailer)\s*$/i.test(line)) return true;
  // Lines with high ratio of PDF operators: /Name tokens
  const slashTokens = (line.match(/\/[A-Za-z]\w+/g) || []).length;
  if (slashTokens >= 3 && line.length < 200) return true;
  // Lines that are only numbers and brackets (font width arrays)
  if (/^\s*[\d\s\[\].,-]+\s*$/.test(line) && line.length > 10) return true;
  return false;
}

function extractTextFromLegacyOfficeBuffer(buffer, ext = "") {
  const chunks = [];
  for (const encoding of ["utf8", "utf16le", "latin1"]) {
    try {
      const decoded = buffer.toString(encoding);
      const strings = extractHumanReadableStrings(decoded, ext);
      if (strings) {
        chunks.push(strings);
      }
    } catch {
      // ignore decoding failures
    }
  }
  return [...new Set(chunks.filter(Boolean))].join("\n");
}

function extractHumanReadableStrings(text, ext = "") {
  const matches = String(text || "").match(/[A-Za-zА-Яа-яЁё0-9@"«»().,:;\/\\_+=\- ]{6,}/g) || [];
  const cleaned = matches
    .map((part) => cleanupExtractedText(part))
    .filter((part) => part.length >= 6)
    .filter((part) => !OFFICE_XML_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(part)))
    .filter((part) => !PDF_INTERNAL_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(part)))
    .filter((part) => !/^PK\b/.test(part))
    .filter((part) => countNaturalWords(part) > 0 || /\b\d{10,12}\b/.test(part) || /(?:ООО|АО|ОАО|ЗАО|ПАО|ИП)\b/.test(part));

  const joined = cleaned.join("\n");
  if (ext === ".doc" || ext === ".xls") {
    return joined.slice(0, 16000);
  }
  return joined.slice(0, 12000);
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

function countNaturalWords(text) {
  const sample = String(text || "").slice(0, 4000);
  return (sample.match(/[A-Za-zА-Яа-яЁё]{3,}/g) || []).length;
}

function hasUsefulExtractedSignals(text) {
  const sample = String(text || "").slice(0, 6000);
  return /\b\d{10,12}\b/.test(sample)
    || /\b(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП)\b/.test(sample)
    || /\b[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9./:_-]{4,}\b/.test(sample);
}

function detectAttachmentArticles(text) {
  return uniqueMatches(text.toUpperCase(), ARTICLE_PATTERN)
    .map((value) => normalizeAttachmentArticle(value))
    .filter(Boolean)
    // Reject pure numeric codes under 5 digits from loose attachment detection
    // (real short numeric articles like 615 are handled via line item extraction with context)
    .filter((value) => !/^\d{1,4}$/.test(value))
    .slice(0, 30);
}

function uniqueMatches(text, pattern) {
  return [...new Set(Array.from(String(text || "").matchAll(pattern), (match) => String(match[1] || match[0] || "").trim()).filter(Boolean))];
}

function extractAttachmentLineItems(text, ext, filename = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (ext === ".xlsx" || ext === ".csv" || ext === ".tsv") {
    return extractTabularLineItems(lines, filename);
  }
  return extractLooseAttachmentLineItems(lines, filename);
}

function extractTabularLineItems(lines, filename) {
  const rows = lines
    .map((line) => line.split(/\t|;{1,}/).map((cell) => cleanupCellValue(cell)).filter(Boolean))
    .filter((row) => row.length >= 2);

  if (rows.length === 0) return [];

  const headerRow = rows.find((row) => row.some((cell) => /артик|наимен|товар|кол-?во|колич|ед\.?|unit|qty/i.test(cell))) || rows[0];
  const articleIdx = findHeaderIndex(headerRow, /артик|sku|код|part/i);
  const nameIdx = findHeaderIndex(headerRow, /наимен|товар|описан|позици|product/i);
  const qtyIdx = findHeaderIndex(headerRow, /кол-?во|колич|qty|quantity/i);
  const unitIdx = findHeaderIndex(headerRow, /ед\.?|unit|uom/i);

  const startIndex = headerRow === rows[0] ? 1 : Math.max(rows.indexOf(headerRow) + 1, 1);
  const items = [];
  for (const row of rows.slice(startIndex)) {
    const article = normalizeAttachmentArticle(pickRowValue(row, articleIdx) || row.find(isAttachmentArticleCandidate) || "");
    const descriptionRu = cleanupAttachmentName(pickRowValue(row, nameIdx) || inferDescriptionFromRow(row, { articleIdx, qtyIdx, unitIdx }) || "");
    const quantity = parseAttachmentQuantity(pickRowValue(row, qtyIdx) || "");
    const unit = cleanupAttachmentUnit(pickRowValue(row, unitIdx) || inferUnitFromRow(row) || "шт");
    if (!article && !descriptionRu) continue;
    if (article && !/\d/.test(article)) continue;
    items.push({
      article: article || null,
      quantity,
      unit,
      descriptionRu: descriptionRu || null,
      source: `attachment:${filename || "table"}`
    });
  }

  return dedupeAttachmentLineItems(items);
}

function extractLooseAttachmentLineItems(lines, filename) {
  const items = [];
  for (const line of lines) {
    const article = normalizeAttachmentArticle(findArticleInText(line) || "");
    const quantity = parseAttachmentQuantity(line);
    const descriptionRu = cleanupAttachmentName(article ? line.replace(article, " ").trim() : line);
    if (!article) continue;
    items.push({
      article,
      quantity,
      unit: cleanupAttachmentUnit(inferUnitFromRow([line]) || "шт"),
      descriptionRu: descriptionRu || null,
      source: `attachment:${filename || "text"}`
    });
  }
  return dedupeAttachmentLineItems(items);
}

function dedupeAttachmentLineItems(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.article || ""}|${item.descriptionRu || ""}`.toUpperCase();
    if (!key.trim()) continue;
    if (!byKey.has(key)) {
      byKey.set(key, item);
      continue;
    }
    const current = byKey.get(key);
    if ((!current.quantity || current.quantity === 1) && item.quantity) current.quantity = item.quantity;
    if ((!current.descriptionRu || current.descriptionRu.length < (item.descriptionRu || "").length) && item.descriptionRu) current.descriptionRu = item.descriptionRu;
  }
  return [...byKey.values()];
}

function findHeaderIndex(row, pattern) {
  return row.findIndex((cell) => pattern.test(String(cell || "")));
}

function pickRowValue(row, index) {
  return index >= 0 ? row[index] || "" : "";
}

function inferDescriptionFromRow(row, { articleIdx, qtyIdx, unitIdx }) {
  return row
    .filter((cell, idx) => idx !== articleIdx && idx !== qtyIdx && idx !== unitIdx)
    .filter((cell) => !isAttachmentArticleCandidate(cell))
    .filter((cell) => !parseAttachmentQuantity(cell))
    .join(" ");
}

function inferUnitFromRow(row) {
  return row.find((cell) => UNIT_PATTERN.test(String(cell || "").trim())) || "";
}

function findArticleInText(text) {
  const matches = uniqueMatches(String(text || "").toUpperCase(), ARTICLE_PATTERN)
    .filter((value) => value.length >= 4)
    .filter((value) => /\d/.test(value));
  return matches[0] || null;
}

function isAttachmentArticleCandidate(value) {
  const article = normalizeAttachmentArticle(value);
  return Boolean(article && article.length >= 4 && /\d/.test(article));
}

function normalizeAttachmentArticle(value) {
  const cleaned = String(value || "").trim().replace(/^[#№]/, "");
  if (!cleaned) return "";
  const normalized = cleaned.toUpperCase();
  if (!/\d/.test(normalized)) return "";
  if (normalized.includes("@")) return "";
  if (/^(?:ИНН|КПП|ОГРН)$/.test(normalized)) return "";
  if (/^\d{10,15}$/.test(normalized)) return "";
  if (/^(?:8|7)?-?800(?:-\d{1,4}){1,}$/.test(normalized)) return "";
  if (/^\d{2,4}(?:-\d{2}){2,}$/.test(normalized)) return "";
  if (/^2BM-[A-Z0-9-]+$/i.test(normalized)) return "";
  // Engineering specs: DN50, PN16, G1/2 — but not article-like PN2271 (4+ digits)
  if (/^(?:DN\s*\d{1,4}|PN\s*\d{1,3}|NPS\s*\d+|G\s*\d+(?:[/.]\d+)?|R\s*\d+(?:[/.]\d+)?|RC\s*\d+(?:[/.]\d+)?|RP\s*\d+(?:[/.]\d+)?)$/i.test(normalized)) return "";
  if (/^CID:/i.test(normalized)) return "";
  if (/^[A-ZА-ЯЁ]{1,3}\s+\d{1,3}$/.test(normalized) && /^(?:DN|PN)$/i.test(normalized.split(/\s+/)[0])) return "";
  if (OFFICE_XML_ARTICLE_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return "";
  if (PDF_INTERNAL_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return "";
  if (/^(?:R\/[A-Z0-9]+|TYPE\/[A-Z0-9/_-]+|[A-Z]+\/[A-Z0-9/_-]+)$/i.test(normalized)) return "";
  if (/^(?:\d+\/[A-Z][A-Z0-9/_-]*|[A-Z][A-Z0-9/_-]*\/\d+)$/i.test(normalized)) return "";
  if (/^(?:TYPE\d+|PDF-\d(?:\.\d+)?|C\d+_\d+)$/i.test(normalized)) return "";
  if (CSS_STYLE_TOKEN_PATTERN.test(normalized)) return "";
  if (WORD_INTERNAL_TOKEN_PATTERN.test(normalized)) return "";
  if (WORD_STYLE_TOKEN_PATTERN.test(normalized)) return "";
  if (STANDARD_TOKEN_PATTERN.test(normalized)) return "";
  if (/^\d+\.\d{2,5}$/.test(normalized)) return "";
  // Version numbers: 1.0, 2.0, 0.0, 3.0, decimal dimensions: 595.2, 841.9
  if (/^\d{1,4}\.\d{1,2}$/.test(normalized)) return "";
  if (/^EOF\s+\d+$/i.test(normalized)) return "";
  if (/^65535$/.test(normalized)) return "";
  if (/^\d{20}$/.test(normalized)) return "";
  if (/^0+\d*$/.test(normalized)) return "";
  // PDF Unicode escape residue: 000A, 000C, 004A, 004O etc.
  if (/^0{2,}\d?[A-Z]$/i.test(normalized)) return "";
  if (/^\d{5,}:[A-Z]{8,}$/i.test(normalized)) return "";
  if (/^(?:XML|DOCX|XLSX|WORD|EXCEL)\/[A-Z0-9/_-]+$/i.test(normalized)) return "";
  // Reject year-like numbers 1990-2039 (never real articles in attachments)
  if (/^(?:19\d{2}|20[0-3]\d)$/.test(normalized)) return "";
  // Reject ICC color profile and standard identifiers
  if (/^IEC\d/i.test(normalized)) return "";
  // Reject known PDF dimension/metric values (common A4/A3 at various DPI, font metrics)
  if (/^(?:2480|2338|1653|1169|842|595|1240|1754|3508|4961|3307|2339|2614|2558|1000|65535)$/.test(normalized)) return "";
  // Reject JPEG DCT marker residue
  if (/^\d+:[A-Z]{4,}/.test(normalized)) return "";
  // CSS vendor-prefixed tokens: MS-TEXT-SIZE-ADJUST:100, WEBKIT-*
  if (/^(?:MS|WEBKIT|MOZ|O)-[A-Z-]+:\d/i.test(normalized)) return "";
  // PDF font/metadata names: GTS_PDFA1, CAOLAN80, ALLLEX86, ALFABY2X, CALIBRI1, ARIAL1, CYR1
  if (/^(?:GTS_PDF|CAOLAN|ADOBE\d|ALLLEX|ALFABY|CALIBRI\d|ARIAL\d|TIMES\d|CYR\d)/i.test(normalized)) return "";
  if (/^\d+ROMAN$/i.test(normalized)) return "";
  // Date patterns: 01-2026, 03-2025
  if (/^\d{2}-(?:19|20)\d{2}$/.test(normalized)) return "";
  // Simple fractions/thread sizes: 1/2, 1/4, 1/1, 10/2 (without prefix like G or M)
  if (/^\d{1,2}\/\d{1,2}$/.test(normalized)) return "";
  // Office document paths and filenames: DRS/E2ODOC.XML, drs/e2oDoc.xmlPK, e2oDoc.xml
  if (/^DRS\//i.test(normalized) || /\.XMLPK$/i.test(normalized)) return "";
  if (/^E2ODOC/i.test(normalized)) return "";
  // Hash-like strings (24+ uppercase without separators)
  if (/^[A-Z0-9]{24,}$/.test(normalized)) return "";
  // Bank account/BIK/corr.account patterns: 30101810*, 40702810*, 04452*
  if (/^(?:301|407|044)\d{5,17}$/.test(normalized)) return "";
  // KPP (9 digits ending in 001/01): 390601001, 771801001
  if (/^\d{9}$/.test(normalized) && /001$/.test(normalized)) return "";
  // Russian postal indexes (6 digits): 600014, 107031
  if (/^\d{6}$/.test(normalized)) return "";
  // OKVED classifier codes: 46.69.5, 46.69.9
  if (/^\d{2}\.\d{2}\.\d{1,3}$/.test(normalized)) return "";
  // URL slugs with multiple English words: fdmrn8c0b-bilge-level-switch-float
  if (/^[a-z0-9]+-[a-z]+-[a-z]+-[a-z]+/i.test(normalized) && normalized.length > 20) return "";
  // Strings containing commas (addresses, multi-value fields) — never valid articles
  if (normalized.includes(",")) return "";
  // Strings > 40 chars — too long for article codes
  if (normalized.length > 40) return "";
  return normalized;
}

function parseAttachmentQuantity(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if (!match) return null;
  const parsed = Number(match[1].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanupAttachmentUnit(value) {
  const unit = String(value || "").trim();
  return unit || "шт";
}

function cleanupAttachmentName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (isAttachmentArticleCandidate(text)) return "";
  if (UNIT_PATTERN.test(text)) return "";
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return "";
  if (/^(?:юридический\s+и\s+фактический|юридический|фактический|почтовый)\b/i.test(text)) return "";
  if (/^(артикул|наименование|товар|позиция|количество|qty|quantity|unit)$/i.test(text)) return "";
  return text;
}
