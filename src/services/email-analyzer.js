import { randomUUID } from "node:crypto";
import { matchCompanyInCrm } from "./crm-matcher.js";

const SPAM_PATTERNS = [/casino/i, /crypto/i, /легкий заработок/i, /раскрут(ка|им)/i, /seo[- ]?продвиж/i, /unsubscr/i, /viagra/i];
const CLIENT_PATTERNS = [/заявк/i, /коммерческ/i, /прошу/i, /нужн/i, /артикул/i, /шильдик/i, /кол-?во/i, /счет/i, /цен/i];
const VENDOR_PATTERNS = [/предлагаем/i, /каталог/i, /дилер/i, /поставля/i, /прайс/i, /услуг/i];
const POSITION_PATTERNS = [/генеральный директор/i, /директор/i, /менеджер по закупкам/i, /менеджер/i, /специалист/i, /инженер/i];
const COMPANY_PATTERNS = [/(ООО\s+["«][^"»]+["»])/i, /(АО\s+["«][^"»]+["»])/i, /(ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/i, /(ООО\s+[A-Za-zА-Яа-яЁё0-9\-\s]+)/i, /(АО\s+[A-Za-zА-Яа-яЁё0-9\-\s]+)/i];
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const PHONE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
const INN_PATTERN = /(?:ИНН|inn)[^0-9]{0,5}(\d{10,12})/i;
const ARTICLE_PATTERN = /(?:арт(?:икул)?|sku)[^A-Za-zА-Яа-я0-9]{0,5}([A-Za-zА-Яа-я0-9-/_]+)/gi;

export function analyzeEmail(project, payload) {
  const subject = String(payload.subject || "");
  const body = String(payload.body || "");
  const fromEmail = String(payload.fromEmail || "").trim().toLowerCase();
  const fromName = String(payload.fromName || "").trim();
  const attachments = normalizeAttachments(payload.attachments);
  const normalizedText = [subject, body, attachments.join(" ")].join("\n");

  const classification = classifyMessage(normalizedText, fromEmail);
  const sender = extractSender(fromName, fromEmail, body, attachments);
  const lead = extractLead(subject, body, attachments, project.brands || []);
  const crm = matchCompanyInCrm(project, { sender, detectedBrands: lead.detectedBrands });

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

function classifyMessage(text, fromEmail) {
  const lowered = text.toLowerCase();
  const spamHits = SPAM_PATTERNS.filter((pattern) => pattern.test(lowered)).length;
  const clientHits = CLIENT_PATTERNS.filter((pattern) => pattern.test(lowered)).length;
  const vendorHits = VENDOR_PATTERNS.filter((pattern) => pattern.test(lowered)).length;
  const hasCorporateEmail = Boolean(fromEmail.split("@")[1] && !isFreeDomain(fromEmail));

  let label = "Не определено";
  let confidence = 0.45;

  if (spamHits >= 2 || (spamHits >= 1 && clientHits === 0 && vendorHits === 0)) {
    label = "СПАМ";
    confidence = 0.9;
  } else if (clientHits >= vendorHits && (clientHits >= 2 || hasCorporateEmail)) {
    label = "Клиент";
    confidence = clientHits >= 3 ? 0.89 : 0.72;
  } else if (vendorHits > clientHits) {
    label = "Поставщик услуг";
    confidence = 0.68;
  }

  return {
    label,
    confidence,
    signals: { spamHits, clientHits, vendorHits, hasCorporateEmail }
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

function extractLead(subject, body, attachments, brands) {
  const freeText = body.trim().slice(0, 800);
  const articles = Array.from(body.matchAll(ARTICLE_PATTERN)).map((match) => match[1]);
  const attachmentsText = attachments.join(" ");
  const hasNameplatePhotos = /шильд|nameplate/i.test(attachmentsText);
  const hasArticlePhotos = /артик|sku|label/i.test(attachmentsText);
  const lineItems = extractLineItems(body);
  const detectedBrands = detectBrands([subject, body, attachmentsText].join("\n"), brands);

  return {
    freeText,
    hasNameplatePhotos,
    hasArticlePhotos,
    articles: unique(articles.concat(lineItems.map((item) => item.article)).filter(Boolean)),
    lineItems,
    totalPositions: lineItems.length || unique(articles).length,
    detectedBrands,
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
  for (const pattern of COMPANY_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return cleanup(match[1]);
    }
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
  const signatureMatch = body.match(/(?:с уважением|best regards|спасибо)[,\s]*\n+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/i);
  return signatureMatch?.[1] || null;
}

function extractPosition(body) {
  for (const pattern of POSITION_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[0]) {
      return cleanup(match[0]);
    }
  }

  return null;
}

function splitPhones(phones) {
  const normalized = unique((phones || []).map((phone) => cleanup(phone)));
  const mobilePhone = normalized.find((phone) => /\+?7?8?[\s(.-]*9\d{2}/.test(phone.replace(/\s/g, ""))) || null;
  const cityPhone = normalized.find((phone) => phone !== mobilePhone) || null;
  return { cityPhone, mobilePhone };
}

function extractLineItems(body) {
  return body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const itemMatch = line.match(/([A-Za-zА-Яа-я0-9-/_]{3,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/i);
    if (!itemMatch) {
      return null;
    }

    return {
      article: itemMatch[1],
      quantity: Number(itemMatch[2]),
      unit: itemMatch[3] || "шт",
      descriptionRu: line
    };
  }).filter(Boolean);
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
