import { randomUUID } from "node:crypto";
import { matchCompanyInCrm } from "./crm-matcher.js";
import { detectionKb } from "./detection-kb.js";

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
const STANDALONE_CODE_PATTERN = /\b([A-Z][A-Z0-9]{2,}[-/]?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)\b/g;
// Numeric article: 509-1720, 3HAC12345-1, 6GK7-343-2AH01
const NUMERIC_ARTICLE_PATTERN = /\b(\d{2,6}[-/]\d{2,6}(?:[-/][A-Za-z0-9]{1,6})*)\b/g;
// Date-like patterns to exclude from numeric articles: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY
const DATE_LIKE_PATTERN = /^(?:0?[1-9]|[12]\d|3[01])[-/](?:0?[1-9]|1[0-2])(?:[-/]\d{2,4})?$/;
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
  const crm = matchCompanyInCrm(project, { sender, detectedBrands: lead.detectedBrands });

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

function extractLead(subject, body, attachments, brands, kbBrands = []) {
  const freeText = body.trim().slice(0, 2000);
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
  const lineItems = extractLineItems(body).filter((item) => isLikelyArticle(item.article, forbiddenDigits, item.descriptionRu));
  const rawBrands = unique(kbBrands.concat(detectBrands([subject, body, attachmentsText].join("\n"), brands)));
  const detectedBrands = detectionKb.filterOwnBrands(rawBrands);

  const attachmentHints = parseAttachmentHints(attachments);

  return {
    freeText,
    hasNameplatePhotos,
    hasArticlePhotos,
    articles: unique(allArticles.concat(lineItems.map((item) => normalizeArticleCode(item.article))).filter(Boolean)),
    lineItems,
    totalPositions: lineItems.length || unique(allArticles).length,
    detectedBrands,
    attachmentHints,
    requestType: detectedBrands.length > 1 ? "Мультибрендовая" : detectedBrands.length === 1 ? "Монобрендовая" : "Не определено"
  };
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

function extractCompanyName(body) {
  const fromKb = detectionKb.matchField("company_name", body);
  if (fromKb) {
    const cleaned = cleanup(fromKb);
    // Don't return own company name as sender's company
    if (OWN_COMPANY_NAMES.test(cleaned)) return null;
    return cleaned;
  }

  return null;
}

function inferCompanyNameFromEmail(email) {
  const domain = email.split("@")[1];
  if (!domain || isFreeDomain(email) || isOwnDomain(domain)) {
    return null;
  }

  const base = domain.split(".")[0];
  if (!base) return null;
  const name = base.replace(/[-_]/g, " ");
  // Don't return own company names
  if (OWN_COMPANY_NAMES.test(name)) return null;
  return name;
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
  return body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (hasArticleNoiseContext(line)) {
      return null;
    }

    // Format: ARTICLE x 20 / ARTICLE х 20 / ARTICLE * 20
    const itemMatch = line.match(/([A-Za-zА-Яа-я0-9-/_]{3,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/i);
    if (itemMatch) {
      return { article: normalizeArticleCode(itemMatch[1]), quantity: Number(itemMatch[2]), unit: itemMatch[3] || "шт", descriptionRu: line };
    }

    // Format: ARTICLE (N штук/шт/единиц)
    const parenMatch = line.match(/([A-Za-z0-9][A-Za-z0-9-/_]{2,})\s*\((\d+)\s*(штук[аи]?|шт|единиц[аы]?|компл|к-т|пар[аы]?)?\)/i);
    if (parenMatch) {
      return { article: normalizeArticleCode(parenMatch[1]), quantity: Number(parenMatch[2]), unit: parenMatch[3] || "шт", descriptionRu: line };
    }

    // Format: ARTICLE — N шт / ARTICLE - N шт
    const dashMatch = line.match(/([A-Za-z0-9][A-Za-z0-9-/_]{2,})\s*[—–-]\s*(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?/i);
    if (dashMatch) {
      return { article: normalizeArticleCode(dashMatch[1]), quantity: Number(dashMatch[2]), unit: dashMatch[3] || "шт", descriptionRu: line };
    }

    // Format: tabular — ARTICLE\tQTY or ARTICLE;QTY;UNIT
    const tabMatch = line.match(/([A-Za-z0-9][A-Za-z0-9-/_]{2,})[\t;,]\s*(\d+)(?:[\t;,]\s*([A-Za-zА-Яа-я.]+))?/);
    if (tabMatch && tabMatch[2] !== "0") {
      return { article: normalizeArticleCode(tabMatch[1]), quantity: Number(tabMatch[2]), unit: tabMatch[3] || "шт", descriptionRu: line };
    }

    // Format: N шт ARTICLE / N штук ARTICLE (reversed order)
    const reverseMatch = line.match(/(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\s+([A-Za-z0-9][A-Za-z0-9-/_]{2,})/i);
    if (reverseMatch) {
      return { article: normalizeArticleCode(reverseMatch[3]), quantity: Number(reverseMatch[1]), unit: reverseMatch[2] || "шт", descriptionRu: line };
    }

    return null;
  }).filter(Boolean);
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
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    // Must contain at least one digit and be 5+ chars
    // Exclude brand names and own company names
    if (code.length >= 5 && /\d/.test(code) && !noise.has(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits)) {
      matches.push(code);
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
  // Pattern: BRAND + space + pure numeric code (5-9 digits), e.g. "METROHM 63032220"
  const matches = [];
  const pattern = /\b[A-Z][A-Za-z-]{2,20}\s+(\d{5,9})\b/g;
  for (const m of text.matchAll(pattern)) {
    const code = m[1];
    if (!forbiddenDigits.has(code) && isLikelyArticle(code, forbiddenDigits)) {
      matches.push(code);
    }
  }
  return matches;
}

function extractArticlesFromAttachments(attachments, forbiddenDigits = new Set()) {
  const articles = [];
  for (const name of attachments) {
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

function normalizeArticleCode(value) {
  return cleanup(value).replace(/^[^A-Za-zА-Яа-я0-9]+|[^A-Za-zА-Яа-я0-9]+$/g, "");
}

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
      matched.add(entry.canonical_brand);
    }
  }

  return [...matched];
}

function unique(items) {
  return [...new Set(items)];
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

  if (normalizedText.includes(normalizedCandidate)) {
    return true;
  }

  if (!BRAND_CONTEXT_PATTERN.test(normalizedText)) {
    return false;
  }

  const parts = normalizedCandidate.trim().split(/\s+/).filter((item) => item.length >= 3);
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
