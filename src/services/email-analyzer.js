import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchCompanyInCrm } from "./crm-matcher.js";
import { detectionKb } from "./detection-kb.js";
import { hybridClassify, isAiEnabled, getAiConfig } from "./ai-classifier.js";

// Product types database for request type detection and entity extraction
const __analyzerDir = path.dirname(fileURLToPath(import.meta.url));
let productTypes = null;
let productKeywords = null;
try {
  productTypes = JSON.parse(readFileSync(path.resolve(__analyzerDir, "../../data/product-types.json"), "utf8"));
  // Build flat keyword sets for quick lookup
  const allRu = new Set();
  const allEn = new Set();
  for (const cat of Object.values(productTypes.categories)) {
    (cat.ru || []).forEach((w) => allRu.add(w.toLowerCase()));
    (cat.en || []).forEach((w) => allEn.add(w.toLowerCase()));
  }
  productKeywords = { ru: allRu, en: allEn, signals: productTypes.requestSignals || [] };
} catch {
  productKeywords = { ru: new Set(), en: new Set(), signals: [] };
}

const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const PHONE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
const PHONE_LIKE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/i;
const PHONE_LABEL_PATTERN = /(?:тел|телефон|phone|моб|mobile|факс|fax|whatsapp|viber)\s*[:#-]?\s*((?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})/i;
const CONTACT_CONTEXT_PATTERN = /\b(?:тел|телефон|phone|моб|mobile|факс|fax|whatsapp|viber|email|e-mail|почта)\b/i;
const IDENTIFIER_CONTEXT_PATTERN = /\b(?:инн|inn|кпп|kpp|огрн|ogrn|request\s*id|order\s*id|ticket\s*id|номер\s*заявки|идентификатор)\b/i;
const INN_PATTERN = /(?:ИНН|inn)\s*[:#-]?\s*(\d{10,12})/i;
const KPP_PATTERN = /(?:КПП|kpp)\s*[:#-]?\s*(\d{9})/i;
const OGRN_PATTERN = /(?:ОГРН|ogrn)\s*[:#-]?\s*(\d{13,15})/i;
const ARTICLE_PATTERN = /(?:арт(?:икул(?:а|у|ом|е|ы|ов|ам|ами|ах)?)?|sku)\b[^A-Za-zА-Яа-я0-9]{0,5}([A-Za-z0-9][A-Za-z0-9-/_]{2,})/gi;
const STANDALONE_CODE_PATTERN = /\b([A-Z][A-Z0-9]{2,}[-/.]?[A-Z0-9]{2,}(?:[-/.][A-Z0-9]+)*)\b/g;
// Numeric article: 509-1720, 3HAC12345-1, 6GK7-343-2AH01, 233.50.100
const NUMERIC_ARTICLE_PATTERN = /\b(\d{2,6}[-/.]\d{2,6}(?:[-/.][A-Za-z0-9]{1,6})*)\b/g;
// Date-like patterns to exclude from numeric articles: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY
const DATE_LIKE_PATTERN = /^(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])(?:[-/.]\d{2,4})?$/;
// Voltage/electrical spec patterns to exclude from articles
const VOLTAGE_PATTERN = /^\d{1,5}[/]\d{1,5}$/;  // 230/400, 10000/400, 1000/1500
// Extended article pattern: supports dots (233.50.100), colons (VV64:KMD), mixed alpha-num + Cyrillic
const EXTENDED_CODE_PATTERN = /\b([A-Za-zА-ЯЁа-яё][A-Za-zА-ЯЁа-яё0-9]{0,}[-/:.][A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:.]{0,25})\b/g;
// Mixed Cyrillic+Latin+digits code (АИР100S4) — \b doesn't work with Cyrillic in JS
const CYRILLIC_MIXED_CODE_PATTERN = /(?:^|[\s,;:(])([А-ЯЁа-яё]{1,5}[0-9][A-Za-zА-ЯЁа-яё0-9/.-]{2,20})/gm;
// Reverse: digits first then Cyrillic (100А13/1.5Т220)
const DIGITS_CYRILLIC_CODE_PATTERN = /(?:^|[\s,;:(])(\d{1,5}[А-ЯЁа-яё][A-Za-zА-ЯЁа-яё0-9/.-]{2,20})/gm;
// Series + model: "CR 10-3", "WDU 2.5", "EV220B 032U1240" — letter code + space + number/code
const SERIES_MODEL_PATTERN = /\b([A-Z]{2,6})\s+(\d{1,3}(?:[-/.]\d{1,4})?(?:[-/][A-Z0-9]+)?)\b/g;
// Numbered list item: "1. Description ARTICLE" or "1) Description ARTICLE"
const NUMBERED_ITEM_PATTERN = /^\s*\d{1,3}[.)]\s+/;
// Product line with quantity: "Description - N шт" or "Description - N.NN шт"
const PRODUCT_QTY_PATTERN = /[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)?\.?\s*$/i;
const BRAND_CONTEXT_PATTERN = /\b(?:бренд|brand|производител[ья]|manufacturer|vendor|марка)\b/i;
const REQUISITES_CONTEXT_PATTERN = /\b(?:реквизит|карточк[аи]|company details|legal details)\b/i;
const QUOTE_PATTERNS = [
  /^>+\s?/,
  /^On .+ wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Пересланное сообщение\s*-{2,}$/i,
  /^-{2,}\s*Исходное сообщение\s*-{2,}$/i,
  /^\d{1,2}[./]\d{1,2}[./]\d{2,4}.*(?:wrote|написал|пишет)/i,
  /^(?:From|Sent|To|Cc|От|Отправлено|Кому|Тема):\s/i
];
const SIGNATURE_PATTERNS = [
  /^--\s*$/,
  /^_{3,}$/,
  /^С уважением[,.]?\s*/i,
  /^Best regards[,.]?\s*/i,
  /^Kind regards[,.]?\s*/i,
  /^Regards[,.]?\s*/i,
  /^Спасибо[,.]?\s*/i,
  /^Sent from my /i,
  /^Отправлено с /i
];

// Own company domains — emails FROM these are not customer companies
const OWN_DOMAINS = new Set([
  "siderus.su", "siderus.online", "siderus.ru", "klvrt.ru",
  "ersab2b.ru", "itec-rus.ru", "paulvahle.ru", "petersime-rus.ru",
  "rstahl.ru", "schimpfdrive.ru", "schischekrus.ru", "sera-rus.ru",
  "serfilco-ru.ru", "vega-automation.ru", "waldner-ru.ru", "kiesel-rus.ru",
  "maximator-ru.ru", "stromag-ru.ru", "endress-hauser.pro"
]);

// Brand names that should not be detected as articles or company names
const BRAND_NOISE = new Set([
  "SIDERUS", "KOLOVRAT", "KLVRT", "ERSA", "ITEC", "SCHISCHEK", "SERA", "SERFILCO", "VEGA",
  "WALDNER", "KIESEL", "MAXIMATOR", "STROMAG", "SCHIMPF", "PETERSIME",
  "ENDRESS", "HAUSER", "STAHL", "VAHLE"
]);

const BRAND_FALSE_POSITIVE_ALIASES = new Set([
  "top", "moro", "ydra", "hydra", "global"
]);

const GENERIC_IMAGE_ATTACHMENT_PATTERN =
  /^(?:img|image|photo|scan|scanner|whatsapp(?:\s+image)?|dsc|pict|screenshot|screen-shot|file)[-_ ]*\d[\w-]*$/i;

export function analyzeEmail(project, payload) {
  const subject = String(payload.subject || "");
  const rawBody = String(payload.body || "");
  const body = stripHtml(rawBody);
  const { newContent, quotedContent } = separateQuotedText(body);
  const { body: primaryBody, signature } = extractSignature(newContent);
  const bodyForSender = [primaryBody, signature].filter(Boolean).join("\n\n") || body;
  let rawFrom = String(payload.fromEmail || "").trim();
  let fromEmail = rawFrom.toLowerCase();
  let fromName = String(payload.fromName || "").trim();
  // Parse "Name <email>" format
  const chevronMatch = rawFrom.match(/<?([^\s<>]+@[^\s<>]+)>?/);
  if (chevronMatch) {
    fromEmail = chevronMatch[1].toLowerCase();
    if (!fromName) {
      const nameMatch = rawFrom.match(/^(.+?)\s*</);
      if (nameMatch) fromName = nameMatch[1].replace(/["']/g, "").trim();
    }
  }
  const attachments = normalizeAttachments(payload.attachments);

  // If this is a forwarded email, extract original sender from body
  const fwdInfo = extractForwardedSender(body);
  if (fwdInfo) {
    if (fwdInfo.email && !fromEmail.includes(fwdInfo.email.split("@")[1])) {
      fromEmail = fwdInfo.email;
      if (fwdInfo.name) fromName = fwdInfo.name;
    }
  }

  const normalizedText = [subject, body, attachments.join(" ")].join("\n");

  const classification = classifyMessage({
    subject,
    body: primaryBody || body,
    attachments,
    fromEmail,
    projectBrands: project.brands || []
  });
  // Filter own brands (Siderus, Коловрат, etc.) from classification results
  classification.detectedBrands = detectionKb.filterOwnBrands(classification.detectedBrands);
  const sender = extractSender(fromName, fromEmail, bodyForSender, attachments);
  const lead = extractLead(subject, primaryBody || body, attachments, project.brands || [], classification.detectedBrands);
  const crm = matchCompanyInCrm(project, { sender, detectedBrands: lead.detectedBrands, lead });

  const suggestedReply = buildSuggestedReply(classification.label, sender, lead, crm);

  return {
    analysisId: randomUUID(),
    createdAt: new Date().toISOString(),
    mailbox: project.mailbox,
    classification,
    sender,
    lead,
    crm,
    detectedBrands: detectionKb.filterOwnBrands(lead.detectedBrands),
    intakeFlow: buildIntakeFlow(classification.label, crm, lead),
    suggestedReply,
    rawInput: {
      subject,
      attachments
    },
    extractionMeta: {
      signatureDetected: Boolean(signature),
      quotedTextDetected: Boolean(quotedContent)
    }
  };
}

/**
 * Async version of analyzeEmail that uses AI classification for uncertain cases.
 * Falls back to pure rules-based when AI is disabled.
 */
export async function analyzeEmailAsync(project, payload) {
  const result = analyzeEmail(project, payload);

  if (!isAiEnabled()) return result;

  try {
    const enhanced = await hybridClassify(result.classification, {
      subject: payload.subject || "",
      body: payload.body || "",
      fromEmail: payload.fromEmail || "",
      attachments: normalizeAttachments(payload.attachments)
    });

    // Merge AI-detected brands with rule-detected brands
    if (enhanced.detectedBrands?.length) {
      const allBrands = [...new Set([...result.detectedBrands, ...detectionKb.filterOwnBrands(enhanced.detectedBrands)])];
      result.detectedBrands = allBrands;
    }

    result.classification = enhanced;
    result.aiConfig = getAiConfig();
  } catch {
    // AI failure — use rules result silently
  }

  return result;
}

function normalizeAttachments(attachments) {
  if (Array.isArray(attachments)) {
    return attachments.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof attachments === "string") {
    return attachments.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function classifyMessage({ subject, body, attachments, fromEmail, projectBrands }) {
  const knowledgeResult = detectionKb.classifyMessage({
    subject,
    body,
    attachments,
    fromEmail,
    projectBrands
  });

  return {
    label: knowledgeResult.label,
    confidence: knowledgeResult.confidence,
    detectedBrands: knowledgeResult.detectedBrands,
    signals: {
      clientScore: knowledgeResult.scores.client,
      spamScore: knowledgeResult.scores.spam,
      vendorScore: knowledgeResult.scores.vendor,
      matchedRules: knowledgeResult.matchedRules
    }
  };
}

function extractSender(fromName, fromEmail, body, attachments) {
  const urls = body.match(URL_PATTERN) || [];
  const phones = body.match(PHONE_PATTERN) || [];
  const requisites = extractRequisites(body);
  // Filter out own URLs from detected links
  const externalUrls = urls.filter((u) => !OWN_DOMAINS.has(extractDomainFromUrl(u)));
  const companyName = extractCompanyName(body) || inferCompanyNameFromEmail(fromEmail);
  const fullName = fromName || extractFullNameFromBody(body) || "Не определено";
  const position = extractPosition(body) || null;
  const website = externalUrls[0] || inferWebsiteFromEmail(fromEmail);
  const { cityPhone, mobilePhone } = splitPhones(phones, body);
  const legalCardAttached = attachments.some((item) => /реквиз|card|details/i.test(item));

  return {
    email: fromEmail,
    fullName,
    position,
    companyName,
    website,
    cityPhone,
    mobilePhone,
    inn: requisites.inn,
    kpp: requisites.kpp,
    ogrn: requisites.ogrn,
    legalCardAttached
  };
}

function detectUrgency(text) {
    const urgentPatterns = [
        /срочн|urgent|asap|немедленн|в кратчайш|до конца дня|сегодня/i,
        /простой|стоит линия|стоит оборудование|авари[йя]/i
    ];
    for (const p of urgentPatterns) {
        if (p.test(text)) return "urgent";
    }
    const plannedPatterns = [
        /плановая|план(?:ируем|овый)|ближайш|на следующ/i
    ];
    for (const p of plannedPatterns) {
        if (p.test(text)) return "planned";
    }
    return "normal";
}

function extractLead(subject, body, attachments, brands, kbBrands = []) {
  const freeText = body.trim().slice(0, 2000);
  const searchText = [subject, body].join("\n");
  const forbiddenDigits = collectForbiddenArticleDigits(body);
  const prefixedArticles = Array.from(body.matchAll(ARTICLE_PATTERN))
    .map((match) => normalizeArticleCode(match[1]))
    .filter((item) => isLikelyArticle(item, forbiddenDigits));
  const standaloneArticles = extractStandaloneCodes(body, forbiddenDigits);
  const numericArticles = extractNumericArticles(body, forbiddenDigits);
  const subjectArticles = extractArticlesFromSubject(subject, forbiddenDigits);
  const attachmentArticles = extractArticlesFromAttachments(attachments, forbiddenDigits);
  const brandAdjacentCodes = extractBrandAdjacentCodes(body, forbiddenDigits);
  const allArticles = unique([...subjectArticles, ...prefixedArticles, ...standaloneArticles, ...numericArticles, ...attachmentArticles, ...brandAdjacentCodes].filter(Boolean));
  const attachmentsText = attachments.join(" ");
  const hasNameplatePhotos = /шильд|nameplate/i.test(attachmentsText);
  const hasArticlePhotos = /артик|sku|label/i.test(attachmentsText);
  const lineItems = extractLineItems(body).filter((item) =>
    item.explicitArticle || isLikelyArticle(item.article, forbiddenDigits, item.descriptionRu)
  );
  const rawBrands = unique(kbBrands.concat(detectBrands([subject, body, attachmentsText].join("\n"), brands)));
  let detectedBrands = detectionKb.filterOwnBrands(rawBrands);

  const attachmentHints = parseAttachmentHints(attachments);

  const detectedProductTypes = detectProductTypes([subject, body].join("\n"));
  const explicitArticles = lineItems
    .filter((item) => item.explicitArticle)
    .map((item) => normalizeArticleCode(item.article));
  const finalArticles = unique(allArticles.concat(lineItems.map((item) => normalizeArticleCode(item.article))).filter(Boolean))
    .filter((article) => !explicitArticles.some((full) => full !== article && full.includes(article) && article.length + 2 <= full.length));
  const nomenclatureMatches = finalArticles
    .map((article) => {
      const candidates = detectionKb.findNomenclatureCandidates({
        article,
        text: searchText,
        brands: detectedBrands,
        limit: 3
      });
      return candidates.find((item) => normalizeArticleCode(item.article) === normalizeArticleCode(article)) || candidates[0] || null;
    })
    .filter(Boolean);

  detectedBrands = detectionKb.filterOwnBrands(unique([
    ...detectedBrands,
    ...nomenclatureMatches.map((item) => item.brand).filter(Boolean)
  ]));

  const productNames = extractProductNames(
    searchText,
    finalArticles,
    detectedProductTypes,
    nomenclatureMatches,
    lineItems
  );

  const urgency = detectUrgency([subject, body].join("\n"));

  // Enrich lineItems descriptionRu from productNames
  for (const item of lineItems) {
      if (item.article) {
          const pn = productNames.find((p) => normalizeArticleCode(p.article) === normalizeArticleCode(item.article));
          if ((!item.descriptionRu || item.descriptionRu === item.article) && pn?.name) {
              item.descriptionRu = pn.name;
          }
      }
  }

  return {
    freeText,
    hasNameplatePhotos,
    hasArticlePhotos,
    articles: finalArticles,
    lineItems,
    totalPositions: lineItems.length || finalArticles.length,
    detectedBrands,
    detectedProductTypes,
    productNames,
    nomenclatureMatches: nomenclatureMatches.map((item) => ({
      article: item.article,
      brand: item.brand || null,
      productName: item.product_name || null,
      description: item.description || null,
      sourceRows: item.source_rows || 0,
      avgPrice: item.avg_price ?? null,
      matchType: item.match_type || "semantic"
    })),
    urgency,
    attachmentHints,
    requestType: detectedBrands.length > 1 ? "Мультибрендовая" : detectedBrands.length === 1 ? "Монобрендовая" : finalArticles.length > 0 || detectedProductTypes.length > 0 ? "Не определено (есть артикулы)" : "Не определено"
  };
}

function extractProductNames(text, articles, detectedProductTypes, nomenclatureMatches = [], lineItems = []) {
  const productNames = [];
  const lower = text.toLowerCase();
  const nomenclatureByArticle = new Map(
    (nomenclatureMatches || []).map((item) => [normalizeArticleCode(item.article), item])
  );
  const lineItemByArticle = new Map(
    (lineItems || [])
      .filter((item) => item?.article)
      .map((item) => [normalizeArticleCode(item.article), item])
  );

  for (const article of articles) {
    const articleLower = article.toLowerCase();
    const articleIdx = lower.indexOf(articleLower);
    const nomenclatureMatch = nomenclatureByArticle.get(normalizeArticleCode(article)) || null;
    const lineItem = lineItemByArticle.get(normalizeArticleCode(article)) || null;
    if (articleIdx === -1 && !nomenclatureMatch) continue;

    const lineItemName = extractProductNameFromLineItem(lineItem, article);

    // Look at 60 chars before the article for context
    const contextStart = articleIdx >= 0 ? Math.max(0, articleIdx - 60) : 0;
    const context = articleIdx >= 0 ? lower.slice(contextStart, articleIdx).trim() : "";

    // Try to match a product type keyword from the context
    let productName = null;
    let matchedCategory = null;
    if (productTypes?.categories) {
      for (const [category, data] of Object.entries(productTypes.categories)) {
        for (const keyword of [...(data.ru || []), ...(data.en || [])]) {
          if (context.includes(keyword.toLowerCase())) {
            const keyIdx = context.lastIndexOf(keyword.toLowerCase());
            const nameCandidate = text.slice(contextStart + keyIdx, articleIdx).trim();
            if (nameCandidate.length > 2 && nameCandidate.length < 80) {
              productName = nameCandidate;
              matchedCategory = category;
            }
            break;
          }
        }
        if (productName) break;
      }
    }

    productNames.push({
      article,
      name: lineItemName || sanitizeProductNameCandidate(productName) || nomenclatureMatch?.product_name || null,
      category: matchedCategory || inferCategoryFromNomenclature(nomenclatureMatch, detectedProductTypes) || null
    });
  }

  return productNames;
}

function extractProductNameFromLineItem(lineItem, article) {
  const description = cleanup(lineItem?.descriptionRu || "");
  if (!description) return null;

  const normalizedArticle = normalizeArticleCode(article);
  const articleIndex = normalizedArticle
    ? description.toLowerCase().indexOf(normalizedArticle.toLowerCase())
    : -1;

  let candidate = articleIndex >= 0 ? description.slice(0, articleIndex).trim() : description;
  candidate = candidate
    .replace(/(?:^|.*?:\s*)(\d+\.\s*)/i, "$1")
    .replace(/^(?:здравствуйте|добрый день|добрый вечер)[.!]?\s*/i, "")
    .replace(/^(?:просим|прошу)\s+(?:прислать|выставить|направить|подготовить)\s+(?:сч[её]т|кп|коммерческое предложение)[^:]*:\s*/i, "")
    .replace(/^(?:на\s+следующие\s+позиции|следующие\s+позиции)\s*:?\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();

  return sanitizeProductNameCandidate(candidate);
}

function sanitizeProductNameCandidate(value) {
  let candidate = cleanup(value);
  if (!candidate) return null;

  candidate = candidate
    .replace(/\s*[-–—]\s*\d+(?:[.,]\d+)?\s*(?:шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\.?.*$/i, "")
    .replace(/\b(?:прописать|указать|сообщить)\s+срок[^\n]*$/i, "")
    .replace(/\bкарточк[аи]\s+предприятия[^\n]*$/i, "")
    .replace(/\bво\s+вложени[ияи]\b.*$/i, "")
    .replace(/\bс\s+уважением\b.*$/i, "")
    .replace(/\bпономарева\b.*$/i, "")
    .replace(/\b(?:ООО|АО|ПАО|ОАО|ЗАО|ИП)\b.*$/i, "")
    .replace(/[;,.:\s-]+$/g, "")
    .trim();

  if (!candidate) return null;
  if (candidate.length < 3) return null;
  if (/^(?:просим|прошу|здравствуйте|добрый день|на следующие позиции)/i.test(candidate)) return null;
  if (/^(?:сч[её]т|кп|коммерческое предложение)$/i.test(candidate)) return null;
  return candidate;
}

function detectProductTypes(text) {
  if (!productTypes?.categories) return [];
  const lower = text.toLowerCase();
  const found = [];
  for (const [category, data] of Object.entries(productTypes.categories)) {
    for (const keyword of data.ru || []) {
      if (lower.includes(keyword.toLowerCase())) {
        if (!found.includes(category)) found.push(category);
        break;
      }
    }
    if (found.includes(category)) continue;
    for (const keyword of data.en || []) {
      if (lower.includes(keyword.toLowerCase())) {
        if (!found.includes(category)) found.push(category);
        break;
      }
    }
  }
  return found;
}

function inferCategoryFromNomenclature(match, detectedProductTypes = []) {
  if (!match) return detectedProductTypes[0] || null;
  const haystack = [match.product_name, match.description].filter(Boolean).join(" ").toLowerCase();
  for (const [category, data] of Object.entries(productTypes?.categories || {})) {
    const keywords = [...(data.ru || []), ...(data.en || [])];
    if (keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
      return category;
    }
  }
  return detectedProductTypes[0] || null;
}

function buildIntakeFlow(classification, crm, lead) {
  return {
    parseToFields: classification !== "СПАМ",
    requestClarification: crm.needsClarification,
    createClientInCrm: classification === "Клиент" && !crm.isExistingCompany,
    createRequestInCrm: classification === "Клиент",
    assignMop: crm.curatorMop,
    assignMoz: crm.curatorMoz,
    requestType: lead.requestType
  };
}

// Own company name patterns — not a customer
const OWN_COMPANY_NAMES = /(?:сидерус|siderus|коловрат|kolovrat|klvrt|ersa\s*b2b|ersab2b)/i;

// Legal entity forms used as direct fallback patterns
const LEGAL_ENTITY_PATTERNS = [
  // With quotes: ООО «Ромашка», АО "Техно"
  /(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП)\s+["«]([^"»]+)["»]/,
  // ИП Фамилия Имя Отчество
  /(?<![А-ЯЁа-яё])ИП\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.|\s+[А-ЯЁ][а-яё]+){1,2})/,
  // Without quotes but capitalized: ООО Ромашка, АО Техно
  /(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП)\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\s-]{2,35}?)(?:\s*[,.\n]|\s+(?:ИНН|ОГРН|тел|адрес|г\.|ул\.))/,
  // International: Siemens AG, Endress+Hauser GmbH
  /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:GmbH|AG|Ltd\.?|LLC|Inc\.?|SE|S\.A\.|B\.V\.)/,
  // Завод/фабрика/комбинат patterns
  /([А-ЯЁ][А-ЯЁа-яё-]+\s+(?:завод|фабрика|комбинат|предприятие))/i,
];

function extractCompanyName(body) {
  const fromKb = detectionKb.matchField("company_name", body);
  if (fromKb) {
    const cleaned = cleanup(fromKb);
    if (OWN_COMPANY_NAMES.test(cleaned)) return null;
    return cleaned;
  }

  // Fallback: direct regex search for legal entity forms
  for (const pattern of LEGAL_ENTITY_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      // match[0] is full match including prefix (ООО, АО etc.)
      const name = cleanup(match[0]).trim();
      if (OWN_COMPANY_NAMES.test(name)) return null;
      if (name.length >= 5) return name;
    }
  }

  return null;
}

function inferCompanyNameFromEmail(email) {
  // Domain names are NOT company names — real companies are ООО, АО, ЗАО, etc.
  // Domain is only useful as a hint, not as companyName shown on dashboard
  return null;
}

function inferWebsiteFromEmail(email) {
  const domain = email.split("@")[1];
  if (!domain || isFreeDomain(email)) {
    return null;
  }

  return `https://${domain}`;
}

function isFreeDomain(email) {
  const domain = email.split("@")[1];
  return new Set([
    "gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru",
    "hotmail.com", "outlook.com", "icloud.com", "me.com", "live.com", "yahoo.com",
    "rambler.ru", "ro.ru", "autorambler.ru", "myrambler.ru", "lenta.ru",
    "aol.com", "protonmail.com", "proton.me", "zoho.com",
    "tilda.ws", "tilda.cc", "snipermail.com"
  ]).has(domain);
}

function isOwnDomain(domain) {
  return OWN_DOMAINS.has(domain);
}

function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractFullNameFromBody(body) {
  return detectionKb.matchField("signature_hint", body) || null;
}

function extractPosition(body) {
  const position = detectionKb.matchField("position", body);
  return position ? cleanup(position) : null;
}

function normalizePhoneNumber(raw) {
  const digits = raw.replace(/\D/g, "");
  // Expect 11 digits starting with 7 or 8
  let d = digits;
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  if (d.length !== 11 || !d.startsWith("7")) return null;
  const code = d.slice(1, 4);
  // Valid Russian area/mobile codes:
  // 2xx - some regions, 3xx - Siberia/Ural, 4xx - Central/Volga
  // 5xx - some regions, 8xx - toll-free (800,8xx), 9xx - mobile
  // Invalid: 0xx, 1xx, 6xx, 7xx
  if (/^[0167]/.test(code)) return null;
  return `+7 (${code}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

function isValidPhone(raw) {
  return normalizePhoneNumber(raw) !== null;
}

function isMobilePhone(normalized) {
  // Russian mobile codes start with 9
  return /\+7 \(9\d{2}\)/.test(normalized);
}

function isTollFreePhone(normalized) {
  return /\+7 \(80[0-9]\)/.test(normalized);
}

function splitPhones(phones, body = "") {
  const validated = unique((phones || []).map((phone) => normalizePhoneNumber(phone)).filter(Boolean));
  const explicitlyLabeled = body.match(PHONE_LABEL_PATTERN)?.[1] ? normalizePhoneNumber(body.match(PHONE_LABEL_PATTERN)[1]) : null;

  if (explicitlyLabeled) {
    const preferredMobile = isMobilePhone(explicitlyLabeled);
    return {
      cityPhone: preferredMobile ? validated.find((phone) => phone !== explicitlyLabeled) || null : explicitlyLabeled,
      mobilePhone: preferredMobile ? explicitlyLabeled : validated.find((phone) => phone !== explicitlyLabeled && isMobilePhone(phone)) || null
    };
  }

  const mobilePhone = validated.find((phone) => isMobilePhone(phone)) || null;
  const cityPhone = validated.find((phone) => phone !== mobilePhone) || null;
  return { cityPhone, mobilePhone };
}

function extractLineItems(body) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];

  for (const block of parseArticleQtyBlocks(body)) {
    if (!items.some((item) => normalizeArticleCode(item.article) === normalizeArticleCode(block.article))) {
      items.push(block);
    }
  }

  for (const line of lines) {
    if (hasArticleNoiseContext(line)) continue;
    if (/^Арт\.?\s*:/i.test(line)) continue;

    // ── Format: "Description ARTICLE - N шт" (product line with trailing qty) ──
    const productQtyMatch = line.match(PRODUCT_QTY_PATTERN);
    if (productQtyMatch) {
      const beforeQty = line.slice(0, line.length - productQtyMatch[0].length).trim();
      const qty = parseFloat(productQtyMatch[1].replace(",", "."));
      const unit = productQtyMatch[2] || "шт";
      // Extract article code from the description part
      const articleFromDesc = extractArticleFromDescription(beforeQty);
      if (articleFromDesc) {
        items.push({ article: normalizeArticleCode(articleFromDesc), quantity: Math.round(qty) || 1, unit, descriptionRu: line });
        continue;
      }
    }

    // ── Format: ARTICLE x 20 / ARTICLE х 20 / ARTICLE * 20 ──
    const itemMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/i);
    if (itemMatch) {
      items.push({ article: normalizeArticleCode(itemMatch[1]), quantity: Number(itemMatch[2]), unit: itemMatch[3] || "шт", descriptionRu: line });
      continue;
    }

    // ── Format: ARTICLE (N штук/шт) ──
    const parenMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s*\((\d+)\s*(штук[аи]?|шт|единиц[аы]?|компл|к-т|пар[аы]?)?\)/i);
    if (parenMatch) {
      items.push({ article: normalizeArticleCode(parenMatch[1]), quantity: Number(parenMatch[2]), unit: parenMatch[3] || "шт", descriptionRu: line });
      continue;
    }

    // ── Format: ARTICLE — N шт / ARTICLE - N шт (article code THEN dash-qty) ──
    const dashMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?\.?\s*$/i);
    if (dashMatch && !VOLTAGE_PATTERN.test(dashMatch[1])) {
      items.push({ article: normalizeArticleCode(dashMatch[1]), quantity: Math.round(parseFloat(dashMatch[2].replace(",", "."))) || 1, unit: dashMatch[3] || "шт", descriptionRu: line });
      continue;
    }

    // ── Format: tabular — ARTICLE\tQTY or ARTICLE;QTY;UNIT ──
    const tabMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})[\t;,]\s*(\d+)(?:[\t;,]\s*([A-Za-zА-Яа-я.]+))?/);
    if (tabMatch && tabMatch[2] !== "0") {
      items.push({ article: normalizeArticleCode(tabMatch[1]), quantity: Number(tabMatch[2]), unit: tabMatch[3] || "шт", descriptionRu: line });
      continue;
    }

    // ── Format: N шт ARTICLE (reversed) ──
    const reverseMatch = line.match(/(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\s+([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})/i);
    if (reverseMatch) {
      items.push({ article: normalizeArticleCode(reverseMatch[3]), quantity: Number(reverseMatch[1]), unit: reverseMatch[2] || "шт", descriptionRu: line });
      continue;
    }
  }

  // ── Numbered list parsing (multi-line product descriptions) ──
  const numberedItems = parseNumberedProductList(body);
  for (const ni of numberedItems) {
    // Skip if already found by line-level parser
    if (items.some((i) => i.article === normalizeArticleCode(ni.article))) continue;
    items.push(ni);
  }

  return items;
}

function parseArticleQtyBlocks(body) {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const items = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const articleMatch = line.match(/^Арт\.?\s*:\s*([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:._]{2,})$/i);
    if (!articleMatch) continue;

    const article = normalizeArticleCode(articleMatch[1]);
    let unit = "шт";
    let quantity = 1;

    const unitIndex = findNextNonEmptyLine(lines, i + 1);
    const quantityIndex = unitIndex >= 0 ? findNextNonEmptyLine(lines, unitIndex + 1) : -1;

    if (unitIndex >= 0 && /^(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\.?$/i.test(lines[unitIndex])) {
      unit = lines[unitIndex].replace(/\.$/, "").toLowerCase();
      if (quantityIndex >= 0 && /^\d+(?:[.,]\d+)?$/.test(lines[quantityIndex])) {
        quantity = Math.round(parseFloat(lines[quantityIndex].replace(",", "."))) || 1;
      }
    }

    const descriptionLines = [];
    let j = i - 1;
    while (j >= 0) {
      const prev = String(lines[j] || "").trim();
      if (!prev) break;
      if (/^Арт\.?\s*:/i.test(prev)) break;
      if (/^(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\.?$/i.test(prev)) break;
      if (/^\d+(?:[.,]\d+)?$/.test(prev)) break;
      if (INN_PATTERN.test(prev) || KPP_PATTERN.test(prev) || OGRN_PATTERN.test(prev)) break;
      if (/^(с уважением|best regards|regards|спасибо)/i.test(prev)) break;
      descriptionLines.unshift(prev);
      j -= 1;
    }

    items.push({
      article,
      quantity,
      unit,
      descriptionRu: descriptionLines.join(" ").trim() || line,
      explicitArticle: true
    });
  }

  return items.filter((item) => item.article && item.article.length >= 3);
}

function findNextNonEmptyLine(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i += 1) {
    if (String(lines[i] || "").trim()) return i;
  }
  return -1;
}

/**
 * Extract article code from a product description line.
 * Handles mixed Cyrillic/Latin codes: М100Ф-8, VV64:KMD 66, NHRY 090, IS7000
 */
function extractArticleFromDescription(text) {
  // Try extended code pattern first (supports Cyrillic, colons)
  for (const m of text.matchAll(EXTENDED_CODE_PATTERN)) {
    const code = m[1];
    if (code.length >= 3 && /\d/.test(code) && !VOLTAGE_PATTERN.test(code)) return code;
  }
  // Try standalone codes
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = m[1];
    if (code.length >= 3 && /\d/.test(code) && !BRAND_NOISE.has(code)) return code;
  }
  // Try Cyrillic mixed codes: АИР100S4
  for (const m of text.matchAll(CYRILLIC_MIXED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code)) return code;
  }
  // Try simple alphanumeric codes at end of text: "Blah blah IS7000"
  const endCodeMatch = text.match(/\b([A-Za-zА-ЯЁа-яё]{1,10}[-]?\d{2,}[-A-Za-z0-9]*)\s*$/);
  if (endCodeMatch && endCodeMatch[1].length >= 3) return normalizeArticleCode(endCodeMatch[1]);
  // Try series+model: "CR 10-3", "WDU 2.5", "NHRY 090"
  for (const m of text.matchAll(SERIES_MODEL_PATTERN)) {
    return `${m[1]} ${m[2]}`;
  }
  // Try "BRAND CODE" with longer numbers: "NHRY 090"
  const brandCodeMatch = text.match(/\b([A-Z]{2,10})\s+(\d{2,6})\b/);
  if (brandCodeMatch) return `${brandCodeMatch[1]} ${brandCodeMatch[2]}`;
  return null;
}

/**
 * Parse numbered product lists:
 * 1. Мотор-редуктор MDEMA1M100-32 трёхфазный
 * 2. Редуктор NHRY 090, ВЗ-В6-В7 80,00
 *
 * Handles multi-line items (description continues on next line).
 */
function parseNumberedProductList(body) {
  const lines = body.split(/\r?\n/);
  const items = [];
  let currentItem = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentItem) { items.push(currentItem); currentItem = null; }
      continue;
    }

    const numMatch = line.match(/^\s*(\d{1,3})[.)]\s+(.+)/);
    if (numMatch) {
      if (currentItem) items.push(currentItem);
      const content = numMatch[2].trim();
      // Check for trailing quantity: "- 4 шт", "- 1.00 шт"
      const qtyMatch = content.match(PRODUCT_QTY_PATTERN);
      const qty = qtyMatch ? Math.round(parseFloat(qtyMatch[1].replace(",", "."))) || 1 : 1;
      const unit = qtyMatch?.[2] || "шт";
      const descPart = qtyMatch ? content.slice(0, content.length - qtyMatch[0].length).trim() : content;
      const article = extractArticleFromDescription(descPart);
      currentItem = {
        article: article ? normalizeArticleCode(article) : "",
        quantity: qty,
        unit,
        descriptionRu: content
      };
    } else if (currentItem && !SIGNATURE_PATTERNS.some((p) => p.test(line))) {
      // Continuation of numbered item — append to description, try re-extract article
      currentItem.descriptionRu += " " + line;
      if (!currentItem.article) {
        const article = extractArticleFromDescription(currentItem.descriptionRu);
        if (article) currentItem.article = normalizeArticleCode(article);
      }
      // Check for qty in continuation
      const qtyMatch = line.match(PRODUCT_QTY_PATTERN);
      if (qtyMatch) {
        currentItem.quantity = Math.round(parseFloat(qtyMatch[1].replace(",", "."))) || 1;
        currentItem.unit = qtyMatch[2] || "шт";
      }
    } else {
      if (currentItem) { items.push(currentItem); currentItem = null; }
    }
  }
  if (currentItem) items.push(currentItem);

  // Filter: only keep items with detected articles
  return items.filter((item) => item.article && item.article.length >= 3);
}

function extractStandaloneCodes(text, forbiddenDigits = new Set()) {
  // Common noise words to exclude from article matches
  const noise = new Set([
    "HTTP", "HTTPS", "HTML", "JSON", "UTF", "ISBN", "IMAP", "SMTP", "MIME",
    "FROM", "DATE", "SENT", "INFO", "CONT", "SUBJ",
    // HTML/CSS/email template artifacts
    "MJ-COLUMN-PER", "MJ-BODY", "MJ-SECTION", "MJ-TEXT", "MJ-IMAGE",
    "BGCOLOR", "COLSPAN", "CELLPADDING", "CELLSPACING", "VALIGN",
    "ARIAL", "HELVETICA", "VERDANA", "TAHOMA", "GEORGIA",
    "WEBKIT", "CHARSET", "VIEWPORT", "DOCTYPE"
  ]);
  const matches = [];
  // Standard latin-only codes
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 5 && /\d/.test(code) && !noise.has(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits)) {
      matches.push(code);
    }
  }
  // Extended codes: dots (233.50.100), colons (VV64:KMD)
  for (const m of text.matchAll(EXTENDED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 4 && /\d/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Cyrillic mixed codes: АИР100S4 (Cyrillic look-alikes transliterated)
  for (const m of text.matchAll(CYRILLIC_MIXED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Reverse: 100А13/1.5Т220 (digits first, then Cyrillic)
  for (const m of text.matchAll(DIGITS_CYRILLIC_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]); // transliterateCyrillicInCode applied inside
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Series + model: "CR 10-3", "WDU 2.5" — combine as single code
  for (const m of text.matchAll(SERIES_MODEL_PATTERN)) {
    const combined = `${m[1]} ${m[2]}`;
    if (combined.length >= 4 && !noise.has(m[1]) && !BRAND_NOISE.has(m[1]) && isLikelyArticle(combined, forbiddenDigits)) {
      if (!matches.includes(combined)) matches.push(combined);
    }
  }
  return matches;
}

function extractNumericArticles(text, forbiddenDigits = new Set()) {
  const matches = [];
  for (const m of text.matchAll(NUMERIC_ARTICLE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    // Skip date-like patterns (01-12, 25/03/2026)
    if (DATE_LIKE_PATTERN.test(code)) continue;
    const digitsOnly = code.replace(/\D/g, "");
    // Must have at least 5 total digits to avoid short noise like 72-03, 63-90
    if (digitsOnly.length < 5) continue;
    // Skip phone-fragment-shaped codes: XX-XX-XX
    if (/^\d{2,3}-\d{2}-\d{2}$/.test(code)) continue;
    if (!isLikelyArticle(code, forbiddenDigits)) continue;
    matches.push(code);
  }
  return matches;
}

function extractArticlesFromSubject(subject, forbiddenDigits = new Set()) {
  const articles = [];
  // Prefixed articles in subject
  for (const m of subject.matchAll(ARTICLE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (isLikelyArticle(code, forbiddenDigits)) articles.push(code);
  }
  // Standalone alpha-numeric codes in subject
  for (const m of subject.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 4 && /\d/.test(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits)) {
      articles.push(code);
    }
  }
  // Numeric articles in subject (e.g. "509-1720 запрос на КП")
  articles.push(...extractNumericArticles(subject, forbiddenDigits));
  return unique(articles);
}

function extractBrandAdjacentCodes(text, forbiddenDigits = new Set()) {
  // Pattern: BRAND + space + numeric code (4-9 digits), e.g. "METROHM 63032220", "Bürkert 0330"
  // Brand-adjacent codes bypass the "5+ digits" rule since brand context confirms them
  const matches = [];
  const pattern = /\b[A-Z][A-Za-zА-Яа-яёü-]{2,20}\s+(\d{4,9})\b/g;
  for (const m of text.matchAll(pattern)) {
    const code = m[1];
    if (!forbiddenDigits.has(code) && !DATE_LIKE_PATTERN.test(code)) {
      matches.push(code);
    }
  }
  return matches;
}

function extractArticlesFromAttachments(attachments, forbiddenDigits = new Set()) {
  const articles = [];
  for (const name of attachments) {
    if (!isAttachmentLikelyToContainArticle(name)) {
      continue;
    }
    // Strip extension
    const baseName = name.replace(/\.[^.]+$/, "").replace(/[_\s]+/g, "-");
    for (const m of baseName.matchAll(STANDALONE_CODE_PATTERN)) {
      const code = normalizeArticleCode(m[1]);
      if (code.length >= 4 && /\d/.test(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits)) {
        articles.push(code);
      }
    }
    articles.push(...extractNumericArticles(baseName, forbiddenDigits));
  }
  return unique(articles);
}

function isAttachmentLikelyToContainArticle(name) {
  const filename = String(name || "").trim();
  if (!filename) return false;
  const ext = path.extname(filename).toLowerCase();
  const baseName = filename.replace(/\.[^.]+$/, "").trim();
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic"].includes(ext);
  if (!isImage) return true;
  if (GENERIC_IMAGE_ATTACHMENT_PATTERN.test(baseName)) return false;
  return /[A-Za-zА-Яа-яЁё]+\d|\d+[A-Za-zА-Яа-яЁё]|[-/.]/.test(baseName);
}

function separateQuotedText(text) {
  const lines = text.split(/\r?\n/);
  const newLines = [];
  const quotedLines = [];
  let inQuote = false;

  for (const line of lines) {
    if (!inQuote && QUOTE_PATTERNS.some((pattern) => pattern.test(line.trim()))) {
      inQuote = true;
    }

    if (inQuote) {
      quotedLines.push(line);
    } else {
      newLines.push(line);
    }
  }

  return {
    newContent: newLines.join("\n").trim(),
    quotedContent: quotedLines.join("\n").trim()
  };
}

function extractSignature(text) {
  const lines = text.split(/\r?\n/);
  let signatureStart = -1;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SIGNATURE_PATTERNS.some((pattern) => pattern.test(lines[i].trim()))) {
      signatureStart = i;
      break;
    }
  }

  if (signatureStart === -1 || signatureStart < lines.length * 0.3) {
    return { body: text, signature: "" };
  }

  return {
    body: lines.slice(0, signatureStart).join("\n").trim(),
    signature: lines.slice(signatureStart).join("\n").trim()
  };
}

function collectForbiddenArticleDigits(text) {
  const digits = new Set();

  for (const phone of text.match(PHONE_PATTERN) || []) {
    const normalized = phone.replace(/\D/g, "");
    if (normalized) {
      addNumericFragments(digits, normalized, { minLength: 5, maxLength: 11 });
      if (normalized.length === 11 && normalized.startsWith("8")) {
        addNumericFragments(digits, `7${normalized.slice(1)}`, { minLength: 5, maxLength: 11 });
      }
    }

    const groups = phone.split(/\D+/).filter(Boolean);
    for (let start = 0; start < groups.length; start += 1) {
      let combined = "";
      for (let end = start; end < groups.length; end += 1) {
        combined += groups[end];
        if (combined.length >= 5 && combined.length <= 8) {
          digits.add(combined);
        }
      }
    }
  }

  for (const pattern of [INN_PATTERN, KPP_PATTERN, OGRN_PATTERN]) {
    const match = text.match(pattern);
    const normalized = match?.[1]?.replace(/\D/g, "");
    if (normalized) {
      addNumericFragments(digits, normalized, { minLength: 6, maxLength: normalized.length });
    }
  }

  return digits;
}

// Cyrillic letters that look like Latin — common OCR/typo confusion in article codes
const CYRILLIC_TO_LATIN = {
  "А": "A", "а": "a", "В": "B", "в": "b", "С": "C", "с": "c",
  "Е": "E", "е": "e", "Н": "H", "И": "I", "и": "i", "К": "K",
  "к": "k", "М": "M", "м": "m", "О": "O", "о": "o", "Р": "P",
  "р": "p", "Т": "T", "т": "t", "Х": "X", "х": "x", "У": "Y",
  "Ф": "F", "ф": "f"
};

function transliterateCyrillicInCode(code) {
  // Only transliterate if the code contains a mix of Cyrillic and Latin/digits
  if (!/[А-ЯЁа-яё]/.test(code)) return code;
  if (!/[A-Za-z0-9]/.test(code)) return code;
  // Has both — transliterate Cyrillic look-alikes to Latin
  return code.replace(/[А-ЯЁа-яё]/g, (ch) => CYRILLIC_TO_LATIN[ch] || ch);
}

function normalizeArticleCode(value) {
  // Keep dots, colons, slashes, dashes inside — strip only leading/trailing junk
  const cleaned = cleanup(value).replace(/^[^A-Za-zА-ЯЁа-яё0-9]+|[^A-Za-zА-ЯЁа-яё0-9]+$/g, "");
  return transliterateCyrillicInCode(cleaned);
}

// Electrical/physical spec noise — should never be articles
const SPEC_NOISE_PATTERNS = [
  /^\d+\s*(?:В|V|Вт|W|кВт|kW|кВА|kVA|Гц|Hz|А|A|мА|mA|бар|bar|°C|мм|mm|м|кг|об\/мин|rpm)\b/i,
  /^\d+[/]\d+\s*(?:В|V|Вт|W)\b/i,  // 230/400 В
];

function isLikelyArticle(code, forbiddenDigits = new Set(), sourceLine = "") {
  const normalized = normalizeArticleCode(code);
  if (!normalized || normalized.length < 3 || normalized.length > 40) {
    return false;
  }

  if (/^(?:https?|www)$/i.test(normalized) || normalized.includes("@")) {
    return false;
  }

  // Reject own brand/company names and known brand noise
  if (BRAND_NOISE.has(normalized.toUpperCase()) || OWN_COMPANY_NAMES.test(normalized)) {
    return false;
  }

  // Reject HTML entity names and CSS artifacts
  if (/^(?:laquo|raquo|nbsp|quot|amp|lt|gt|mdash|ndash|hellip|rsquo|ldquo|rdquo|margin|padding|border|width|height|color|style|class|align|tbody|thead|table)$/i.test(normalized)) {
    return false;
  }
  // Reject hex color codes (6 chars, only 0-9 A-F)
  if (/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    return false;
  }
  // Reject voltage specs (230/400, 10000/400, 1000/1500)
  if (VOLTAGE_PATTERN.test(normalized)) {
    return false;
  }
  // Reject electrical/physical specs: "3 кВт", "50 Гц", "4-20мА"
  if (SPEC_NOISE_PATTERNS.some((p) => p.test(normalized))) {
    return false;
  }

  const digits = normalized.replace(/\D/g, "");
  const letters = normalized.replace(/[^A-Za-zА-Яа-я]/g, "");
  const line = String(sourceLine || "").trim();
  const digitOnlyWithSeparators = /^[\d-/_]+$/.test(normalized);

  if (forbiddenDigits.has(digits) && digits.length >= 5) {
    return false;
  }

  if (line && digitOnlyWithSeparators && hasArticleNoiseContext(line)) {
    return false;
  }

  if (!letters) {
    if (digits.length < 5) {
      return false;
    }

    if (digits.length >= 10) {
      return false;
    }

    if (/^(?:7|8|9)\d{10}$/.test(digits)) {
      return false;
    }

    // Reject date-like digit-separator-digit patterns, but allow long numeric codes (5+ digits total)
    if (/^\d{2,4}[-/]\d{2,4}$/.test(normalized) && digits.length < 5) {
      return false;
    }
    // Reject patterns that look like dates (DD-MM, MM-YYYY)
    if (DATE_LIKE_PATTERN.test(normalized)) {
      return false;
    }
  }

  if (/^\d{3,4}(?:-\d{2}){2,}$/.test(normalized)) {
    return false;
  }

  return true;
}

function buildSuggestedReply(label, sender, lead, crm) {
  const name = sender.fullName && sender.fullName !== "Не определено" ? sender.fullName.split(" ")[0] : "";
  const greeting = name ? `${name}, добрый день!` : "Добрый день!";

  if (label === "СПАМ") return null;

  if (label === "Клиент" && crm.needsClarification) {
    return `${greeting}\n\nСпасибо за обращение.\nДля подготовки коммерческого предложения, пожалуйста, уточните:\n- Полные реквизиты компании (ИНН, КПП, юридический адрес)\n- Точные артикулы и количество\n- Желаемые сроки поставки\n\nС уважением,\nОтдел продаж`;
  }

  if (label === "Клиент") {
    const articles = (lead.articles || []).slice(0, 5).join(", ");
    const brandStr = (lead.detectedBrands || []).join(", ");
    return `${greeting}\n\nСпасибо за заявку${brandStr ? ` по ${brandStr}` : ""}.\n${articles ? `Артикулы: ${articles}\n` : ""}Мы подготовим коммерческое предложение и направим в ближайшее время.\n\nС уважением,\n${crm.curatorMop || "Отдел продаж"}`;
  }

  if (label === "Поставщик услуг") {
    return `${greeting}\n\nСпасибо за предложение. Мы рассмотрим информацию и свяжемся при необходимости.\n\nС уважением,\nОтдел закупок`;
  }

  return null;
}

function parseAttachmentHints(attachments) {
  return attachments.map((name) => {
    const lower = name.toLowerCase();
    let type = "other";
    if (/заявк|request|rfq|запрос/i.test(lower)) type = "request";
    else if (/реквизит|details|card|инн/i.test(lower)) type = "requisites";
    else if (/прайс|price|каталог|catalog/i.test(lower)) type = "pricelist";
    else if (/шильд|nameplate|label|фото|photo|img|jpg|jpeg|png/i.test(lower)) type = "photo";
    else if (/pdf|doc|xls|xlsx|csv/i.test(lower)) type = "document";
    return { name, type };
  });
}

function detectBrands(text, brands) {
  const sourceText = String(text || "");
  const aliases = detectionKb.getBrandAliases ? detectionKb.getBrandAliases() : [];
  const knownBrands = unique([
    ...(brands || []),
    ...aliases.map((entry) => entry.canonical_brand)
  ]);
  const normalizedText = normalizeComparableText(sourceText);
  const matched = new Set();

  for (const brand of knownBrands) {
    if (matchesBrand(normalizedText, brand)) {
      matched.add(brand);
    }
  }

  for (const entry of aliases) {
    if (matchesBrand(normalizedText, entry.alias)) {
      matched.add(preferProjectBrandCase(entry.canonical_brand, brands));
    }
  }

  const projectMatches = (brands || []).filter((brand) => matchesBrand(normalizedText, brand));
  if (projectMatches.length > 0) {
    return dedupeCaseInsensitive(projectMatches);
  }

  return dedupeCaseInsensitive([...matched]);
}

function unique(items) {
  return [...new Set(items)];
}

function dedupeCaseInsensitive(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const normalized = String(item || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(String(item).trim());
  }
  return result;
}

function preferProjectBrandCase(brand, brands = []) {
  const normalized = String(brand || "").trim().toLowerCase();
  const preferred = (brands || []).find((item) => String(item || "").trim().toLowerCase() === normalized);
  return preferred || brand;
}

function cleanup(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractForwardedSender(body) {
  // Match forwarded message headers in various formats
  const fwdPatterns = [
    // Gmail: "---------- Forwarded message ----------\nFrom: Name <email>"
    /[-—–]{3,}\s*(?:Forwarded message|Пересланное сообщение|Исходное сообщение|Пересланное письмо)\s*[-—–]*\s*\n[\s\S]*?(?:From|От|from)\s*:\s*(.+)/i,
    // Outlook: "> From: Name <email>"
    /(?:^|\n)\s*>?\s*(?:From|От)\s*:\s*(.+)/im,
    // Python marker from our extract: "--- Пересланное письмо ---\nОт: ..."
    /---\s*Пересланное письмо\s*---\s*\n\s*От:\s*(.+)/i
  ];

  for (const pattern of fwdPatterns) {
    const match = body.match(pattern);
    if (match) {
      const fromLine = match[1].trim();
      // Parse "Name <email>" or just "email"
      const angleMatch = fromLine.match(/^(.*?)\s*<([^>]+@[^>]+)>/);
      if (angleMatch) {
        return { name: angleMatch[1].replace(/["']/g, "").trim(), email: angleMatch[2].trim().toLowerCase() };
      }
      const emailOnly = fromLine.match(/([^\s<>"]+@[^\s<>"]+)/);
      if (emailOnly) {
        return { name: "", email: emailOnly[1].trim().toLowerCase() };
      }
    }
  }

  return null;
}

function hasArticleNoiseContext(line) {
  return PHONE_LIKE_PATTERN.test(line)
    || CONTACT_CONTEXT_PATTERN.test(line)
    || IDENTIFIER_CONTEXT_PATTERN.test(line)
    || REQUISITES_CONTEXT_PATTERN.test(line)
    || line.includes("@");
}

function addNumericFragments(bucket, value, options = {}) {
  const digits = String(value || "").replace(/\D/g, "");
  const minLength = options.minLength || 5;
  const maxLength = options.maxLength || digits.length;

  if (!digits) {
    return;
  }

  const upperBound = Math.min(maxLength, digits.length);
  for (let length = minLength; length <= upperBound; length += 1) {
    for (let offset = 0; offset <= digits.length - length; offset += 1) {
      bucket.add(digits.slice(offset, offset + length));
    }
  }
}

function extractRequisites(text) {
  return {
    inn: text.match(INN_PATTERN)?.[1] || null,
    kpp: text.match(KPP_PATTERN)?.[1] || null,
    ogrn: text.match(OGRN_PATTERN)?.[1] || null
  };
}

function normalizeComparableText(text) {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[+]/g, " plus ")
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function matchesBrand(normalizedText, candidate) {
  const normalizedCandidate = normalizeComparableText(candidate);
  if (!normalizedCandidate.trim()) {
    return false;
  }

  const candidateWords = normalizedCandidate.trim().split(/\s+/).filter(Boolean);
  if (candidateWords.length === 1 && BRAND_FALSE_POSITIVE_ALIASES.has(candidateWords[0])) {
    return false;
  }

  if (normalizedText.includes(normalizedCandidate)) {
    if (candidateWords.length === 1 && candidateWords[0].length < 4 && !BRAND_CONTEXT_PATTERN.test(normalizedText)) {
      return false;
    }
    return true;
  }

  if (!BRAND_CONTEXT_PATTERN.test(normalizedText)) {
    return false;
  }

  const parts = candidateWords.filter((item) => item.length >= 3 && !BRAND_FALSE_POSITIVE_ALIASES.has(item));
  return parts.length > 1 && parts.every((part) => normalizedText.includes(` ${part} `));
}

function stripHtml(text) {
  if (!/<[a-zA-Z]/.test(text)) return text;
  return text
    // Remove style/script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    // Remove CSS-like artifacts (mj-column-per-100, font-family lines)
    .replace(/mj-[\w-]+/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
