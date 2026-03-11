import { randomUUID } from "node:crypto";
import { matchCompanyInCrm } from "./crm-matcher.js";
import { detectionKb } from "./detection-kb.js";

const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const PHONE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
const INN_PATTERN = /(?:ИНН|inn)[^0-9]{0,5}(\d{10,12})/i;
const ARTICLE_PATTERN = /(?:арт(?:икул(?:а|у|ом|е|ы|ов|ам|ами|ах)?)?|sku)\b[^A-Za-zА-Яа-я0-9]{0,5}([A-Za-z0-9][A-Za-z0-9-/_]{2,})/gi;
const STANDALONE_CODE_PATTERN = /\b([A-Z][A-Z0-9]{2,}[-/]?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)\b/g;

export function analyzeEmail(project, payload) {
  const subject = String(payload.subject || "");
  const body = String(payload.body || "");
  const fromEmail = String(payload.fromEmail || "").trim().toLowerCase();
  const fromName = String(payload.fromName || "").trim();
  const attachments = normalizeAttachments(payload.attachments);
  const normalizedText = [subject, body, attachments.join(" ")].join("\n");

  const classification = classifyMessage({
    subject,
    body,
    attachments,
    fromEmail,
    projectBrands: project.brands || []
  });
  const sender = extractSender(fromName, fromEmail, body, attachments);
  const lead = extractLead(subject, body, attachments, project.brands || [], classification.detectedBrands || []);
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
    detectedBrands: lead.detectedBrands,
    intakeFlow: buildIntakeFlow(classification.label, crm, lead),
    suggestedReply,
    rawInput: {
      subject,
      attachments
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
  const inn = body.match(INN_PATTERN)?.[1] || null;
  const companyName = extractCompanyName(body) || inferCompanyNameFromEmail(fromEmail);
  const fullName = fromName || extractFullNameFromBody(body) || "Не определено";
  const position = extractPosition(body) || null;
  const website = urls[0] || inferWebsiteFromEmail(fromEmail);
  const { cityPhone, mobilePhone } = splitPhones(phones);
  const legalCardAttached = attachments.some((item) => /реквиз|card|details/i.test(item));

  return { email: fromEmail, fullName, position, companyName, website, cityPhone, mobilePhone, inn, legalCardAttached };
}

function extractLead(subject, body, attachments, brands, kbBrands = []) {
  const freeText = body.trim().slice(0, 2000);
  const prefixedArticles = Array.from(body.matchAll(ARTICLE_PATTERN)).map((match) => match[1]);
  const standaloneArticles = extractStandaloneCodes(body);
  const allArticles = unique([...prefixedArticles, ...standaloneArticles].filter(Boolean));
  const attachmentsText = attachments.join(" ");
  const hasNameplatePhotos = /шильд|nameplate/i.test(attachmentsText);
  const hasArticlePhotos = /артик|sku|label/i.test(attachmentsText);
  const lineItems = extractLineItems(body);
  const detectedBrands = unique(kbBrands.concat(detectBrands([subject, body, attachmentsText].join("\n"), brands)));

  const attachmentHints = parseAttachmentHints(attachments);

  return {
    freeText,
    hasNameplatePhotos,
    hasArticlePhotos,
    articles: unique(allArticles.concat(lineItems.map((item) => item.article)).filter(Boolean)),
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

function extractCompanyName(body) {
  const fromKb = detectionKb.matchField("company_name", body);
  if (fromKb) {
    return cleanup(fromKb);
  }

  return null;
}

function inferCompanyNameFromEmail(email) {
  const domain = email.split("@")[1];
  if (!domain || isFreeDomain(email)) {
    return null;
  }

  const base = domain.split(".")[0];
  return base ? base.replace(/[-_]/g, " ") : null;
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
  return new Set(["gmail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru", "ya.ru"]).has(domain);
}

function extractFullNameFromBody(body) {
  return detectionKb.matchField("signature_hint", body) || null;
}

function extractPosition(body) {
  const position = detectionKb.matchField("position", body);
  return position ? cleanup(position) : null;
}

function splitPhones(phones) {
  const normalized = unique((phones || []).map((phone) => cleanup(phone)));
  const mobilePhone = normalized.find((phone) => /\+?7?8?[\s(.-]*9\d{2}/.test(phone.replace(/\s/g, ""))) || null;
  const cityPhone = normalized.find((phone) => phone !== mobilePhone) || null;
  return { cityPhone, mobilePhone };
}

function extractLineItems(body) {
  return body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    // Format: ARTICLE x 20 / ARTICLE х 20 / ARTICLE * 20
    const itemMatch = line.match(/([A-Za-zА-Яа-я0-9-/_]{3,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/i);
    if (itemMatch) {
      return { article: itemMatch[1], quantity: Number(itemMatch[2]), unit: itemMatch[3] || "шт", descriptionRu: line };
    }

    // Format: ARTICLE (N штук/шт/единиц)
    const parenMatch = line.match(/([A-Za-z0-9][A-Za-z0-9-/_]{2,})\s*\((\d+)\s*(штук[аи]?|шт|единиц[аы]?|компл|к-т|пар[аы]?)?\)/i);
    if (parenMatch) {
      return { article: parenMatch[1], quantity: Number(parenMatch[2]), unit: parenMatch[3] || "шт", descriptionRu: line };
    }

    // Format: ARTICLE — N шт / ARTICLE - N шт
    const dashMatch = line.match(/([A-Za-z0-9][A-Za-z0-9-/_]{2,})\s*[—–-]\s*(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?/i);
    if (dashMatch) {
      return { article: dashMatch[1], quantity: Number(dashMatch[2]), unit: dashMatch[3] || "шт", descriptionRu: line };
    }

    return null;
  }).filter(Boolean);
}

function extractStandaloneCodes(text) {
  // Common noise words to exclude from article matches
  const noise = new Set(["HTTP", "HTTPS", "HTML", "JSON", "UTF", "ISBN", "IMAP", "SMTP", "MIME", "FROM", "DATE", "SENT", "INFO", "CONT", "SUBJ"]);
  const matches = [];
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = m[1];
    // Must contain at least one digit and be 5+ chars
    if (code.length >= 5 && /\d/.test(code) && !noise.has(code)) {
      matches.push(code);
    }
  }
  return matches;
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
  const lowered = text.toLowerCase();
  return unique(brands.filter((brand) => lowered.includes(brand.toLowerCase())));
}

function unique(items) {
  return [...new Set(items)];
}

function cleanup(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
