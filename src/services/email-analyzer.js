import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeStoredAttachments } from "./attachment-content.js";
import { matchCompanyInCrm } from "./crm-matcher.js";
import { detectionKb } from "./detection-kb.js";
import { hybridClassify, isAiEnabled, getAiConfig } from "./ai-classifier.js";
import { isLlmExtractEnabled, llmExtract, mergeLlmExtraction, buildRulesFoundSummary, getLlmExtractConfig } from "./llm-extractor.js";

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
// Supports 3-digit area codes (mobile 9xx, regions 3xx/4xx/8xx) and 4-digit city codes (3952, 3812, etc.)
const PHONE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3,4}(?:[\s).-]*\d{2,4}){2}[\s.-]*\d{2}(?:[.,]\s*доб\.?\s*\d{1,6})?|\(\d{3,5}\)\s*\d{2,3}[\s.-]*\d{2}[\s.-]*\d{2}(?:[.,]\s*доб\.?\s*\d{1,6})?/g;
const PHONE_LIKE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3,4}[\s).-]*\d{2,3}[\s.-]*\d{2}[\s.-]*\d{2}/i;
const PHONE_LABEL_PATTERN = /(?:тел|телефон|phone|моб|mobile|факс|fax|whatsapp|viber)\s*[:#-]?\s*((?:\+7|8)[\s(.-]*\d{3,4}[\s).-]*\d{2,3}[\s.-]*\d{2}[\s.-]*\d{2}|\d{3,4}[\s(.-]*\d{2,3}[\s).-]*\d{2}[\s.-]*\d{2}(?!\d))/i;
const CONTACT_CONTEXT_PATTERN = /\b(?:тел|телефон|phone|моб|mobile|факс|fax|whatsapp|viber|email|e-mail|почта)\b/i;
const IDENTIFIER_CONTEXT_PATTERN = /\b(?:инн|inn|кпп|kpp|огрн|ogrn|request\s*id|order\s*id|ticket\s*id|номер\s*заявки|идентификатор)\b/i;
const INN_PATTERN = /(?:ИНН|inn)(?:\/КПП)?\s*[:#-]?\s*(\d{10,12})/i;
const KPP_PATTERN = /(?:КПП|kpp)\s*[:#-]?\s*(\d{9})/i;
const OGRN_PATTERN = /(?:ОГРН|ogrn)\s*[:#-]?\s*(\d{13,15})/i;
const ARTICLE_PATTERN = /(?:арт(?:икул(?:а|у|ом|е|ы|ов|ам|ами|ах)?)?|sku)\s*[:#-]?\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\-/_]{2,})/gi;
const STANDALONE_CODE_PATTERN = /\b([A-Z][A-Z0-9]{2,}[-/.]?[A-Z0-9]{2,}(?:[-/.][A-Z0-9]+)*)\b/g;
// Numeric article: 509-1720, 3HAC12345-1, 6GK7-343-2AH01, 233.50.100
const NUMERIC_ARTICLE_PATTERN = /\b(\d{2,6}[-/.]\d{2,6}(?:[-/.][A-Za-z0-9]{1,6})*)\b/g;
// Date-like patterns to exclude from numeric articles: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY
const DATE_LIKE_PATTERN = /^(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])(?:[-/.]\d{2,4})?$/;
// Voltage/electrical spec patterns to exclude from articles
const VOLTAGE_PATTERN = /^\d{1,5}[/]\d{1,5}$/;  // 230/400, 10000/400, 1000/1500
// Extended article pattern: supports dots (233.50.100), colons (VV64:KMD), mixed alpha-num + Cyrillic
const EXTENDED_CODE_PATTERN = /\b([A-Za-zА-ЯЁа-яё][A-Za-zА-ЯЁа-яё0-9]{0,}[-/:.][A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:.]{0,25})\b/g;
const DIGIT_LEAD_SEGMENTED_CODE_PATTERN = /\b(\d[A-ZА-ЯЁ0-9]{1,10}(?:[-/.][A-ZА-ЯЁ0-9]{1,12}){1,6}(?:\+[A-ZА-ЯЁ0-9]{1,6})?)\b/gi;
const MIXED_CASE_SEGMENTED_CODE_PATTERN = /\b([A-Za-zА-ЯЁа-яё]{1,8}[A-Za-zА-ЯЁа-яё0-9]{0,12}(?:[-/.][A-Za-zА-ЯЁа-яё0-9]{1,12}){1,6})\b/g;
// Mixed Cyrillic+Latin+digits code (АИР100S4) — \b doesn't work with Cyrillic in JS
const CYRILLIC_MIXED_CODE_PATTERN = /(?:^|[\s,;:(])([А-ЯЁа-яё]{1,5}[0-9][A-Za-zА-ЯЁа-яё0-9/.-]{2,20})/gm;
// Reverse: digits first then Cyrillic (100А13/1.5Т220)
const DIGITS_CYRILLIC_CODE_PATTERN = /(?:^|[\s,;:(])(\d{1,5}[А-ЯЁа-яё][A-Za-zА-ЯЁа-яё0-9/.-]{2,20})/gm;
const DIGITS_CYRILLIC_HYPHEN_CODE_PATTERN = /(?:^|[\s,;:(])(\d+[А-ЯЁа-яё]+[-/.][A-Za-zА-ЯЁа-яё0-9/.-]{2,20})/gm;
// Series + model: "CR 10-3", "WDU 2.5", "EV220B 032U1240" — letter code + space + number/code
const SERIES_MODEL_PATTERN = /\b([A-Z]{2,6})\s+(\d{1,3}(?:[-/.]\d{1,4})?(?:[-/][A-Z0-9]+)?)\b/g;
// Numbered list item: "1. Description ARTICLE" or "1) Description ARTICLE"
const NUMBERED_ITEM_PATTERN = /^\s*\d{1,3}[.)]\s+/;
// Product line with quantity: "Description - N шт" or "Description - N.NN шт"
const PRODUCT_QTY_PATTERN = /[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)?\.?\s*$/i;
// Same but allows trailing closing words (Спасибо, Thanks, etc.)
const PRODUCT_QTY_TRAILING_PATTERN = /[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)\.?(?:\s+[А-Яа-яЁё!.]+)?$/i;
const BRAND_CONTEXT_PATTERN = /\b(?:бренд|brand|производител[ья]|manufacturer|vendor|марка)\b/i;
const REQUISITES_CONTEXT_PATTERN = /(?:реквизит|карточк[аи]|company details|legal details|ОКПО|ОКТМО|ОКОГУ|ОКАТО|ОКОПФ|ОКФС|ОКВЭД|ИНН|КПП|ОГРН|УНП|УНН)/i;
const EXTENDED_BRAND_WORD_RE = "A-Za-zÀ-ÿА-Яа-яЁё";

// Auto-reply detection: subject patterns
const AUTO_REPLY_SUBJECT_PATTERNS = [
  /^(?:Re:\s*)?(?:Auto(?:matic)?\s*(?:reply|response)|Автоответ|Автоматический ответ)/i,
  /^(?:Out of (?:the )?office|Вне офиса|Отсутств|I.m away|I am away)/i,
  /\bваш[аеи]?\s+(?:заявк[аеи]|обращени[ея]|запрос|письмо|сообщени[ея])\s+(?:принят|зарегистриров|получен|обработ)/i,
  /\b(?:заявк[аеи]|обращени[ея]|тикет|ticket|request|case)\s*(?:#|№|номер)?\s*\d+/i,
  /\b(?:создан[оа]?\s+(?:заявк|обращени|тикет)|(?:ticket|case|request)\s+(?:created|opened|received))\b/i,
  /^\[?(?:auto|noreply|no-reply|system|notification|уведомление)/i,
  /\bdo\s*not\s*reply\b|\bне\s*отвечайте\b/i,
  /\b(?:delivery|read)\s*(?:notification|receipt)\b/i,
  /\bуведомлени[ея]\s+о\s+(?:доставке|прочтении|получении)\b/i,
  /\b(?:на\s+отпуске|на\s+больничном|не\s+работаю|временно\s+не\s+доступ)/i,
  /\b(?:vacation|holiday)\s*(?:auto|reply|notice)/i,
  /^(?:уведомление|notification|alert)\s*(?:о|от|:)/i,
  /^(?:ваш[аеи]?\s+)?(?:заказ|доставка|посылка|отправление)\s+(?:№|#|\d)/i,
  /\b(?:delivery|shipping)\s+(?:notification|confirmation|update)\b/i
];

// Auto-reply detection: body patterns (check only first ~500 chars)
const AUTO_REPLY_BODY_PATTERNS = [
  /(?:ваш[аеи]?\s+)?(?:заявк[аеи]|обращени[ея]|запрос|письмо|сообщени[ея])\s+(?:принят|зарегистриров|получен|обработ|создан)/i,
  /(?:присвоен|назначен)\s+(?:номер|id|#|№)\s*[:.]?\s*\d+/i,
  /(?:это|данное)\s+(?:автоматическ|сгенерированн)/i,
  /(?:this is an?\s+)?auto(?:matic(?:ally)?)?[\s-]*(?:generated|reply|response)/i,
  /(?:please\s+)?do\s+not\s+reply\s+(?:to\s+)?this/i,
  /не\s+отвечайте\s+на\s+(?:это|данное)\s+(?:письмо|сообщение)/i,
  /(?:служба\s+)?(?:техническ(?:ой|ая)\s+)?поддержк[аи]\s+получил[аи]/i,
  /(?:noreply|no-reply|mailer-daemon|postmaster|system)@/i,
  /(?:ниже\s+)?(?:текст|содержание|копия)\s+(?:вашего|исходного)\s+(?:письма|обращения|заявки|сообщения)/i,
  /(?:your\s+)?(?:original\s+)?(?:message|request|inquiry)\s+(?:is\s+)?(?:below|attached|included)/i,
  /(?:письмо|сообщение)\s+(?:отправлено|создано|сформировано)\s+автоматически/i,
  /это\s+автоматическое\s+(?:уведомление|сообщение|письмо)/i,
  /message\s+was\s+(?:auto(?:matically)?[-\s])?generated/i
];

// Patterns that mark the start of embedded/quoted original request in auto-replies
const AUTO_REPLY_EMBED_PATTERNS = [
  /^-{2,}\s*(?:Текст|Содержание|Копия)\s+(?:вашего|исходного)\s+(?:письма|обращения|заявки|сообщения)\s*-{0,}/i,
  /^(?:Текст|Содержание|Копия)\s+(?:вашего|исходного)\s+(?:письма|обращения|заявки|сообщения)\s*:/i,
  /^-{2,}\s*(?:Your (?:original )?(?:message|request))\s*-{0,}/i,
  /^(?:Your (?:original )?(?:message|request))\s*:/i,
  /^-{2,}\s*(?:Ваше?\s+(?:письмо|обращение|заявка|сообщение))\s*-{0,}/i,
  /^(?:Ваше?\s+(?:письмо|обращение|заявка|сообщение))\s*:/i
];

const QUOTE_PATTERNS = [
  /^>+\s?/,
  /^On .+ wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Пересланное сообщение\s*-{2,}$/i,
  /^-{2,}\s*Исходное сообщение\s*-{2,}$/i,
  /^\d{1,2}[./]\d{1,2}[./]\d{2,4}.*(?:wrote|написал|пишет)/i,
  /^(?:From|Sent|To|Cc|От|Отправлено|Кому|Тема):\s/i,
  // Outlook inline quote block: "From: X Sent: Y To: Z" on same line
  /^From:\s+.+\s+Sent:\s+/i,
  // Outlook underscore separator (8+ underscores)
  /^_{8,}\s*$/,
  // Outlook/Exchange "Sent from Outlook" footer
  /^Sent from (?:Outlook|Mail|my iPhone|my iPad)/i,
  // Exchange/Lotus "-----Original Message-----" variations
  /^[_\-]{5,}\s*(?:Original|Forwarded|Reply)\s*(?:Message|Mail)?\s*[_\-]{0,}$/i,
  // Russian "От: X Дата: Y" Outlook format
  /^От:\s+.+\s*(?:\r?\n|\s{2,})Дата:/i,
  ...AUTO_REPLY_EMBED_PATTERNS
];
const SIGNATURE_PATTERNS = [
  /^--\s*$/,
  /^_{3,}$/,
  /^={3,}$/,
  /^С уважением[,.]?\s*/i,
  /^С наилучшими пожеланиями[,.]?\s*/i,
  /^Best regards[,.]?\s*/i,
  /^Kind regards[,.]?\s*/i,
  /^Warm regards[,.]?\s*/i,
  /^Regards[,.]?\s*/i,
  /^Спасибо[,.]?\s*/i,
  /^Благодарю[,.]?\s*/i,
  /^Sent from my /i,
  /^Отправлено с /i,
  /^Get Outlook for /i,
  /^Получено с помощью /i
];

// ── Transliteration table for DESC: synthetic article codes ──
const TRANSLIT_MAP = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",
    к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
    х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"
};

function transliterateToSlug(text) {
    return "DESC:" + text
        .toLowerCase()
        .split("")
        .map((c) => TRANSLIT_MAP[c] ?? (/[a-z0-9]/i.test(c) ? c : "-"))
        .join("")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
}

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
  "top", "moro", "ydra", "hydra", "global", "control", "process", "electronic", "data"
]);
const OFFICE_XML_ARTICLE_NOISE_PATTERNS = [
  /^UTF-?8$/i,
  /^97-2003$/i,
  /^1TABLE$/i,
  /^(?:BG|LT|TX|DK)\d{1,2}$/i,
  /^THEME(?:\/THEME){1,}(?:\/?\d+)?(?:\.XML(?:PK)?)?$/i,
  /^DRAWINGML\/\d{4}\/MAIN$/i,
  /^OPENXMLFORMATS(?:\/[A-Z0-9._-]+){1,}$/i,
  /^SCHEMAS(?:\/[A-Z0-9._:-]+){1,}$/i,
  /^RELATIONSHIPS(?:\/[A-Z0-9._:-]+){1,}$/i,
  /^CONTENT[-_ ]?TYPES$/i,
  // Word document identifiers
  /^WORD\.DOCUMENT\.\d+$/i,
  // Office color theme tokens (ACCENT1-6, DK1-2, LT1-2, FOLDHASH, HYPERLINK)
  /^(?:ACCENT|HLINK|FOLDHASH|HYPERLINK)\d*$/i,
  // Office document XML paths
  /^officeDocument\/\d{4}\//i,
  /^customXml$/i
];
const OFFICE_XML_TEXT_NOISE_PATTERNS = [
  /\b(?:_rels|docprops|\[content_types\]\.xml|content[_-]?types|word\/|xl\/|ppt\/)\b/i,
  /\b(?:schemas\.openxmlformats\.org|openxmlformats\.org|drawingml\/\d{4}\/main)\b/i,
  /\b(?:theme\/theme\/theme\d+\.xml|word\.document\.8)\b/i,
  /\bPK[\x03\x05\x07]/i
];
const PDF_INTERNAL_TEXT_NOISE_PATTERNS = [
  /\b(?:type\/font|subtype\/|cidfonttype2|fontdescriptor|cidtogidmap|colorspace\/device|filter\/flatedecode|xobject|objstm|xref|italicangle|fontbbox|fontfile2|length1|length2|length3|kids|capheight|ascent|descent|avgwidth|maxwidth|stemv|outputintent)\b/i,
  /\b(?:ns\.adobe\.com|purl\.org|www\.w3\.org\/1999\/02\/22-rdf|rdf-syntax-ns)\b/i,
  /^\s*(?:r\/f\d+|r\/gs\d+|r\/image\d+|image\d+|im\d+|gs\d+|ca\s+\d+|lc\s+\d+|lj\s+\d+|lw\s+\d+|ml\s+\d+)\s*$/i,
  /^\s*d:\d{8,14}\s*$/i,
  /^\s*feff[0-9a-f]{12,}\s*$/i,
  /^\s*[0-9a-f]{24,}\s*$/i,
  // PDF font/resource references as standalone article candidates
  /^(?:R\/(?:F|TT|Im|GS|CS)\d+|CA\s+\d+|Type\/Font|FONTFILE\d*|LENGTH\d*|TYPE\d*|IMAGE\d+)$/i,
  // PDF structure tokens that get extracted as articles
  /^(?:\d+\/(?:KIDS|L|T|ITALICANGLE|ASCENT|DESCENT|CAPHEIGHT|XHEIGHT|LASTCHAR|LEADING|PREDICTOR))$/i,
  /^Type\/Font\/Subtype/i,
  // PDF composite tokens: CIDFontType2/Type/Font, Subtype/CIDFontType2, BASEFONT/*, /COLORSPACE/DEVICERGB/*
  /(?:CIDFontType2|BASEFONT|CIDFONTTYPE|CIDTOGIDMAP|DEVICERGB|DCTDECODE|FLATEDECODE)/i,
  // PDF W5M hash-like strings
  /^[A-Z0-9]{24,}$/i,
  // PDF font operator patterns: "Subtype/Type0", "5/PREDICTOR"
  /^\d+\/[A-Z]{4,}/i
];
// CSS tokens: font-size:17px, padding:16px, max-width:480px, line-height:165, mso-line-height-alt:24
const CSS_STYLE_TOKEN_PATTERN = /^(?:FONT|LINE|LETTER|WORD|TEXT|MARGIN|PADDING|BORDER|BACKGROUND|COLOR|WIDTH|HEIGHT|TOP|LEFT|RIGHT|BOTTOM|DISPLAY|POSITION|MIN|MAX|MSO)(?:-[A-Z]+)*:\S+$/i;
// Word internal style list codes: WW8Num1z0, WRD0000-WRD0003 (higher WRD#### can be real product codes)
const WORD_INTERNAL_TOKEN_PATTERN = /^(?:WW8[A-Z0-9]+|WRD000[0-3])$/i;
const WORD_STYLE_TOKEN_PATTERN = /^(?:WW-[A-Za-z0-9-]+|\d+ROMAN(?:\/[A-Z]+)?|V\d+)$/i;
const STANDARD_TOKEN_PATTERN = /^(?:IEC|ISO|EN|DIN|AISI|ASTM|ASME|API|AWS|SAE)\d+(?:[.-]\d+)*$/i;
const ARTICLE_POSITIVE_PATTERNS = [
  /^(?=.*[A-ZА-Я])(?=.*\d)[A-ZА-Я0-9]{2,10}(?:[-/][A-ZА-Я0-9.+]{1,12}){1,6}$/i,
  /^(?=.*[A-ZА-Я])(?=.*\d)[A-ZА-Я0-9]{2,10}(?:[./-][A-ZА-Я0-9]{1,12}){2,6}$/i,
  /^(?=.*[A-ZА-Я])(?=.*\d)[A-ZА-Я0-9]{6,20}$/i,
  /^(?=.*[A-ZА-Я])(?=.*\d)[A-ZА-Я]{1,6}\d{2,12}[A-ZА-Я0-9]{0,8}$/i,
  /^(?=.*[A-ZА-Я])(?=.*\d)\d{2,8}[./-][A-ZА-Я0-9]{1,10}$/i,
  /^(?=.*[A-ZА-Я])(?=.*\d)[A-ZА-Я0-9]{3,12}(?:[-/][A-ZА-Я0-9]{1,10}){1,4}(?:\+[A-ZА-Я0-9]{1,6})?$/i
];
const ARTICLE_NEGATIVE_PATTERNS = [
  /^(?:IP\s?\d{2,3}|PTB\s+\S+|ATEX\s+\S+|IECEX\s+\S+|EX\s+\S+|II\s+\d+)$/i,
  /^(?:TO\s+\d+(?:[.,]\d+)?|VAC\s+\d+(?:\/\d+)?HZ|VDC\s+\d+(?:\/\d+)?HZ|AC\s?\d+|DC\s?\d+|\d+(?:[.-]\d+)?VAC|\d+(?:[.-]\d+)?VDC)$/i,
  /^(?:VA\s+\d[\d.]*|UT\s+\d+|TS\d+|PE|N|L\d?)$/i,
  /^\d{1,5}(?:[.,]\d+)?$/,
  /^[A-ZА-Я0-9]{1,4}$/i,
  /^\d+(?:[.,]\d+)?(?:MM|CM|M|KW|W|V|VAC|VDC|A|MA|HZ|KG|G|BAR|°C|C)$/i,
  /(?:@|https?:\/\/|theme\/theme|drawingml\/|word\.document\.\d|xmlns|content_types|_rels\/|colorspace|line-height:|officedocument\/)/i,
  /^(?:GMBH|LLC|LTD|INC|ООО|ОАО|ЗАО|AO)\s+\d+$/i,
  // IEC/ISO standard version identifiers (IEC61966-2.1, ISO9001-2015)
  /^(?:IEC|ISO)\d+(?:[-/.]\d+)*$/i,
  // PDF/JPEG binary residue
  /\d{4,}:[A-Z]{6,}/i,
  // PDF internal references: R/F2, CA 1, Type/Font, FONTFILE2, KIDS, ASCENT
  /^(?:R\/[A-Z]+\d+|CA\s+\d+|FONTFILE\d*|Type\/Font)$/i,
  // URL-like paths (ns.adobe.com/*, purl.org/*, www.w3.org/*)
  /^(?:ns|www|purl)\.[a-z]+\.[a-z]+/i,
  // Diadoc/EDO document numbers: BM-9701077015-770101001
  /^BM-\d{7,}(?:-\d{7,})+$/i
];
const ARTICLE_CONTEXT_POSITIVE_PATTERNS = [
  /\b(?:part number|manufacturer part number|mpn|p\/n|pn|арт\.?|артикул|каталожн(?:ый|ого) номер|модель|model)\b/i,
  /\b(?:поз\.?|позиция|наименование|qty|quantity|кол-?во|ед\.?\s*изм\.?|base unit of measure)\b/i,
  /\b(?:manufacturer|vendor|product|equipment|spare part|зип|запчаст|оборудован)\b/i
];
const ARTICLE_CONTEXT_NEGATIVE_PATTERNS = [
  /(?:content_types|_rels\/|theme\/theme|openxmlformats|drawingml\/|word\.document\.8|msworddoc|xml version=|xmlns:|ns\.adobe\.com|purl\.org|officedocument\/|cidfont|fontfile|\/colorspace|\/filter\/|rdf)/i,
  /\b(?:certificate|atex|iecex|explosion protection|ingress protection|hazard areas|ip\d{2}|ip\s+\d{2}|ex\s+ii)\b/i,
  /\b(?:voltage|rated current|frequency|temperature|dimensions?|length|diameter|capacity|power|ambient)\b/i
];
const STRONG_ARTICLE_CONTEXT_PATTERN = /(?:^|[\s:(])(?:part number|manufacturer part number|mpn|p\/n|pn|арт\.?|артикул|каталожн(?:ый|ого)\s+номер)(?:$|[\s:.,;])/i;
const STANDARD_OR_NORM_PATTERN = /^(?:IEC|ISO|ГОСТ|DIN|EN|ASTM|TU|ТУ)[A-ZА-Я0-9.-]*$/i;
const CLASSIFIER_DOTTED_CODE_PATTERN = /^\d{2}(?:\.\d{1,3}){1,3}$/;
const CLASSIFIER_CONTEXT_PATTERN = /\b(?:оквэд|окпд|вид\s+деятельности|classifier|classification)\b/i;
const ARTICLE_SCORE_THRESHOLDS = {
  acceptConfident: 5,
  acceptProbable: 3
};
const CERTIFICATION_CONTEXT_PATTERN = /\b(?:IP|ATEX|IECEX|EX|PTB|TR\s*CU|EAC|SIL|PL|ZONE|CATEGORY|CAT)\b/i;
const LEGAL_FORM_CONTEXT_PATTERN = /\b(?:GMBH|LLC|LTD|INC|CORP|ООО|АО|ОАО|ЗАО|ПАО)\b/i;
const ELECTRICAL_SPEC_CONTEXT_PATTERN = /\b(?:VAC|VDC|AC|DC|HZ|В|ГЦ|AMP|MA|KW|KVA|BAR|IP)\b/i;
const SHORT_PREFIX_NUMBER_PATTERN = /^[A-ZА-Я]{1,4}\s*\d(?:[./-]\d+)?$/i;
const VOLTAGE_RANGE_PATTERN = /^\d{2,4}(?:[./-]\d{1,4})\s*(?:VAC|VDC|AC|DC|В)?$/i;
const CERTIFICATE_CODE_PATTERN = /^(?:PTB\s*)?\d{2}(?:\.\d{2,6})?$/i;
const MATERIAL_OR_TYPE_FRAGMENT_PATTERN = /^(?:VA|UT|TO)\s*\d+(?:[./-]\d+)?$/i;
const STRICT_TECHNICAL_NOISE_PATTERN = /^(?:IP\s*\d{1,3}|(?:VAC|VDC|AC|DC)\s*\d+(?:[/-]\d+)*(?:HZ)?|\d+(?:[/-]\d+)*\s*(?:VAC|VDC|AC|DC|HZ))$/i;

const SEMANTIC_QUERY_STOPWORDS = new Set([
  "добрый", "день", "нужен", "нужна", "нужно", "просим", "прошу", "выставить", "счет", "счёт", "запрос",
  "цены", "цена", "линии", "линия", "мойки", "для", "это", "см", "вложение", "позиции", "позиция"
]);

const GENERIC_IMAGE_ATTACHMENT_PATTERN =
  /^(?:img|image|photo|scan|scanner|whatsapp(?:\s+image)?|dsc|dscn|pict|screenshot|screen-shot|file|pic)[-_ -]*\d[\w-]*$/i;

export function analyzeEmail(project, payload) {
  const subject = String(payload.subject || "");
  const rawBody = String(payload.body || "");
  const body = stripHtml(rawBody);
  const rawTabularFallbackItems = extractTabularReplyItemsFromBody(body);
  let { newContent, quotedContent } = separateQuotedText(body);
  // If the new content is empty/trivial but there's a forwarded message body,
  // treat the forwarded content as the primary body (manager forwarding a client request)
  const isFwdOnly = newContent.trim().length < 30 && quotedContent.length > 30
    && /^(?:Fwd|Fw|Пересл)/i.test(subject);
  if (isFwdOnly) {
    // Strip forwarded message headers (От:, Тема:, Дата:, etc.) from quoted content
    const fwdBody = quotedContent.replace(
      /^[-—–]{2,}\s*(?:Forwarded message|Пересланное сообщение|Исходное сообщение|Пересланное письмо)\s*[-—–]*/im, ""
    ).replace(/^(?:From|От|To|Кому|Sent|Отправлено|Date|Дата|Subject|Тема)\s*:.*$/gim, "").trim();
    newContent = fwdBody;
    quotedContent = "";
  }
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

  // Detect auto-replies before any entity extraction
  // Use primaryBody only — falling back to full body includes quoted history which can
  // trigger false auto-reply detection (quoted Siderus reply found in client response body)
  const autoReplyDetection = detectAutoReply(subject, primaryBody || "", fromEmail);

  // If this is a forwarded email, extract original sender from body
  const fwdInfo = extractForwardedSender(body);
  if (fwdInfo) {
    // Don't override if original sender already has a KB profile (e.g. tektorg.ru spam domain)
    const originalHasProfile = !!detectionKb.matchSenderProfile(fromEmail);
    if (fwdInfo.email && !fromEmail.includes(fwdInfo.email.split("@")[1]) && !isOwnDomain(fwdInfo.email.split("@")[1]) && !originalHasProfile) {
      fromEmail = fwdInfo.email;
      if (fwdInfo.name) fromName = fwdInfo.name;
    }
  }

  // Robot website form (robot@siderus.ru) — extract real visitor data from form fields
  let robotFormData = null;
  if (fromEmail === "robot@siderus.ru") {
    robotFormData = parseRobotFormBody(subject, body);
    // Override sender identity with real visitor data from form
    if (robotFormData.email) fromEmail = robotFormData.email;
    if (robotFormData.name) fromName = robotFormData.name;
  }

  // Tilda / third-party webform notifications (noreply@tilda.ws, etc.)
  // These are real client inquiries forwarded by the site's form service
  let tildaFormData = null;
  if (!robotFormData && isTildaWebFormSender(fromEmail)) {
    tildaFormData = parseTildaFormBody(body);
    if (tildaFormData.email) fromEmail = tildaFormData.email;
    if (tildaFormData.name) fromName = tildaFormData.name;
  }

  let quotedRobotFormData = null;
  if (!robotFormData && !tildaFormData && looksLikeQuotedRobotForm(quotedContent)) {
    quotedRobotFormData = parseRobotFormBody(subject, cleanupQuotedFormText(quotedContent));
    if (quotedRobotFormData.email) fromEmail = quotedRobotFormData.email;
    if (quotedRobotFormData.name) fromName = quotedRobotFormData.name;
  }

  // Quick classification WITHOUT attachment content (attachment reading happens below for non-spam only)
  // For auto-replies: suppress subject and body (only use preamble)
  // For robot form emails: use only the form section to avoid false brands from HTML template
  const effectivePrimaryBody = (primaryBody && primaryBody.trim().length >= 50)
    ? primaryBody
    : body.slice(0, 500);
  const bodyForClassification = autoReplyDetection.isAutoReply
    ? autoReplyDetection.preamble || ""
    : robotFormData?.formSection || tildaFormData?.formSection || quotedRobotFormData?.formSection || effectivePrimaryBody;

  const classification = classifyMessage({
    subject,
    body: bodyForClassification,
    attachments,
    fromEmail,
    projectBrands: project.brands || []
  });

  // Override classification for auto-replies
  if (autoReplyDetection.isAutoReply) {
    classification.label = "СПАМ";
    classification.confidence = Math.max(classification.confidence, 0.92);
    classification.signals.autoReply = true;
    classification.signals.autoReplyType = autoReplyDetection.type;
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "auto_reply", classifier: "spam", scope: autoReplyDetection.matchSource, pattern: autoReplyDetection.matchedPattern, weight: 10 }
    ];
  }

  // Override: resume submission from website → always spam
  if (robotFormData?.isResume && classification.label !== "СПАМ") {
    classification.label = "СПАМ";
    classification.confidence = Math.max(classification.confidence || 0, 0.95);
    classification.signals = classification.signals || {};
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "robot_resume", classifier: "spam", scope: "subject", pattern: "резюме_с_сайта", weight: 10 }
    ];
  }

  // Override: non-resume website form submission → always client (visitor contacted us)
  // Website form is set up for client inquiries; spam/vendor false positives overridden here
  if (robotFormData && !robotFormData.isResume && classification.label === "СПАМ") {
    classification.label = "Клиент";
    classification.confidence = Math.max(classification.confidence || 0, 0.75);
    classification.signals = classification.signals || {};
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "robot_form_client", classifier: "client", scope: "robot_form", pattern: "website_form_non_resume", weight: 6 }
    ];
  }

  // Override: Tilda/webform notification — real client inquiry, force Клиент
  if (tildaFormData && classification.label === "СПАМ") {
    classification.label = "Клиент";
    classification.confidence = Math.max(classification.confidence || 0, 0.82);
    classification.signals = classification.signals || {};
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "tilda_form_client", classifier: "client", scope: "tilda_form", pattern: "tilda_webform_inquiry", weight: 8 }
    ];
  }

  if (quotedRobotFormData && classification.label !== "Клиент") {
    classification.label = "Клиент";
    classification.confidence = Math.max(classification.confidence || 0, 0.82);
    classification.signals = classification.signals || {};
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "quoted_robot_form_client", classifier: "client", scope: "quoted_robot_form", pattern: "quoted_website_form_inquiry", weight: 8 }
    ];
  }

  // Filter own brands (Siderus, Коловрат, etc.) from classification results
  classification.detectedBrands = detectionKb.filterOwnBrands(classification.detectedBrands);

  // SPAM EARLY EXIT — skip attachment file reading and lead extraction
  // Still run extractSender so auto-reply senders (clients with OOO) are identified correctly
  if (classification.label === "СПАМ") {
    const spamAttachmentCount = (payload.attachmentFiles || []).length;
    const spamSender = extractSender(fromName, fromEmail, bodyForSender, attachments, signature);
    applySenderProfileHints(spamSender, classification, fromEmail);
    applyCompanyDirectoryHints(spamSender, fromEmail);
    return {
      analysisId: randomUUID(),
      createdAt: new Date().toISOString(),
      mailbox: project.mailbox,
      classification,
      sender: spamSender,
      lead: {},
      crm: null,
      detectedBrands: classification.detectedBrands,
      intakeFlow: buildIntakeFlow("СПАМ", {}, {}),
      suggestedReply: null,
      rawInput: { subject, attachments },
      attachmentAnalysis: { meta: { processedCount: 0, skippedCount: spamAttachmentCount }, combinedText: "" },
      extractionMeta: {
        signatureDetected: Boolean(signature),
        quotedTextDetected: Boolean(quotedContent),
        autoReplyDetected: autoReplyDetection.isAutoReply,
        autoReplyType: autoReplyDetection.isAutoReply ? autoReplyDetection.type : undefined,
        attachmentsProcessed: 0,
        attachmentsSkipped: spamAttachmentCount,
        spamEarlyExit: true
      }
    };
  }

  // NON-SPAM: read attachment files and run full entity extraction
  const attachmentAnalysis = analyzeStoredAttachments(
    payload.messageKey || payload.id || "",
    payload.attachmentFiles || [],
    payload.attachmentProcessingOptions || {}
  );
  const attachmentContent = sanitizeAttachmentText(attachmentAnalysis.combinedText || "");
  const brandRelevantAttachmentText = buildBrandRelevantAttachmentText(attachmentAnalysis);

  // Merge brands detected in attachment content into classification
  if (brandRelevantAttachmentText) {
    const attachmentBrands = detectionKb.filterOwnBrands(
      detectionKb.detectBrands(brandRelevantAttachmentText, project.brands || [])
    );
    if (attachmentBrands.length) {
      classification.detectedBrands = uniqueBrands([...(classification.detectedBrands || []), ...attachmentBrands]);
    }
  }

  // For subject/body extraction: use primary body + attachment content
  // For robot/tilda form emails: restrict to form section to avoid URL-slug noise
  const activeFormData = robotFormData || tildaFormData || quotedRobotFormData;
  const quotedExtractionSupplement = buildQuotedExtractionSupplement(primaryBody, quotedContent, subject);
  const bodyForExtraction = activeFormData
    ? [activeFormData.formSection, attachmentContent].filter(Boolean).join("\n\n")
    : [primaryBody || body, quotedExtractionSupplement, attachmentContent].filter(Boolean).join("\n\n");
  const subjectForExtraction = activeFormData?.product
    ? `${subject} ${activeFormData.product}`
    : subject;

  // For form emails: use form section as sender body (avoids HTML template noise)
  const senderBody = activeFormData
    ? activeFormData.formSection
    : bodyForSender;
  const sender = extractSender(fromName, fromEmail, senderBody, attachments, signature);
  const quotedSender = extractQuotedSenderFallback({
    quotedContent,
    fromName,
    fromEmail,
    attachments
  });
  mergeQuotedSenderFallback(sender, quotedSender);
  // Inject phone from form if extractSender missed it (form phone is authoritative)
  const formPhone = robotFormData?.phone || tildaFormData?.phone || quotedRobotFormData?.phone;
  if (formPhone && !sender.mobilePhone && !sender.cityPhone) {
    const { mobilePhone, cityPhone } = splitPhones([formPhone], formPhone);
    sender.mobilePhone = mobilePhone || sender.mobilePhone;
    sender.cityPhone = cityPhone || sender.cityPhone;
    if (mobilePhone || cityPhone) sender.sources.phone = activeFormData === tildaFormData ? "tilda_form" : "robot_form";
  }
  // Inject company/INN from form fields if present
  const formCompany = robotFormData?.company || tildaFormData?.company || quotedRobotFormData?.company;
  if (formCompany && !sender.companyName) {
    sender.companyName = sanitizeCompanyName(formCompany);
    sender.sources.company = activeFormData === tildaFormData ? "tilda_form" : "robot_form";
  }
  const formInn = robotFormData?.inn || tildaFormData?.inn || quotedRobotFormData?.inn;
  if (formInn && !sender.inn) {
    sender.inn = formInn;
    sender.sources.inn = activeFormData === tildaFormData ? "tilda_form" : "robot_form";
  }
  applySenderProfileHints(sender, classification, fromEmail);
  applyCompanyDirectoryHints(sender, fromEmail);
  mergeAttachmentRequisites(sender, attachmentAnalysis);
  applyCompanyDirectoryHints(sender, fromEmail);
  let lead = mergeAttachmentLeadData(
    extractLead(subjectForExtraction, bodyForExtraction, attachments, project.brands || [], classification.detectedBrands),
    attachmentAnalysis
  );
  const getConcreteItemScore = (candidateLead) => {
    const articleCount = (candidateLead.articles || []).filter((item) => item && !/^DESC:/i.test(String(item))).length;
    const lineItemCount = (candidateLead.lineItems || []).filter((item) => item?.article && !/^DESC:/i.test(String(item.article))).length;
    return articleCount * 10 + lineItemCount;
  };
  if (!(lead.articles || []).length && quotedContent) {
    const quotedBodyFallback = [primaryBody || body, cleanupQuotedFormText(quotedContent), attachmentContent].filter(Boolean).join("\n\n");
    const fallbackLead = mergeAttachmentLeadData(
      extractLead(subjectForExtraction, quotedBodyFallback, attachments, project.brands || [], classification.detectedBrands),
      attachmentAnalysis
    );
    if (getConcreteItemScore(fallbackLead) > getConcreteItemScore(lead)) {
      lead = fallbackLead;
    }
  }
  if (!(lead.articles || []).length && body && body !== bodyForExtraction) {
    const rawBodyFallback = [body, attachmentContent].filter(Boolean).join("\n\n");
    const fallbackLead = mergeAttachmentLeadData(
      extractLead(subjectForExtraction, rawBodyFallback, attachments, project.brands || [], classification.detectedBrands),
      attachmentAnalysis
    );
    if (getConcreteItemScore(fallbackLead) > getConcreteItemScore(lead)) {
      lead = fallbackLead;
    }
  }
  if (!(lead.articles || []).length) {
    const tabularFallbackItems = rawTabularFallbackItems;
    if (tabularFallbackItems.length) {
      const existingArticleSet = new Set((lead.lineItems || []).map((item) => normalizeArticleCode(item.article)).filter(Boolean));
      lead.lineItems = [...(lead.lineItems || [])];
      lead.productNames = [...(lead.productNames || [])];
      lead.articles = [...(lead.articles || [])];
      for (const item of tabularFallbackItems) {
        const normalizedArticle = normalizeArticleCode(item.article);
        if (!existingArticleSet.has(normalizedArticle)) {
          lead.lineItems.push(item);
          existingArticleSet.add(normalizedArticle);
        }
        if (!lead.articles.includes(normalizedArticle)) {
          lead.articles.push(normalizedArticle);
        }
        if (!lead.productNames.some((entry) => normalizeArticleCode(entry.article) === normalizedArticle)) {
          lead.productNames.push({
            article: normalizedArticle,
            name: sanitizeProductNameCandidate(String(item.descriptionRu || "").replace(new RegExp(`\\s+${escapeRegExp(normalizedArticle)}$`, "i"), "")) || null,
            category: null
          });
        }
      }
      lead.totalPositions = Math.max(lead.totalPositions || 0, lead.lineItems.length, lead.articles.length);
      if (lead.articles.length && /^Не определено/.test(String(lead.requestType || ""))) {
        lead.requestType = "Не определено (есть артикулы)";
      }
    }
  }
  if (!(lead.articles || []).length) {
    const directTabularPattern = /(?:^|[\n\r]|\s{2,})(?:№\s+Наименование\s+Кол-?во\s+Ед\.?изм\.?\s*)?(\d{1,3})\s+(.+?)\s+(\d{5,9})\s+(?:(?:[A-Za-zА-ЯЁа-яё]{1,5}\s+){0,3})?\d{1,4}[xх×*]\d{1,4}(?:[xх×*]\d{1,4})?(?:\s*[A-Za-zА-Яа-яЁё"]{0,4})?\s+(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?(?=$|[\n\r]|\s{2,})/gi;
    const directMatches = [...String(body || "").matchAll(directTabularPattern)];
    if (directMatches.length) {
      lead.lineItems = [...(lead.lineItems || [])];
      lead.productNames = [...(lead.productNames || [])];
      lead.articles = [...(lead.articles || [])];
      const existingArticleSet = new Set(lead.articles.map((item) => normalizeArticleCode(item)).filter(Boolean));
      for (const match of directMatches) {
        const article = normalizeArticleCode(match[3]);
        const productName = sanitizeProductNameCandidate(match[2]) || null;
        if (!article || existingArticleSet.has(article)) continue;
        existingArticleSet.add(article);
        lead.articles.push(article);
        lead.lineItems.push({
          article,
          quantity: Math.round(parseFloat(String(match[4]).replace(",", "."))) || 1,
          unit: match[5] || "шт",
          descriptionRu: productName ? `${productName} ${article}` : article,
          explicitArticle: true,
          sourceLine: cleanup(match[0])
        });
        lead.productNames.push({ article, name: productName, category: null });
      }
      lead.totalPositions = Math.max(lead.totalPositions || 0, lead.lineItems.length, lead.articles.length);
      if (lead.articles.length && /^Не определено/.test(String(lead.requestType || ""))) {
        lead.requestType = "Не определено (есть артикулы)";
      }
    }
  }
  if ((lead.articles || []).some((item) => item && !/^DESC:/i.test(String(item)))) {
    lead.lineItems = (lead.lineItems || []).filter((item) => {
      if (!item?.article || !/^DESC:/i.test(String(item.article))) return true;
      return !/^(?:минимальная цена|цена|стоимость|наличие|срок поставки)$/i.test(cleanup(item.descriptionRu || ""));
    });
    lead.totalPositions = Math.max(lead.lineItems.length, (lead.articles || []).length);
  }
  enrichLeadFromKnowledgeBase(lead, classification, project, [subjectForExtraction, bodyForExtraction, attachmentContent].filter(Boolean).join("\n\n"));
  if (!lead.detectedBrands?.length && classification.detectedBrands?.length) {
    lead.detectedBrands = [...classification.detectedBrands];
  } else if (classification.detectedBrands?.length) {
    lead.detectedBrands = uniqueBrands([...lead.detectedBrands, ...classification.detectedBrands]);
  }
  if (!lead.sources) lead.sources = {};
  lead.sources.brands = summarizeSourceList(classification.brandSources || [], (lead.detectedBrands || []).length > 0);
  hydrateRecognitionSummary(lead, sender);
  hydrateRecognitionDiagnostics(lead, sender, attachmentAnalysis, classification);
  hydrateRecognitionDecision(lead, sender, attachmentAnalysis, classification);

  // Post-correction: if classification couldn't decide but lead has articles → likely a client
  if (classification.label === "Не определено" && lead.articles?.length > 0) {
    classification.label = "Клиент";
    classification.confidence = Math.max(classification.confidence || 0, 0.6);
    classification.signals = classification.signals || {};
    classification.signals.matchedRules = [
      ...(classification.signals.matchedRules || []),
      { id: "articles_post_correction", classifier: "client", scope: "lead", pattern: "articles_detected", weight: 3 }
    ];
  }

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
    detectedBrands: uniqueBrands(detectionKb.filterOwnBrands(lead.detectedBrands)).slice(0, 15),
    intakeFlow: buildIntakeFlow(classification.label, crm, lead),
    suggestedReply,
    rawInput: {
      subject,
      attachments
    },
    attachmentAnalysis,
    extractionMeta: {
      signatureDetected: Boolean(signature),
      quotedTextDetected: Boolean(quotedContent),
      autoReplyDetected: autoReplyDetection.isAutoReply,
      autoReplyType: autoReplyDetection.isAutoReply ? autoReplyDetection.type : undefined,
      attachmentsProcessed: attachmentAnalysis.meta.processedCount,
      attachmentsSkipped: attachmentAnalysis.meta.skippedCount
    }
  };
}

/**
 * Async version of analyzeEmail that uses AI classification and LLM extraction.
 * Falls back to pure rules-based when AI/LLM is disabled.
 */
export async function analyzeEmailAsync(project, payload) {
  const result = analyzeEmail(project, payload);

  // --- Step 1: Hybrid AI classification (for uncertain cases) ---------------
  if (isAiEnabled()) {
    try {
      const enhanced = await hybridClassify(result.classification, {
        subject: payload.subject || "",
        body: payload.body || "",
        fromEmail: payload.fromEmail || "",
        attachments: normalizeAttachments(payload.attachments)
      });

      if (enhanced.detectedBrands?.length) {
        const allBrands = [...new Set([...result.detectedBrands, ...detectionKb.filterOwnBrands(enhanced.detectedBrands)])];
        result.detectedBrands = allBrands;
      }

      result.classification = enhanced;
      result.aiConfig = getAiConfig();
    } catch {
      // AI failure — use rules result silently
    }
  }

  // --- Step 2: LLM final-pass extraction ------------------------------------
  // Skip: LLM disabled, spam emails, or already processed (idempotency)
  const isSpam = result.classification?.label === "СПАМ";
  const alreadyProcessed = Boolean(result.llmExtraction?.processedAt);

  if (isLlmExtractEnabled() && !isSpam && !alreadyProcessed) {
    try {
      const rulesFound = buildRulesFoundSummary(result);
      const attachmentText = result.attachmentAnalysis?.combinedText || "";

      const llmData = await llmExtract({
        subject: payload.subject || "",
        body: payload.body || "",
        fromEmail: payload.fromEmail || "",
        attachmentText,
        rulesFound
      });

      mergeLlmExtraction(result, llmData, payload.messageKey || payload.id || "");
      result.llmConfig = getLlmExtractConfig();
    } catch (err) {
      console.warn("LLM extraction step failed:", err.message);
    }
  }

  return result;
}

function sanitizeAttachmentText(text) {
  // Strip PDF/Office noise tokens from attachment combined text before article extraction
  return String(text || "")
    .replace(/\b\d+Roman\b/gi, "")                              // Word style: 20Roman
    .replace(/\b0{3,}\d?[A-Z]\b/gi, "")                         // PDF Unicode escapes: 000A, 004O
    .replace(/\b\d{4}\/\d{2}\/\d{2}-[a-z-]+/gi, "")             // RDF namespace paths
    .replace(/\b(?:XYZ|RGB|CMYK)\s+\d/gi, "")                   // Color space: XYZ 0, RGB 255
    .replace(/\b0001-000\d\b/g, "")                              // PDF xref offsets: 0001-0000
    .replace(/\b(?:WRD000\d|WW8\w+)\b/gi, "")                   // Word internal: WRD0002, WW8Num1z0
    .replace(/\b\d{2}-(?:19|20)\d{2}\b/g, "")                   // Date: 01-2026
    .replace(/\b0-\d{2,4}\b/g, "")                               // Range: 0-100
    .replace(/\b(?:19|20)\d{2}\b/g, "")                          // Standalone years: 2025, 2026
    .replace(/\b1000\b/g, "")                                    // PDF font metric DW 1000
    .replace(/\b(?:CALIBRI|ARIAL|TIMES)\d*\b/gi, "")             // PDF font names
    .replace(/\b(?:CAOLAN|ALLLEX|ALFABY)\w*\b/gi, "");           // PDF producer names
}

function extractTabularReplyItemsFromBody(text) {
  const source = String(text || "");
  const pattern = /(?:^|[\n\r]|\s{2,})(?:№\s+Наименование\s+Кол-?во\s+Ед\.?изм\.?\s*)?(\d{1,3})\s+(.+?)\s+((?:\d{5,9})|(?:[A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8}))\s+(?:(?:[A-Za-zА-ЯЁа-яё]{1,5}\s+){0,3})?\d{1,4}[xх×*]\d{1,4}(?:[xх×*]\d{1,4})?(?:\s*[A-Za-zА-Яа-яЁё"]{0,4})?\s+(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?(?=$|[\n\r]|\s{2,})/gi;
  const items = [];
  for (const match of source.matchAll(pattern)) {
    const article = normalizeArticleCode(match[3]);
    const description = cleanup(match[2]);
    const sourceLine = cleanup(match[0]);
    if (!article || isObviousArticleNoise(article, sourceLine)) continue;
    if (items.some((item) => normalizeArticleCode(item.article) === article)) continue;
    items.push({
      article,
      quantity: Math.round(parseFloat(String(match[4]).replace(",", "."))) || 1,
      unit: match[5] || "шт",
      descriptionRu: description ? `${description} ${article}`.trim() : article,
      explicitArticle: true,
      sourceLine
    });
  }
  return items;
}

function buildBrandRelevantAttachmentText(attachmentAnalysis = {}) {
  const files = attachmentAnalysis.files || [];
  return files
    .filter((file) => file.status === "processed")
    .filter((file) => !["requisites", "invoice"].includes(file.category))
    .map((file) => sanitizeAttachmentText(file.preview || ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function cleanupQuotedFormText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
}

function looksLikeQuotedRobotForm(text) {
  const value = cleanupQuotedFormText(text);
  if (!value) return false;
  return /(?:robot@siderus\.ru|Вопрос через обратную связь с сайта SIDERUS|Имя посетителя:|Новый вопрос на сайте SIDERUS)/i.test(value);
}

function buildQuotedExtractionSupplement(primaryBody, quotedContent, subject = "") {
  const currentBody = String(primaryBody || "").trim();
  const quoted = cleanupQuotedFormText(quotedContent);
  if (!quoted) return "";

  const isShortCurrentReply = currentBody.length > 0 && currentBody.length <= 220;
  const hasInlineRequestSignals = /(?:артикул|наименование|кол-?во|ед\.?изм|цена|срок|поставка|запрос|кп|quotation|rfq|имя посетителя|вопрос:|телефон:)/i.test(quoted);
  const isReplyThread = /^(?:re|fw|fwd)\s*:/i.test(String(subject || "").trim());

  if (!((isShortCurrentReply && hasInlineRequestSignals) || looksLikeQuotedRobotForm(quoted) || (isReplyThread && hasInlineRequestSignals))) {
    return "";
  }

  return quoted
    .replace(/^(?:To|Кому|Subject|Тема|Date|Дата|Sent|Отправлено)\s*:.*$/gim, "")
    .replace(/^(?:\d{2}\.\d{2}\.\d{4}|\d{1,2}\s+[а-яa-z]+)\S*.*<[^>]+>:\s*$/gim, "")
    .trim()
    .slice(0, 3000);
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

function applySenderProfileHints(sender, classification, fromEmail) {
  const profile = detectionKb.matchSenderProfile(fromEmail);
  if (!profile) return;
  if (!sender.sources) sender.sources = {};

  const hintedCompany = String(profile.company_hint || "").trim();
  const companyFromDomainOrAbsent = !sender.companyName || sender.sources?.company === "email_domain";
  if (hintedCompany && companyFromDomainOrAbsent) {
    sender.companyName = hintedCompany;
    sender.sources.company = "sender_profile";
  }

  const hintedBrands = unique(
    String(profile.brand_hint || "")
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
  if (hintedBrands.length > 0) {
    classification.detectedBrands = detectionKb.filterOwnBrands(unique([...(classification.detectedBrands || []), ...hintedBrands]));
    classification.brandSources = unique([...(classification.brandSources || []), "sender_profile"]);
  }
}

function applyCompanyDirectoryHints(sender, fromEmail) {
  const directoryEntry = detectionKb.lookupCompanyDirectory({
    email: fromEmail,
    inn: sender.inn,
    domain: String(fromEmail || "").split("@")[1] || "",
    companyName: sender.companyName
  });
  if (!directoryEntry) return;
  if (!sender.sources) sender.sources = {};

  if (!sender.companyName || inferCompanyNameFromEmail(fromEmail) === sender.companyName) {
    if (directoryEntry.company_name) {
      sender.companyName = directoryEntry.company_name;
      sender.sources.company = "company_directory";
    }
  }
  if (!sender.inn && directoryEntry.inn) {
    sender.inn = directoryEntry.inn;
    sender.sources.inn = "company_directory";
  }
  if (!sender.position && directoryEntry.contact_position) {
    sender.position = directoryEntry.contact_position;
    sender.sources.position = "company_directory";
  }
  if (!sender.fullName && directoryEntry.contact_name) {
    sender.fullName = directoryEntry.contact_name;
    sender.sources.name = "company_directory";
  }
}

function mergeAttachmentRequisites(sender, attachmentAnalysis) {
  const files = attachmentAnalysis?.files || [];
  const allInn = [...new Set(files.flatMap((file) => file.detectedInn || []))];
  const allKpp = [...new Set(files.flatMap((file) => file.detectedKpp || []))];
  const allOgrn = [...new Set(files.flatMap((file) => file.detectedOgrn || []))];

  if (!sender.sources) sender.sources = {};
  if (!sender.inn && allInn.length >= 1) {
    // Prefer INN from a file that also has КПП (more authoritative requisite document)
    const innWithKpp = files.find((file) => (file.detectedInn || []).length > 0 && (file.detectedKpp || []).length > 0);
    sender.inn = innWithKpp ? innWithKpp.detectedInn[0] : allInn[0];
    sender.sources.inn = "attachment";
  }
  if (!sender.kpp && allKpp.length === 1) {
    sender.kpp = allKpp[0];
    sender.sources.kpp = "attachment";
  }
  if (!sender.ogrn && allOgrn.length === 1) {
    sender.ogrn = allOgrn[0];
    sender.sources.ogrn = "attachment";
  }
}

function enrichLeadFromKnowledgeBase(lead, classification, project, searchText = "") {
  if (!lead.sources) lead.sources = {};
  const hasConcreteArticles = (lead.articles || []).some((item) => item && !/^DESC:/i.test(String(item)));
  if (!hasConcreteArticles) {
    return;
  }
  if ((lead.detectedBrands || []).length > 0 || (classification.detectedBrands || []).length > 0) {
    return;
  }
  const brandCandidates = new Map();
  const queries = [
    ...(lead.productNames || []).map((item) => item?.name),
    ...(lead.lineItems || []).map((item) => item?.descriptionRu),
    ...String(searchText || "").split(/\r?\n/).slice(0, 8)
  ]
    .map((value) => cleanup(value))
    .filter(Boolean)
    .filter((value) => value.length >= 8)
    .filter((value) => !/^(?:ооо|ао|оао|зао|пао|ип)\b/i.test(value))
    .slice(0, 12);

  for (const query of queries) {
    const semanticMatches = [
      ...detectionKb.findNomenclatureCandidates({ text: query, limit: 5 }),
      ...findSemanticNomenclatureMatches(query)
    ];
    for (const match of semanticMatches) {
      const brand = cleanup(match?.brand || "");
      if (!brand) continue;
      const current = brandCandidates.get(brand) || { score: 0, matches: 0 };
      current.matches += 1;
      current.score += (/semantic/.test(String(match.match_type || "")) ? 2 : 1) + Math.min(Number(match.source_rows || 0), 5);
      brandCandidates.set(brand, current);
    }
  }

  if (brandCandidates.size > 0) {
    const rankedBrands = [...brandCandidates.entries()]
      .sort((left, right) => right[1].score - left[1].score || right[1].matches - left[1].matches)
      .map(([brand]) => brand);
    const topBrand = rankedBrands[0];
    if (topBrand) {
      lead.detectedBrands = detectionKb.filterOwnBrands(uniqueBrands([...(lead.detectedBrands || []), topBrand]));
      classification.detectedBrands = detectionKb.filterOwnBrands(uniqueBrands([...(classification.detectedBrands || []), topBrand]));
      lead.sources.brands = summarizeSourceList([...(lead.sources.brands || []), "nomenclature_semantic"], true);
    }
  }
}

function findSemanticNomenclatureMatches(query) {
  const cleaned = cleanup(query);
  if (!cleaned) return [];

  const tokenQueries = [cleaned];
  const tokens = cleaned
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 4)
    .filter((item) => !SEMANTIC_QUERY_STOPWORDS.has(item))
    .slice(0, 6);

  if (tokens.length >= 2) tokenQueries.push(tokens.slice(0, 2).join(" "));
  if (tokens.length >= 3) tokenQueries.push(tokens.slice(0, 3).join(" "));
  tokenQueries.push(...tokens);

  const matches = [];
  for (const tokenQuery of tokenQueries) {
    for (const item of detectionKb.searchNomenclature(tokenQuery, { limit: 3 })) {
      if (!matches.some((existing) => existing.article_normalized === item.article_normalized)) {
        matches.push({ ...item, match_type: "semantic_token" });
      }
    }
  }

  return matches;
}

function hydrateRecognitionSummary(lead, sender) {
  if (!lead.recognitionSummary) lead.recognitionSummary = {};
  lead.recognitionSummary.phone = Boolean(sender.cityPhone || sender.mobilePhone);
  lead.recognitionSummary.company = Boolean(sender.companyName);
  lead.recognitionSummary.inn = Boolean(sender.inn);
  const missing = [];
  if (!lead.recognitionSummary.article) missing.push("article");
  if (!lead.recognitionSummary.brand) missing.push("brand");
  if (!lead.recognitionSummary.name) missing.push("name");
  if (!lead.recognitionSummary.phone) missing.push("phone");
  if (!lead.recognitionSummary.company) missing.push("company");
  if (!lead.recognitionSummary.inn) missing.push("inn");
  lead.recognitionSummary.missing = missing;
}

function hydrateRecognitionDiagnostics(lead, sender, attachmentAnalysis, classification) {
  const diagnostics = buildRecognitionDiagnostics(lead, sender, attachmentAnalysis, classification);
  lead.recognitionDiagnostics = diagnostics;
  if (!lead.recognitionSummary) lead.recognitionSummary = {};
  lead.recognitionSummary.completenessScore = diagnostics.completenessScore;
  lead.recognitionSummary.overallConfidence = diagnostics.overallConfidence;
  lead.recognitionSummary.riskLevel = diagnostics.riskLevel;
  lead.recognitionSummary.primaryIssue = diagnostics.primaryIssue;
  lead.recognitionSummary.hasConflicts = diagnostics.conflicts.length > 0;
}

function hydrateRecognitionDecision(lead, sender, attachmentAnalysis, classification) {
  lead.recognitionDecision = buildRecognitionDecision(lead, sender, attachmentAnalysis, classification);
}

/**
 * Detect auto-reply / notification emails that echo back the original request body.
 * Returns { isAutoReply, type, preamble, matchSource, matchedPattern }
 * preamble = the auto-reply's own text (before the embedded original message)
 */
function detectAutoReply(subject, body, fromEmail) {
  const result = { isAutoReply: false, type: null, preamble: "", matchSource: null, matchedPattern: null };

  // Check noreply-style sender addresses
  const noReplyDomain = /^(?:noreply|no-reply|no_reply|mailer-daemon|postmaster|system|notification|support-noreply|helpdesk)@/i;
  const isNoReplySender = noReplyDomain.test(fromEmail);

  // Check subject patterns
  for (const pattern of AUTO_REPLY_SUBJECT_PATTERNS) {
    if (pattern.test(subject)) {
      result.isAutoReply = true;
      result.type = "auto_reply_subject";
      result.matchSource = "subject";
      result.matchedPattern = pattern.source.slice(0, 60);
      break;
    }
  }

  // Check body patterns (first ~600 chars — auto-reply preamble is always at the top)
  if (!result.isAutoReply) {
    const bodyHead = body.slice(0, 600);
    for (const pattern of AUTO_REPLY_BODY_PATTERNS) {
      if (pattern.test(bodyHead)) {
        result.isAutoReply = true;
        result.type = "auto_reply_body";
        result.matchSource = "body";
        result.matchedPattern = pattern.source.slice(0, 60);
        break;
      }
    }
  }

  // noreply@ sender + any body pattern relaxes threshold
  if (!result.isAutoReply && isNoReplySender) {
    // noreply senders with very short body or ticket-like body → auto-reply
    // Exception: form submission emails from noreply senders contain structured fields (Name:, phone:, comment:)
    const bodyHead = body.slice(0, 600);
    const isFormSubmission = /(?:name|имя|фио|phone|телефон|комментарий|comment)\s*:/i.test(bodyHead);
    if (!isFormSubmission && (body.length < 200 || /(?:номер|ticket|#|№)\s*\d+/i.test(bodyHead))) {
      result.isAutoReply = true;
      result.type = "noreply_sender";
      result.matchSource = "from";
      result.matchedPattern = fromEmail;
    }
  }

  // Extract preamble: the auto-reply's own text before embedded original
  if (result.isAutoReply) {
    result.preamble = extractAutoReplyPreamble(body);
  }

  return result;
}

/**
 * Extract just the auto-reply's own text, before the embedded copy of the original message.
 * This prevents brands/articles from the original request leaking into detection.
 */
function extractAutoReplyPreamble(body) {
  const lines = body.split(/\r?\n/);
  const preambleLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Check if this line starts the embedded original message
    if (AUTO_REPLY_EMBED_PATTERNS.some((p) => p.test(trimmed))) break;
    if (QUOTE_PATTERNS.some((p) => p.test(trimmed))) break;
    preambleLines.push(line);
  }

  return preambleLines.join("\n").trim();
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

function extractSender(fromName, fromEmail, body, attachments, signature = "") {
  const urls = body.match(URL_PATTERN) || [];
  const phones = body.match(PHONE_PATTERN) || [];
  const requisites = extractRequisites(body);
  // Filter out own URLs from detected links
  const externalUrls = urls.filter((u) => {
    const domain = extractDomainFromUrl(u);
    return domain && !OWN_DOMAINS.has(domain) && !isTrackingHost(domain);
  });
  const extractedCompanyName = extractCompanyName(body, signature);
  const inferredCompanyName = inferCompanyNameFromEmail(fromEmail);
  // Domain fallback: last resort if nothing found in body/signature
  const domainCompanyName = (!extractedCompanyName && !inferredCompanyName)
    ? inferCompanyFromDomain(fromEmail)
    : null;
  const companyName = sanitizeCompanyName(extractedCompanyName || inferredCompanyName || domainCompanyName);
  const fullName = fromName || extractFullNameFromBody(body) || inferNameFromEmail(fromEmail) || "Не определено";
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
    legalCardAttached,
    sources: {
      company: extractedCompanyName ? "body" : (inferredCompanyName || domainCompanyName) ? "email_domain" : null,
      website: externalUrls[0] ? "body" : website ? "email_domain" : null,
      phone: cityPhone || mobilePhone ? "body" : null,
      inn: requisites.inn ? "body" : null,
      kpp: requisites.kpp ? "body" : null,
      ogrn: requisites.ogrn ? "body" : null
    }
  };
}

function detectUrgency(text) {
    const urgentPatterns = [
        /срочн|urgent|asap|немедленн|в кратчайш|до конца дня|сегодня|безотлагательн/i,
        /в\s+срочном\s+порядке|как\s+можно\s+(?:скорее|быстрее)|по\s+быстрому/i,
        /простой|стоит\s+линия|стоит\s+оборудование|авари[йя]|остановка\s+(?:линии|производства|цеха)/i,
        /горит\s+(?:срок|заказ|поставка)|не\s+терпит\s+отлагательств/i
    ];
    for (const p of urgentPatterns) {
        if (p.test(text)) return "urgent";
    }
    const plannedPatterns = [
        /плановая|план(?:ируем|овый)|ближайш|на следующ/i,
        /в\s+течени[ие]\s+(?:месяца|квартала|года)/i,
        /на\s+(?:перспективу|будущее|следующий\s+(?:месяц|квартал|год))/i
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
    .map((match) => ({
      article: normalizeArticleCode(match[1]),
      sourceLine: getContextLine(body, match.index, match[0]?.length || String(match[1] || "").length)
    }))
    .filter((item) => isLikelyArticle(item.article, forbiddenDigits, item.sourceLine))
    .map((item) => item.article);
  const standaloneArticles = extractStandaloneCodes(body, forbiddenDigits);
  const numericArticles = extractNumericArticles(body, forbiddenDigits);
  const strongContextArticles = extractStrongContextArticles(body, forbiddenDigits);
  const trailingMixedArticles = extractTrailingMixedArticles(body, forbiddenDigits);
  const productContextArticles = extractProductContextArticles(body, forbiddenDigits);
  const subjectArticles = extractArticlesFromSubject(subject, forbiddenDigits);
  const attachmentArticles = extractArticlesFromAttachments(attachments, forbiddenDigits);
  const brandAdjacentCodes = extractBrandAdjacentCodes(body, forbiddenDigits);
  const allArticles = unique([...subjectArticles, ...prefixedArticles, ...standaloneArticles, ...numericArticles, ...strongContextArticles, ...trailingMixedArticles, ...productContextArticles, ...attachmentArticles, ...brandAdjacentCodes].filter(Boolean));
  const attachmentsText = attachments.join(" ");
  const hasNameplatePhotos = /шильд|nameplate/i.test(attachmentsText);
  const hasArticlePhotos = /артик|sku|label/i.test(attachmentsText);
  const lineItems = extractLineItems(body).filter((item) => {
    if (!item.article) return false;
    const context = [item.sourceLine, item.descriptionRu, item.source].filter(Boolean).join(" ");
    return !isObviousArticleNoise(item.article, context || body) && (item.explicitArticle || isLikelyArticle(item.article, forbiddenDigits, context || body));
  }).map((item) => ({ ...item, source: item.source || "body" }));
  // Limit brand scan text to avoid attachment-bomb hallucinations (large catalogs / PDFs)
  const brandScanBody = body.length > 6000 ? body.slice(0, 6000) : body;
  const rawBrands = unique(kbBrands.concat(detectBrands([subject, brandScanBody, attachmentsText].join("\n"), brands)));
  let detectedBrands = detectionKb.filterOwnBrands(rawBrands);
  const explicitTextBrands = [...detectedBrands];

  const attachmentHints = parseAttachmentHints(attachments);

  const detectedProductTypes = detectProductTypes([subject, body].join("\n"));
  const explicitArticles = lineItems
    .filter((item) => item.explicitArticle)
    .map((item) => normalizeArticleCode(item.article));
  const mergedArticleCandidates = unique(allArticles.concat(lineItems.map((item) => normalizeArticleCode(item.article))).filter(Boolean));
  const finalArticles = mergedArticleCandidates
    .filter((article) => !explicitArticles.some((full) => full !== article && full.includes(article) && article.length + 2 <= full.length))
    .filter((article) => !mergedArticleCandidates.some((full) => {
      if (full === article || !full.includes(article) || article.length + 2 > full.length) {
        return false;
      }
      if (/^\d+$/.test(article) && new RegExp(`^[A-ZА-ЯЁ]+[-/.]${escapeRegExp(article)}$`, "i").test(full)) {
        return false;
      }
      return true;
    }))
    .filter((article) => !(/^\d{2,4}-\d{2,4}$/.test(article) && /\b(?:vac|vdc|ac|dc|питание|напряжение|voltage)\b/i.test(searchText)));
  const nomenclatureMatches = finalArticles
    .map((article) => {
      const candidates = detectionKb.findNomenclatureCandidates({
        article,
        text: searchText,
        brands: detectedBrands,
        limit: 3
      });
      return candidates.find((item) => normalizeArticleCode(item.article) === normalizeArticleCode(article)) || null;
    })
    .filter(Boolean);

  detectedBrands = detectionKb.filterOwnBrands(unique([
    ...detectedBrands,
    ...(explicitTextBrands.length === 0 ? nomenclatureMatches.map((item) => item.brand).filter(Boolean) : [])
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

  // ── Merge free-text positions (no explicit article code) ──
  // Pass allArticles so extractFreeTextItems can skip lines that already have a real article code
  const existingArticles = unique([
    ...lineItems.map((i) => normalizeArticleCode(i.article)),
    ...allArticles
  ].filter(Boolean));
  const freetextItems = extractFreeTextItems(body, detectedBrands, existingArticles);
  for (const ftItem of freetextItems) {
    // Only add if no structurally-detected item shares the same article
    if (!lineItems.some((i) => i.article === ftItem.article)) {
      lineItems.push(ftItem);
    }
  }

  // ── Bridge: articles detected in text but not yet in lineItems ──
  // Ensures every article from finalArticles has a corresponding lineItem entry
  const bridgedArticleSet = new Set(lineItems.map((i) => normalizeArticleCode(i.article)).filter(Boolean));
  const bodyDerivedArticleSet = new Set(
      [...subjectArticles, ...prefixedArticles, ...standaloneArticles, ...numericArticles,
       ...strongContextArticles, ...trailingMixedArticles, ...productContextArticles, ...brandAdjacentCodes]
      .map(normalizeArticleCode).filter(Boolean)
  );
  for (const article of finalArticles) {
      const normArt = normalizeArticleCode(article);
      if (bridgedArticleSet.has(normArt)) continue;
      // Only bridge alphanumeric codes — pure-digit codes need original context to validate
      // (phone numbers, OKPO codes, etc. are always digit-only and sneak through via explicitArticle)
      if (!/[A-Za-zА-ЯЁа-яё]/.test(article)) continue;
      const pn = productNames.find((p) => normalizeArticleCode(p.article) === normArt);
      lineItems.push({
          article,
          quantity: null,
          unit: "шт",
          descriptionRu: pn?.name || null,
          source: bodyDerivedArticleSet.has(normArt) ? "body" : "attachment",
          explicitArticle: false
      });
      bridgedArticleSet.add(normArt);
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

function mergeAttachmentLeadData(lead, attachmentAnalysis = {}) {
  const files = attachmentAnalysis.files || [];
  const attachmentLineItems = files.flatMap((file) => (file.lineItems || []).map((item) => {
    const article = item.article ? normalizeArticleCode(item.article) : null;
    return {
      article: article && !isObviousArticleNoise(article, item.descriptionRu || "") ? article : null,
      quantity: item.quantity ?? null,
      unit: item.unit || "шт",
      descriptionRu: item.descriptionRu || null,
      source: item.source || `attachment:${file.filename || "file"}`
    };
  }));

  // Truncate oversized descriptions (garbage from unstructured PDFs)
  for (const item of attachmentLineItems) {
    if (item.descriptionRu && item.descriptionRu.length > 200) {
      item.descriptionRu = item.descriptionRu.slice(0, 200);
    }
  }

  const mergedLineItems = [...(lead.lineItems || [])];
  for (const item of attachmentLineItems) {
    if (!item.article && !item.descriptionRu) continue;
    // Skip if description is likely garbage (garbled chars, excessive spaces)
    if (!item.article && item.descriptionRu) {
      const desc = item.descriptionRu;
      const spaceRatio = (desc.match(/\s/g) || []).length / desc.length;
      if (spaceRatio > 0.4) continue; // more than 40% whitespace = garbled PDF
    }
    const existing = mergedLineItems.find((current) =>
      normalizeArticleCode(current.article) === normalizeArticleCode(item.article) ||
      (!!item.descriptionRu && current.descriptionRu === item.descriptionRu)
    );
    if (!existing) {
      mergedLineItems.push(item);
      continue;
    }
    if ((!existing.quantity || existing.quantity === 1) && item.quantity) existing.quantity = item.quantity;
    if ((!existing.descriptionRu || existing.descriptionRu === existing.article) && item.descriptionRu) existing.descriptionRu = item.descriptionRu;
    if (!existing.unit && item.unit) existing.unit = item.unit;
    if (!existing.source && item.source) existing.source = item.source;
  }

  // Validate attachment-derived articles through the same noise/scoring pipeline
  const validatedAttachmentArticles = files
    .flatMap((file) => file.detectedArticles || [])
    .map(normalizeArticleCode)
    .filter((code) => code && !isObviousArticleNoise(code, ""));

  const mergedArticles = unique([
    ...(lead.articles || []),
    ...attachmentLineItems.map((item) => item.article).filter(Boolean),
    ...validatedAttachmentArticles
  ].filter(Boolean));

  const mergedProductNames = [...(lead.productNames || [])];
  for (const item of attachmentLineItems) {
    if (!item.article || !item.descriptionRu) continue;
    if (mergedProductNames.some((entry) => normalizeArticleCode(entry.article) === normalizeArticleCode(item.article))) continue;
    mergedProductNames.push({
      article: item.article,
      name: item.descriptionRu,
      category: null,
      source: item.source
    });
  }

  lead.lineItems = mergedLineItems;
  lead.articles = mergedArticles;
  lead.productNames = mergedProductNames;
  lead.totalPositions = mergedLineItems.length || mergedArticles.length;
  lead.sources = buildLeadSources(lead, files);
  lead.recognitionSummary = buildRecognitionSummary(lead, files);
  return lead;
}

function buildLeadSources(lead, attachmentFiles = []) {
  return {
    articles: summarizeSourceList((lead.lineItems || []).map((item) => item.source).filter(Boolean), lead.articles?.length > 0),
    names: summarizeSourceList([
      ...(lead.productNames || []).map((item) => item.source).filter(Boolean),
      ...(lead.lineItems || []).filter((item) => item.descriptionRu).map((item) => item.source).filter(Boolean)
    ], getResolvedProductNameCount(lead) > 0),
    attachmentsProcessed: attachmentFiles.filter((file) => file.status === "processed").map((file) => file.filename)
  };
}

function buildRecognitionSummary(lead, attachmentFiles = []) {
  const nameCount = getResolvedProductNameCount(lead);
  const hasParsedAttachment = attachmentFiles.some((file) => file.status === "processed");
  const missing = [];
  if (!(lead.articles || []).length) missing.push("article");
  if (!(lead.detectedBrands || []).length) missing.push("brand");
  if (!nameCount) missing.push("name");
  return {
    article: (lead.articles || []).length > 0,
    brand: (lead.detectedBrands || []).length > 0,
    name: nameCount > 0,
    phone: null,
    company: null,
    inn: null,
    parsedAttachment: hasParsedAttachment,
    missing
  };
}

function buildRecognitionDecision(lead, sender, attachmentAnalysis = {}, classification = {}) {
  const diagnostics = lead.recognitionDiagnostics || {};
  const attachmentFiles = attachmentAnalysis.files || [];
  const matchedRules = classification.signals?.matchedRules || [];
  const triggerSignals = [];

  if ((lead.articles || []).length > 0) triggerSignals.push(`артикулы:${(lead.articles || []).slice(0, 3).join(", ")}`);
  if ((lead.detectedBrands || []).length > 0) triggerSignals.push(`бренды:${(lead.detectedBrands || []).slice(0, 3).join(", ")}`);
  if (sender.companyName) triggerSignals.push(`компания:${sender.companyName}`);
  if (sender.inn) triggerSignals.push(`ИНН:${sender.inn}`);
  if (attachmentFiles.some((file) => file.status === "processed")) triggerSignals.push(`вложения:${attachmentFiles.filter((file) => file.status === "processed").length}`);
  if (matchedRules.length > 0) triggerSignals.push(`правила:${matchedRules.slice(0, 2).map((rule) => rule.classifier).join(",")}`);

  return {
    priority: deriveLeadPriority(lead, diagnostics, attachmentFiles),
    failureReason: summarizeFailureReason(lead, diagnostics, attachmentFiles),
    decisionReason: summarizeDecisionReason(lead, sender, classification, triggerSignals),
    suggestion: summarizeDecisionSuggestion(lead, diagnostics),
    triggerSignals,
    pipeline: {
      bodyArticles: (lead.lineItems || []).filter((item) => String(item.source || "") === "body" && item.article).length,
      attachmentArticles: (lead.lineItems || []).filter((item) => String(item.source || "").startsWith("attachment:") && item.article).length,
      matchedRuleCount: matchedRules.length,
      processedAttachments: attachmentFiles.filter((file) => file.status === "processed").length
    }
  };
}

function deriveLeadPriority(lead, diagnostics, attachmentFiles) {
  if (diagnostics?.conflicts?.some((c) => c.severity === "high")) return "critical";
  if (lead.urgency === "urgent") return "high";
  if ((lead.totalPositions || 0) >= 5) return "high";
  // High-value request: nomenclature has avg_price data
  const totalEstValue = (lead.nomenclatureMatches || []).reduce((sum, m) => {
    const price = m?.avgPrice ?? m?.avg_price ?? 0;
    const qty = (lead.lineItems || []).find((li) => normalizeArticleCode(li.article) === normalizeArticleCode(m.article))?.quantity || 1;
    return sum + price * qty;
  }, 0);
  if (totalEstValue > 50000) return "high";
  if (attachmentFiles.length > 0 && attachmentFiles.some((file) => file.status === "processed")) return "medium";
  if ((lead.articles || []).length > 0) return "medium";
  // New customer with clear request — at least medium
  if ((lead.articles || []).length > 0 || (lead.detectedBrands || []).length > 0) return "medium";
  return "low";
}

function summarizeFailureReason(lead, diagnostics, attachmentFiles) {
  const issues = diagnostics?.issues || [];
  const conflicts = diagnostics?.conflicts || [];
  if (conflicts.length > 0) {
    return conflicts.slice(0, 2).map((item) => item.code.replace(/_/g, " ")).join("; ");
  }
  if (issues.length > 0) {
    return issues.slice(0, 3).map((item) => item.code.replace(/^missing_/, "нет ").replace(/^low_confidence_/, "слабый ").replace(/_/g, " ")).join("; ");
  }
  if (attachmentFiles.length > 0 && !attachmentFiles.some((file) => file.status === "processed")) {
    return "вложения не разобраны";
  }
  return "ключевые поля найдены";
}

function summarizeDecisionReason(lead, sender, classification, triggerSignals) {
  const parts = [];
  if (classification.label) parts.push(`класс:${classification.label}`);
  if (classification.confidence != null) parts.push(`conf:${Math.round(classification.confidence * 100)}%`);
  if (triggerSignals.length > 0) parts.push(`сигналы:${triggerSignals.slice(0, 3).join(" | ")}`);
  if (sender.email) parts.push(`email:${sender.email}`);
  return parts.join(" • ");
}

function summarizeDecisionSuggestion(lead, diagnostics) {
  const hints = [];

  if (diagnostics?.conflicts?.length) {
    const conflictTypes = diagnostics.conflicts.map((c) => c.code);
    if (conflictTypes.includes("article_quantity_conflict")) hints.push("Разные кол-ва для одного артикула — выберите верное.");
    if (conflictTypes.includes("article_name_conflict")) hints.push("Разные описания для одного артикула — уточните.");
    if (conflictTypes.includes("brand_article_mismatch")) hints.push("Бренд в тексте не совпадает с брендом артикулов в номенклатуре.");
    if (conflictTypes.includes("outlier_quantity")) hints.push("Аномально большое количество (>1000) — проверьте.");
    if (conflictTypes.includes("multiple_inn_candidates")) hints.push("Несколько ИНН — уточните верный.");
    if (!hints.length) hints.push("Проверьте line items и подтвердите корректные данные.");
    return hints.join(" ");
  }

  if ((diagnostics?.issues || []).some((item) => item.code === "attachment_parse_gap")) {
    hints.push("Есть вложения без разбора — откройте PDF/скан и добавьте артикулы вручную.");
  }

  const missingFields = (diagnostics?.issues || [])
    .filter((item) => String(item.code).startsWith("missing_"))
    .map((item) => item.field);
  if (missingFields.length) {
    const fieldLabels = { article: "артикулы", brand: "бренд", name: "наименование", phone: "телефон", company: "компанию", inn: "ИНН" };
    const missing = missingFields.map((f) => fieldLabels[f] || f).join(", ");
    hints.push(`Не хватает: ${missing}. Дополните через быструю коррекцию или запросите у клиента.`);
  }

  if ((lead.articles || []).length > 0 && getResolvedProductNameCount(lead) === 0) {
    hints.push("Добавьте наименование для артикула — закрепите через feedback.");
  }

  return hints.length ? hints.join(" ") : "Письмо можно подтвердить как корректно разобранное.";
}

function buildRecognitionDiagnostics(lead, sender, attachmentAnalysis = {}, classification = {}) {
  const files = attachmentAnalysis?.files || [];
  const fields = {
    article: buildFieldDiagnostic("article", lead, sender),
    brand: buildFieldDiagnostic("brand", lead, sender),
    name: buildFieldDiagnostic("name", lead, sender),
    phone: buildFieldDiagnostic("phone", lead, sender),
    company: buildFieldDiagnostic("company", lead, sender),
    inn: buildFieldDiagnostic("inn", lead, sender)
  };

  const conflicts = [
    ...collectArticleQuantityConflicts(lead),
    ...collectArticleNameConflicts(lead),
    ...collectAttachmentRequisiteConflicts(files),
    ...collectSemanticConflicts(lead, sender)
  ];

  const issues = collectRecognitionIssues({
    lead,
    sender,
    files,
    fields,
    conflicts,
    classification
  });

  const availableFieldCount = Object.values(fields).filter((field) => field.found).length;
  const overallConfidence = averageConfidence(Object.values(fields).map((field) => field.confidence));
  const completenessScore = Math.round((availableFieldCount / Object.keys(fields).length) * 100);
  const riskLevel = deriveRecognitionRiskLevel({ completenessScore, overallConfidence, issues, conflicts });
  const primaryIssue = conflicts[0]?.code || issues[0]?.code || null;

  return {
    completenessScore,
    overallConfidence,
    riskLevel,
    primaryIssue,
    fields,
    conflicts,
    issues
  };
}

function buildFieldDiagnostic(field, lead, sender) {
  const lineItems = lead.lineItems || [];
  const productNames = lead.productNames || [];
  const nomenclatureMatches = lead.nomenclatureMatches || [];
  const brandSources = lead.sources?.brands || [];
  const articleSources = lead.sources?.articles || [];
  const nameSources = lead.sources?.names || [];

  if (field === "article") {
    const found = (lead.articles || []).length > 0;
    const hasExplicit = lineItems.some((item) => item?.explicitArticle);
    const hasBodyItem = lineItems.some((item) => item?.article && String(item.source || "") === "body");
    const hasAttachmentItem = lineItems.some((item) => item?.article && String(item.source || "").startsWith("attachment:"));
    const hasNomenclature = nomenclatureMatches.some((item) => item?.article);
    return {
      found,
      confidence: !found ? 0 : hasExplicit ? 0.96 : hasBodyItem && hasNomenclature ? 0.93 : hasAttachmentItem && hasNomenclature ? 0.9 : hasBodyItem || hasAttachmentItem ? 0.84 : articleSources.length ? 0.74 : 0.68,
      source: hasExplicit ? "explicit_article_block" : hasBodyItem ? "body" : hasAttachmentItem ? "attachment" : articleSources[0] || null
    };
  }

  if (field === "brand") {
    const brands = lead.detectedBrands || [];
    const found = brands.length > 0;
    const hasNomenclature = nomenclatureMatches.some((item) => item?.brand);
    const hasSenderProfile = brandSources.includes("sender_profile");
    return {
      found,
      confidence: !found ? 0 : hasNomenclature ? 0.9 : hasSenderProfile ? 0.85 : brands.length === 1 ? 0.78 : brands.length <= 4 ? 0.76 : 0.62,
      source: hasNomenclature ? "nomenclature" : brandSources[0] || null
    };
  }

  if (field === "name") {
    const found = getResolvedProductNameCount(lead) > 0;
    const hasStructuredLineItem = lineItems.some((item) => item?.article && cleanup(item?.descriptionRu || ""));
    const hasAttachmentName = nameSources.some((source) => String(source).startsWith("attachment:"));
    const hasNomenclature = nomenclatureMatches.some((item) => item?.productName);
    return {
      found,
      confidence: !found ? 0 : hasStructuredLineItem ? 0.92 : hasAttachmentName ? 0.88 : productNames.length > 0 ? 0.84 : hasNomenclature ? 0.8 : 0.68,
      source: hasStructuredLineItem ? lineItems.find((item) => item?.article && cleanup(item?.descriptionRu || ""))?.source || null : nameSources[0] || null
    };
  }

  if (field === "phone") {
    const source = sender.sources?.phone || null;
    const found = Boolean(sender.cityPhone || sender.mobilePhone);
    return {
      found,
      confidence: !found ? 0 : source === "body" ? 0.9 : source === "sender_profile" ? 0.8 : 0.72,
      source
    };
  }

  if (field === "company") {
    const source = sender.sources?.company || null;
    const found = Boolean(sender.companyName);
    return {
      found,
      confidence: !found ? 0 : source === "body" ? 0.92 : source === "sender_profile" ? 0.84 : source === "email_domain" ? 0.5 : 0.7,
      source
    };
  }

  if (field === "inn") {
    const source = sender.sources?.inn || null;
    const found = Boolean(sender.inn);
    return {
      found,
      confidence: !found ? 0 : source === "body" ? 0.93 : source === "attachment" ? 0.84 : 0.72,
      source
    };
  }

  return { found: false, confidence: 0, source: null };
}

function collectArticleQuantityConflicts(lead) {
  const itemsByArticle = new Map();
  for (const item of lead.lineItems || []) {
    const article = normalizeArticleCode(item?.article);
    if (!article) continue;
    if (!itemsByArticle.has(article)) itemsByArticle.set(article, []);
    itemsByArticle.get(article).push(item);
  }

  const conflicts = [];
  for (const [article, items] of itemsByArticle.entries()) {
    const quantities = [...new Set(items.map((item) => Number(item?.quantity)).filter((value) => Number.isFinite(value) && value > 0))];
    if (quantities.length > 1) {
      conflicts.push({
        code: "article_quantity_conflict",
        field: "article",
        severity: "high",
        article,
        values: quantities,
        sources: unique(items.map((item) => item?.source).filter(Boolean))
      });
    }
  }

  return conflicts;
}

function normalizeItemName(name) {
  return name.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();
}

function isSameItemName(a, b) {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function collectArticleNameConflicts(lead) {
  const nameByArticle = new Map();
  for (const item of lead.lineItems || []) {
    const article = normalizeArticleCode(item?.article);
    const name = cleanup(item?.descriptionRu || "");
    if (!article || !name) continue;
    if (!nameByArticle.has(article)) nameByArticle.set(article, []);
    nameByArticle.get(article).push({ name, source: item?.source || null });
  }
  for (const item of lead.productNames || []) {
    const article = normalizeArticleCode(item?.article);
    const name = cleanup(item?.name || "");
    if (!article || !name) continue;
    if (!nameByArticle.has(article)) nameByArticle.set(article, []);
    nameByArticle.get(article).push({ name, source: item?.source || null });
  }

  const conflicts = [];
  for (const [article, variants] of nameByArticle.entries()) {
    // Deduplicate by normalized name (case-insensitive, substring-tolerant)
    const distinctNames = [];
    for (const { name } of variants) {
      if (!distinctNames.some((existing) => isSameItemName(existing, name))) {
        distinctNames.push(name);
      }
    }
    if (distinctNames.length > 1) {
      conflicts.push({
        code: "article_name_conflict",
        field: "name",
        severity: "medium",
        article,
        values: distinctNames.slice(0, 4),
        sources: unique(variants.map((item) => item.source).filter(Boolean))
      });
    }
  }

  return conflicts;
}

function collectAttachmentRequisiteConflicts(files) {
  const inns = [...new Set(files.flatMap((file) => file.detectedInn || []).filter(Boolean))];
  const conflicts = [];
  if (inns.length > 1) {
    // Check if one candidate is clearly authoritative (co-located with КПП in same file)
    const innWithKpp = files.find((file) => (file.detectedInn || []).length > 0 && (file.detectedKpp || []).length > 0);
    const primaryInn = innWithKpp ? innWithKpp.detectedInn[0] : null;
    // Only flag conflict if no clear winner — ambiguous multi-INN with no КПП anchor
    if (!primaryInn) {
      conflicts.push({
        code: "multiple_inn_candidates",
        field: "inn",
        severity: "medium",
        values: inns,
        sources: files.filter((file) => (file.detectedInn || []).length > 0).map((file) => file.filename)
      });
    }
  }
  return conflicts;
}

function collectSemanticConflicts(lead, sender) {
  const conflicts = [];

  // Brand-article mismatch: if detected brands don't match nomenclature brands
  const detectedBrands = (lead.detectedBrands || []).map((b) => String(b).toLowerCase());
  const nomenclatureBrands = (lead.nomenclatureMatches || [])
    .map((m) => m?.brand).filter(Boolean).map((b) => String(b).toLowerCase());
  if (detectedBrands.length > 0 && nomenclatureBrands.length > 0) {
    const overlap = nomenclatureBrands.filter((nb) => detectedBrands.some((db) => nb.includes(db) || db.includes(nb)));
    if (overlap.length === 0) {
      conflicts.push({
        code: "brand_article_mismatch",
        field: "brand",
        severity: "medium",
        detectedBrands: lead.detectedBrands?.slice(0, 3),
        nomenclatureBrands: (lead.nomenclatureMatches || []).map((m) => m.brand).filter(Boolean).slice(0, 3)
      });
    }
  }

  // Outlier quantity: >10000 units is suspicious
  for (const item of lead.lineItems || []) {
    const qty = item.quantity;
    const isYearLike = qty >= 1900 && qty <= 2100;
    const isInnLike = qty >= 1_000_000_000 && qty <= 9_999_999_999; // 10-digit Russian INN parsed as quantity
    const isDataNoise = qty >= 1_000_000_000_000; // trillion+: PDF/hex garbage
    if (qty > 10000 && !isYearLike && !isInnLike && !isDataNoise) {
      conflicts.push({
        code: "outlier_quantity",
        field: "quantity",
        severity: "medium",
        article: item.article,
        quantity: qty
      });
    }
  }

  return conflicts;
}

function collectRecognitionIssues({ lead, sender, files, fields, conflicts, classification }) {
  const issues = [];
  const hasAttachments = files.length > 0;
  const severityByMissingField = {
    article: "high",
    brand: "medium",
    name: "medium",
    phone: "medium",
    company: "medium",
    inn: "medium"
  };

  for (const [field, diagnostic] of Object.entries(fields)) {
    if (!diagnostic.found) {
      issues.push({
        code: `missing_${field}`,
        field,
        severity: severityByMissingField[field] || "medium"
      });
      continue;
    }
    if (diagnostic.confidence > 0 && diagnostic.confidence < 0.75) {
      issues.push({
        code: `low_confidence_${field}`,
        field,
        severity: "medium",
        confidence: diagnostic.confidence
      });
    }
  }

  // Only flag attachment_parse_gap for documents that could contain order data (not images/signatures)
  const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|ico|tiff?|svg)$/i;
  const documentFiles = files.filter((file) => !IMAGE_EXT.test(file.filename || ""));
  if (documentFiles.length > 0 && !documentFiles.some((file) => file.status === "processed")) {
    issues.push({
      code: "attachment_parse_gap",
      field: "attachment",
      severity: "medium"
    });
  }

  if ((lead.detectedBrands || []).length > 1) {
    issues.push({
      code: "multiple_brands_detected",
      field: "brand",
      severity: "low",
      values: lead.detectedBrands.slice(0, 5)
    });
  }

  if ((classification.confidence ?? 1) < 0.7) {
    issues.push({
      code: "low_classification_confidence",
      field: "classification",
      severity: "medium",
      confidence: classification.confidence
    });
  }

  if (conflicts.length > 0) {
    issues.push({
      code: "detection_conflicts_present",
      field: "recognition",
      severity: "high",
      count: conflicts.length
    });
  }

  // Deduplicate by code — prevent same tag from appearing multiple times
  const seen = new Set();
  const deduped = issues.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
  return deduped.sort(compareRecognitionIssues);
}

function compareRecognitionIssues(a, b) {
  const weight = { high: 0, medium: 1, low: 2 };
  return (weight[a.severity] ?? 99) - (weight[b.severity] ?? 99) || String(a.code || "").localeCompare(String(b.code || ""));
}

function deriveRecognitionRiskLevel({ completenessScore, overallConfidence, issues, conflicts }) {
  if (conflicts.length > 0) return "high";
  if (completenessScore < 50) return "high";
  if (overallConfidence < 0.65) return "high";
  if (issues.some((issue) => issue.severity === "high")) return "high";
  if (completenessScore < 80 || overallConfidence < 0.8 || issues.some((issue) => issue.severity === "medium")) return "medium";
  return "low";
}

function averageConfidence(values) {
  const filtered = (values || []).filter((value) => Number.isFinite(value) && value > 0);
  if (!filtered.length) return 0;
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function summarizeSourceList(values, hasData) {
  if (!hasData) return [];
  const normalized = [...new Set((values || []).filter(Boolean))];
  return normalized.length ? normalized : ["body"];
}

function getResolvedProductNameCount(lead) {
  return getResolvedProductNames(lead).length;
}

function getResolvedProductNames(lead) {
  const names = [
    ...(lead.productNames || []).map((item) => item.name),
    ...(lead.lineItems || []).map((item) => item.descriptionRu)
  ];
  return [...new Set(names.map((value) => String(value || "").trim()).filter(Boolean))];
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

    // Look at 140 chars before the article for context (Russian technical descriptions are often long)
    const contextStart = articleIdx >= 0 ? Math.max(0, articleIdx - 140) : 0;
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

    const resolvedName = lineItemName
      || sanitizeProductNameCandidate(productName)
      || nomenclatureMatch?.product_name
      || nomenclatureMatch?.description
      || null;
    productNames.push({
      article,
      name: resolvedName,
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
  const isClient = classification === "Клиент";
  const isVendor = classification === "Поставщик услуг";
  const isSpam = classification === "СПАМ";
  const diagnostics = lead.recognitionDiagnostics || {};
  const allConflicts = diagnostics.conflicts || [];
  // Only high-severity conflicts block ready_for_crm; medium conflicts are informational
  const blockingConflicts = allConflicts.filter((c) => c.severity === "high");
  // Require review for high-severity conflicts or critically empty letters (≤1 field out of 6)
  const requiresReview = blockingConflicts.length > 0
    || (isClient && (diagnostics.completenessScore ?? 100) < 20);

  return {
    parseToFields: !isSpam,
    requestClarification: crm.needsClarification,
    createClientInCrm: isClient && !crm.isExistingCompany && !requiresReview,
    createRequestInCrm: isClient && !requiresReview,
    assignMop: crm.curatorMop,
    assignMoz: crm.curatorMoz,
    requestType: lead.requestType,
    // New fields
    requiresReview,
    reviewReason: requiresReview
      ? blockingConflicts.length > 0 ? "detection_conflicts" : "low_completeness"
      : null,
    isVendorInquiry: isVendor,
    skipCrmSync: isSpam || isVendor
  };
}

// Own company name patterns — not a customer
const OWN_COMPANY_NAMES = /(?:сидерус|siderus|коловрат|kolovrat|klvrt|ersa\s*b2b|ersab2b)/i;

// Company label patterns for explicit "Компания: X" mentions
const COMPANY_LABEL_PATTERNS = [
  /(?:компания|организация|предприятие|работодатель|employer|company)\s*[:\-–]\s*(.{3,60})/i,
  /(?:от|from)\s+компани[иея]\s+(.{3,60})/i,
];

// Cities to skip in signature line parsing (false positive guard)
const CITY_STOPLIST = new Set([
  "москва", "санкт-петербург", "екатеринбург", "новосибирск", "казань",
  "нижний новгород", "челябинск", "самара", "уфа", "ростов", "омск",
  "красноярск", "воронеж", "пермь", "волгоград", "краснодар", "саратов",
  "тюмень", "тольятти", "ижевск", "барнаул", "ульяновск", "иркутск",
  "хабаровск", "ярославль", "владивосток", "махачкала", "томск", "оренбург",
  "кемерово", "новокузнецк",
]);

// Position words to skip in signature line
const POSITION_STOPWORDS = /^(?:менеджер|директор|инженер|специалист|руководитель|главный|ведущий|старший|генеральный|коммерческий|технический|региональный|sales|manager|engineer|director)/i;

// Generic domain words that don't make useful company names
const GENERIC_DOMAIN_WORDS = new Set([
  "metal", "group", "trade", "service", "info", "mail", "opt", "shop",
  "store", "online", "web", "net", "pro", "biz", "corp",
]);
const TRACKING_HOST_PATTERNS = [/^trk\.mail\.ru$/i, /^l\.mail\.ru$/i, /^click\./i, /^track\./i];

// PDF/font tokens that appear as fake company names when attachment content bleeds into extraction
const PDF_COMPANY_NOISE_TOKENS = new Set([
  "flatedecode", "roboto", "helvetica", "calibri", "arial", "times", "courier",
  "verdana", "trebuchet", "tahoma", "garamond", "georgia", "palatino",
  "pages", "dust", "opentype", "truetype", "cidfonttype2", "fontdescriptor",
  // Extended noise from audit: technical terms, generic descriptors
  "diaphragm", "metering", "pump", "specialist", "repack", "united process",
  "any", "some", "snipermail", "portable", "keygen",
]);

// Legal entity forms used as direct fallback patterns
const LEGAL_ENTITY_PATTERNS = [
  /(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП|НПК|ТОО|КТ)\s+["«]?[A-Za-zА-ЯЁ0-9][^,\n]{2,80}?(?=\s*(?:ИНН|КПП|ОГРН|тел\.?|телефон|моб\.?|mobile|phone|сайт|site|e-?mail|email|адрес|г\.|ул\.|(?:\+?7|8)[\s(.-]*\d{3}|$))/i,
  // With quotes: ООО «Ромашка», АО "Техно"
  /(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП|НПК|ТОО|КТ)\s+["«]([^"»]+)["»]/,
  // ИП Фамилия Имя Отчество
  /(?<![А-ЯЁа-яё])ИП\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.|\s+[А-ЯЁ][а-яё]+){1,2})/,
  // Without quotes but capitalized: ООО Ромашка, АО Техно
  /(?:ООО|АО|ОАО|ЗАО|ПАО|ФГУП|МУП|ГУП|НПО|НПП|НПК|ТОО|КТ)\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\s-]{2,35}?)(?:\s*[,.\n]|\s+(?:ИНН|ОГРН|тел|адрес|г\.|ул\.))/,
  // International: Siemens AG, SIEMENS AG, Endress+Hauser GmbH
  /([A-Z][A-Za-z]+(?:[\s+&/][A-Z][A-Za-z]+){0,3})\s+(?:GmbH|AG|Ltd\.?|LLC|Inc\.?|SE|S\.A\.|B\.V\.)/,
  // All-caps international: SIEMENS AG, ABB Ltd
  /\b([A-Z]{2,20})\s+(?:GmbH|AG|Ltd\.?|LLC|Inc\.?|SE|S\.A\.|B\.V\.)\b/,
  // Завод/фабрика/комбинат patterns
  /([А-ЯЁ][А-ЯЁа-яё-]+\s+(?:завод|фабрика|комбинат|предприятие))/i,
  // Группа компаний / ГК patterns
  /(?:ГК|Группа\s+компаний)\s+["«]?([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9\s-]{2,25})["»]?/,
];

function extractCompanyName(body, signature = "") {
  const candidates = [];

  // Step 1: KB match
  const fromKb = detectionKb.matchField("company_name", body);
  if (fromKb) {
    const cleaned = sanitizeCompanyName(fromKb);
    if (cleaned && !OWN_COMPANY_NAMES.test(cleaned)) {
      candidates.push({ name: cleaned, score: 0 });
    }
  }

  // Step 2: Legal entity patterns (ООО/АО/GmbH etc.)
  for (const text of [body, signature].filter(Boolean)) {
    for (const pattern of LEGAL_ENTITY_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        const sanitized = sanitizeCompanyName(match[0]);
        if (!sanitized) continue;
        const name = sanitized.trim();
        if (OWN_COMPANY_NAMES.test(name)) continue;
        if (name.length >= 5) {
          candidates.push({ name, score: 0 });
        }
      }
    }
  }

  // Step 3: Label patterns ("Компания: X")
  const fromLabel = extractCompanyFromLabels(body, signature);
  if (fromLabel && !OWN_COMPANY_NAMES.test(fromLabel)) {
    candidates.push({ name: fromLabel, score: 0 });
  }

  // Step 4: Signature line parsing
  const fullName = extractFullNameFromBody(body || signature);
  const fromSignature = extractCompanyFromSignatureLine(signature, fullName);
  if (fromSignature && !OWN_COMPANY_NAMES.test(fromSignature)) {
    candidates.push({ name: fromSignature, score: -5 });
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .sort((a, b) => (companyNameScore(b.name) + b.score) - (companyNameScore(a.name) + a.score))[0].name || null;
}

function companyNameScore(value) {
  const text = String(value || "");
  let score = text.length;
  if (/[«"]/u.test(text)) score += 10;
  if (/(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП)\b/.test(text)) score += 10;
  if (/[А-ЯЁA-Z][^"«»]{4,}\s+-\s+[А-ЯЁA-Z]/.test(text)) score += 6;
  if (/["«][^"»]{3,}["»]/.test(text)) score += 6;
  if (/\b(?:тел|телефон|phone|mobile|email|e-mail|сайт)\b/i.test(text)) score -= 20;
  return score;
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

function isTrackingHost(domain) {
  const host = String(domain || "").toLowerCase().replace(/^www\./, "");
  return TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractFullNameFromBody(body) {
  const fromKb = detectionKb.matchField("signature_hint", body);
  // Take only the first line — KB pattern can match across newlines and grab position line
  if (fromKb) return fromKb.split(/\n/)[0].trim();

  // "С уважением, [ООО/АО/...] Фамилия Имя [Отчество]" — company before name
  const signatureWithCompany = body.match(
    /(?:С уважением|Благодарю|Спасибо)[,.\s]*\n?\s*(?:(?:ООО|АО|ОАО|ЗАО|ПАО|ГК|НПО|НПП|ИП)\s+[^\n,]{2,40}[,\n]\s*)?([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i
  );
  if (signatureWithCompany) return signatureWithCompany[1].trim();

  // "Менеджер/Специалист ФАМИЛИЯ Имя Отчество" (ALL-CAPS surname)
  const managerNameMatch = body.match(
    /\b(?:Менеджер|Специалист|Инженер|Директор|Руководитель)\s+([А-ЯЁ]{2,15}\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/
  );
  if (managerNameMatch) return managerNameMatch[1].replace(/([А-ЯЁ]+)/g, (m) => m[0] + m.slice(1).toLowerCase()).trim();

  // "С уважением, Имя [Фамилия]" (first name only or two words, Cyrillic)
  const signatureNameMatch = body.match(
    /(?:С уважением|Best regards|Regards|Спасибо)[,.\s]*\n?\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,2})/i
  );
  if (signatureNameMatch) return signatureNameMatch[1].trim();

  // Latin name from English signature: "Best regards, John Smith" or "Regards,\nTony"
  const latinSignatureMatch = body.match(
    /(?:Best regards|Kind regards|Regards|Sincerely|Thanks|Thank you)[,.\s]*\n?\s*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){0,2})(?:\s*\n|$)/i
  );
  if (latinSignatureMatch) {
    const name = latinSignatureMatch[1].trim();
    // Skip common words that aren't names
    if (!/^(?:all|the|our|your|this|that|for|from|with|regards|sincerely|thanks)$/i.test(name)) {
      return name;
    }
  }

  // Structured signature block: standalone name line followed by position or phone
  // Looks for: "First Last\n[Position|Phone|Email]" pattern at end of body
  const lines = body.split(/\n/).map((l) => l.trim());
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
    const line = lines[i];
    // Candidate: 2-3 words, each Title-cased, no digits/special chars
    const cyrillic2words = /^([А-ЯЁ][а-яё]{1,19})(?:\s+([А-ЯЁ][а-яё]{1,19})){1,2}$/u.test(line);
    const latin2words = /^([A-Z][a-z]{1,19})(?:\s+([A-Z][a-z]{1,19})){1,2}$/.test(line);
    // "Фамилия И.В." or "Фамилия И. В." — surname + initials (very common in RU business email)
    const surnameInitials = /^([А-ЯЁ][а-яё]{2,20})\s+([А-ЯЁ]\.\s*[А-ЯЁ]\.?)$/.test(line);

    if (!cyrillic2words && !latin2words && !surnameInitials) continue;

    // Verify next or previous line looks like context (position, phone, email, company)
    const neighbor = lines[i + 1] || lines[i - 1] || "";
    const hasContext = /(?:\+7|8[-\s(]|tel:|mob:|e-?mail:|@|менеджер|инженер|директор|специалист|manager|engineer|sales)/i.test(neighbor);
    if (hasContext) {
      // Normalise "Иванов И. В." → "Иванов И.В."
      return line.replace(/([А-ЯЁ])\.\s+([А-ЯЁ])/, "$1.$2");
    }
  }

  return null;
}

// Infer name from email local part as last resort (e.g. tony.smith@... → "Tony Smith")
function inferNameFromEmail(email) {
  const local = email.split("@")[0];
  if (!local) return null;

  // Skip generic mailboxes
  if (/^(?:info|support|office|sales|admin|noreply|no-reply|hello|contact|mail|post|zakaz|order|request)/i.test(local)) {
    return null;
  }

  // "tony.smith" or "tony_smith" → "Tony Smith"
  const parts = local.split(/[._-]/).filter((p) => p.length >= 2 && /^[a-zа-яё]+$/i.test(p));
  if (parts.length >= 2 && parts.length <= 3) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }

  return null;
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
  // Format with 4-digit area codes (e.g. 3952, 3812): subscriber number is 6 digits split 2-2-2
  // Detect: if area code is 3-digit but matches 4-digit city code prefix pattern
  // Standard 11-digit: +7(AAA)BBB-BB-BB (always valid for 3-digit codes)
  return `+7 (${code}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

// Step 3: Extract company from explicit label patterns ("Компания: X")
function extractCompanyFromLabels(body, signature = "") {
  for (const text of [body, signature].filter(Boolean)) {
    for (const pattern of COMPANY_LABEL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        let value = match[1].trim();
        // Skip if the matched value is just an INN field (form submitted without company name)
        if (/^ИНН\s*[:\s]/i.test(value)) continue;
        // Strip trailing phone/INN/URL/punctuation
        value = value
          .replace(/\s+(?:ИНН|КПП|ОГРН|тел\.?|телефон|phone|\+\d)[\s\S]*$/i, "")
          .replace(/["«»]/g, "")
          .replace(/[,;:.]+$/, "")
          .trim();
        if (value.length >= 3 && value.length <= 60) {
          return value;
        }
      }
    }
  }
  return null;
}

// Step 4: Extract company from signature lines after ФИО
function extractCompanyFromSignatureLine(signature, fullName) {
  if (!signature) return null;

  const lines = signature.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // Find ФИО line index
  let nameLineIdx = -1;
  if (fullName) {
    const namePart = fullName.split(" ")[0]; // first word of name
    nameLineIdx = lines.findIndex((l) => l.includes(namePart));
  }
  // If not found by name, look for greeting line as anchor
  if (nameLineIdx === -1) {
    nameLineIdx = lines.findIndex((l) =>
      /(?:с уважением|best regards|regards|спасибо)/i.test(l)
    );
  }

  const startIdx = nameLineIdx !== -1 ? nameLineIdx + 1 : 0;
  const candidates = lines.slice(startIdx, startIdx + 3);

  for (const line of candidates) {
    // Stop at phone/email/URL
    if (/(?:\+7|8[-\s(]?\d{3}|@|https?:\/\/|www\.)/i.test(line)) break;

    const len = line.length;
    if (len < 3 || len > 50) continue;
    if (!/^[А-ЯЁA-Z]/u.test(line)) continue;
    if (POSITION_STOPWORDS.test(line)) continue;
    // Skip only-Latin long strings (likely not a company name in Russian context)
    if (/^[A-Za-z\s+&.-]+$/.test(line) && len > 20) continue;

    const lower = line.toLowerCase();
    if (CITY_STOPLIST.has(lower)) continue;
    // Skip if matches sender name
    if (fullName && lower === fullName.toLowerCase()) continue;
    // Skip if it looks like a brand from KB (would be false positive)
    const brands = detectionKb.detectBrands ? detectionKb.detectBrands(line) : [];
    if (brands && brands.length > 0) continue;
    // Reject if line looks like a personal name (2-3 Cyrillic Title-Case words, no legal form)
    if (/^[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}$/.test(line)
      && !/(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП|ГК|НПО|НПП)/i.test(line)) continue;

    return line;
  }
  return null;
}

function hasLegalEntityMarker(value) {
  return /(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП|ГК|НПО|НПП|GmbH|AG|Ltd\.?|LLC|Inc\.?|SE|S\.A\.|B\.V\.)/i.test(String(value || ""));
}

function extractQuotedSenderFallback({ quotedContent = "", fromName = "", fromEmail = "", attachments = [] } = {}) {
  const quoted = String(quotedContent || "").trim();
  if (!quoted || !fromEmail) return null;
  if (!quoted.toLowerCase().includes(fromEmail.toLowerCase())) return null;

  const { body: quotedPrimaryBody, signature: quotedSignature } = extractSignature(quoted);
  const quotedBody = [quotedPrimaryBody, quotedSignature].filter(Boolean).join("\n\n") || quoted;
  const sender = extractSender(fromName, fromEmail, quotedBody, attachments, quotedSignature);
  if (!sender) return null;
  return sender;
}

function mergeQuotedSenderFallback(sender, quotedSender) {
  if (!sender || !quotedSender) return;

  if ((!sender.mobilePhone && !sender.cityPhone) && (quotedSender.mobilePhone || quotedSender.cityPhone)) {
    sender.mobilePhone = quotedSender.mobilePhone || sender.mobilePhone;
    sender.cityPhone = quotedSender.cityPhone || sender.cityPhone;
    sender.sources.phone = quotedSender.sources?.phone || "quoted_body";
  }

  if (!sender.inn && quotedSender.inn) {
    sender.inn = quotedSender.inn;
    sender.sources.inn = quotedSender.sources?.inn || "quoted_body";
  }

  const senderCompany = String(sender.companyName || "");
  const quotedCompany = String(quotedSender.companyName || "");
  const shouldReplaceCompany = (
    (!senderCompany && quotedCompany)
    || (!hasLegalEntityMarker(senderCompany) && hasLegalEntityMarker(quotedCompany))
    || (/^[A-Za-z][A-Za-z\s.-]*\s+co\.?$/i.test(senderCompany) && hasLegalEntityMarker(quotedCompany))
  );
  if (shouldReplaceCompany) {
    sender.companyName = quotedCompany;
    sender.sources.company = quotedSender.sources?.company || "quoted_body";
  }

  if ((!sender.fullName || sender.fullName === "Не определено") && quotedSender.fullName && quotedSender.fullName !== "Не определено") {
    sender.fullName = quotedSender.fullName;
  }
}

// Step 5: Infer company from email domain (last resort, score -15)
function inferCompanyFromDomain(email) {
  if (!email || isFreeDomain(email)) return null;

  const domain = email.split("@")[1];
  if (!domain) return null;
  if (isOwnDomain(domain)) return null;

  // Strip TLD and subdomains (take second-to-last segment)
  const parts = domain.split(".");
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

  if (!name || name.length < 3) return null;
  if (GENERIC_DOMAIN_WORDS.has(name.toLowerCase())) return null;

  // Title case
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function sanitizeCompanyName(value) {
  let text = cleanup(value);
  if (!text) return null;

  text = text
    .replace(/\s+(?:тел\.?|телефон|phone|mobile|моб\.?|сайт|site|e-?mail|email)(?=$|\s|[.,;:()])[\s\S]*$/i, "")
    .replace(/\s+(?:www\.[^\s]+|https?:\/\/[^\s]+)\s*$/i, "")
    .replace(/\s+\+\d[\d()\s.-]*$/i, "")
    .replace(/\s+(?:\+?7|8)(?:[\s(.-]*\d){10,}[\s\S]*$/i, "")
    .replace(/[;,:\-–—]\s*(?:тел\.?|телефон|phone|mobile|моб\.?|сайт|site|e-?mail|email)(?=$|\s|[.,;:()])[\s\S]*$/i, "")
    .replace(/\s+(?:г\.|город|ул\.|улица|пр-?т|проспект|д\.|дом)\s+[\s\S]*$/i, "")
    .replace(/\s+(?:юридический\s+и\s+фактический|юридический|фактический|почтовый)(?=$|\s|[.,;:()])[\s\S]*$/i, "")
    .replace(/\s+Наше\s+предприятие[\s\S]*$/i, "")
    // Strip trailing bank details (БИК, р/с, к/с, корр. счёт)
    .replace(/\s+(?:БИК|бик|к\/с|р\/с|Р\/с|К\/с|корр?\.?\s*счёт|расч\.?\s*счёт|к[/\\]с|р[/\\]с)[\s\S]*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+["«»]+$/g, "")
    .replace(/[)\]]+$/g, "")
    .trim();

  if (!text) return null;

  // Strip trailing "от 23." / "от 05 апреля" — date suffix bled from surrounding text
  text = text.replace(/\s+от\s+\d[\d.]*\s*(?:г\.?|года?)?$/i, "").trim();
  if (!text) return null;

  // Reject "ИНН: XXXX" — INN number, not a company name (robot form field bleeding)
  if (/^ИНН\s*[:\s]\s*\d/i.test(text)) return null;
  if (/^ИНН$/i.test(text.trim())) return null;

  // Reject known Russian bank names appearing in payment footer/signature (not client company)
  if (/\b(?:Альфа-?Банк|Сбербанк|Сбер|ВТБ|Тинькофф|Т-?Банк|Точка|ОткрытиеБанк|Открытие|Газпромбанк|Райффайзен|Росбанк|Промсвязьбанк|ПСБ|РНКБ|Совкомбанк|Банк Точка|Банк\s+Уралсиб|Уралсиб)\b/i.test(text) && /\b(?:Банк|АО|ООО)\b/i.test(text)) return null;

  // Reject phone number masquerading as company
  if (/^(?:тел\.?|телефон|моб\.?|\+7[\s(]|\+7$|8\s*[\s(]\d{3})/i.test(text)) return null;

  // Reject company name that contains an email address
  if (/@[\w.-]+\.[a-z]{2,}/i.test(text)) return null;

  // Reject English disclaimer/legal text fragments ("Mail may contain co", "Trade secret and of co")
  if (/\b(?:may contain|trade secret|confidential|unsubscribe|disclaimer|privileged|this email|this message|do not distribut|intended for|designated recipient|if you receive|could you quote|are strictly|present message|proprietary information)\b/i.test(text)) return null;

  // Reject department/division names (not company names)
  if (/^(?:Отдел|Управление|Подразделение|Департамент|Служба|Бюро)\b/u.test(text)) return null;

  // Reject street address fragments
  if (/(?:^|\s)(?:ул\.|улица|пр-т|проспект|бульвар|шоссе|набережная|переулок)\s+[А-ЯЁA-Z]/i.test(text)) return null;

  // Reject job positions used as company name
  if (POSITION_STOPWORDS.test(text)) return null;

  // Reject PDF/font noise tokens (e.g. "FlateDecode co", "Roboto Co" from attachment bleed)
  const lowerBase = text.toLowerCase().replace(/\s+(?:co\.?|ltd\.?|inc\.?|llc|gmbh|ag)\s*$/i, "").trim();
  if (PDF_COMPANY_NOISE_TOKENS.has(lowerBase)) return null;

  // Reject generic English words + "co" (e.g. "United Process Co", "Any co", "Dust co")
  const GENERIC_CO_WORDS = new Set(["any", "some", "united", "process", "special", "group", "general", "global", "master", "service", "system", "solution", "tech", "trade", "new", "old", "big", "small", "good", "best", "first", "next", "solenoid", "coil", "coils", "hydraulic", "electric"]);
  if (/\s+co\.?\s*$/i.test(text) && GENERIC_CO_WORDS.has(lowerBase)) return null;
  if (/^[A-Z]{1,3}\s+co\.?$/i.test(text)) return null;
  if (/^(?:hd|isa|cmod)\s+co\.?$/i.test(text)) return null;

  // Reject software-version/repack noise (e.g. "SPecialiST RePack AppVersion Co", "RePack by someone")
  if (/\b(?:repack|appversion|portable|keygen|crack|patch|activator|installer)\b/i.test(text)) return null;

  // Reject known free/spam email service names masquerading as company
  // Only mass-mailing platforms, NOT generic email services used by real clients (e.g. snipermail.ru)
  const SPAM_SERVICE_NAMES = new Set(["mailchimp", "unisender", "sendpulse", "getresponse", "sendinblue", "mailerlite"]);
  if (SPAM_SERVICE_NAMES.has(lowerBase)) return null;

  // Reject bare legal-form without any name ("ООО", "АО", "ИП")
  if (/^(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП)$/i.test(text)) return null;
  if (/^(?:наше|ваше)\s+предприятие$/i.test(text)) return null;

  if (/^(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП)\s*(?:тел|телефон|phone|mobile|email|e-mail|сайт)$/i.test(text)) {
    return null;
  }
  if (/^(?:ООО|АО|ОАО|ЗАО|ПАО|ИП|ФГУП|МУП|ГУП)\s+Тел$/i.test(text)) {
    return null;
  }
  return text;
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
  const tabularRowPattern = /(?:^|[\n\r]|\s{2,})(?:№\s+Наименование\s+Кол-?во\s+Ед\.?изм\.?\s*)?(\d{1,3})\s+(.+?)\s+((?:\d{5,9})|(?:[A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8}))\s+(?:(?:[A-Za-zА-ЯЁа-яё]{1,5}\s+){0,3})?\d{1,4}[xх×*]\d{1,4}(?:[xх×*]\d{1,4})?(?:\s*[A-Za-zА-Яа-яЁё"]{0,4})?\s+(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?(?=$|[\n\r]|\s{2,})/gi;

  for (const block of parseArticleQtyBlocks(body)) {
    if (!items.some((item) => normalizeArticleCode(item.article) === normalizeArticleCode(block.article))) {
      items.push(block);
    }
  }

  for (const match of body.matchAll(tabularRowPattern)) {
    const article = normalizeArticleCode(match[3]);
    const sourceLine = cleanup(match[0]);
    if (!article || isObviousArticleNoise(article, sourceLine)) continue;
    if (items.some((item) => normalizeArticleCode(item.article) === article)) continue;
    items.push({
      article,
      quantity: Math.round(parseFloat(String(match[4]).replace(",", "."))) || 1,
      unit: match[5] || "шт",
      descriptionRu: `${cleanup(match[2])} ${article}`.trim(),
      explicitArticle: true,
      sourceLine
    });
  }

  for (const rawLine of lines) {
    if (hasArticleNoiseContext(rawLine)) continue;
    if (/^Арт\.?\s*:/i.test(rawLine)) continue;

    // Strip "Позиция N:" or "Поз. N:" prefix
    const line = rawLine.replace(/^(?:Позиция|Поз\.?)\s*\d{1,3}\s*[:.\s]+/i, "").trim();
    if (!line) continue;

    // ── Tabular quoted row: "1 Уплотнение масляное 122571 NBR G 60х75х8 10" ──
    const tableRowSource = line.replace(/^№\s+Наименование\s+Кол-?во\s+Ед\.?изм\.?\s*/i, "").trim();
    const tableRowMatch = tableRowSource.match(/^\d{1,3}\s+(.+?)\s+((?:\d{5,9})|(?:[A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8}))\s+(?:(?:[A-Za-zА-ЯЁа-яё]{1,5}\s+){0,3})?\d{1,4}[xх×*]\d{1,4}(?:[xх×*]\d{1,4})?(?:\s*[A-Za-zА-Яа-яЁё"]{0,4})?\s+(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?$/i);
    if (tableRowMatch && !isObviousArticleNoise(tableRowMatch[2], tableRowSource)) {
      items.push({
        article: normalizeArticleCode(tableRowMatch[2]),
        quantity: Math.round(parseFloat(tableRowMatch[3].replace(",", "."))) || 1,
        unit: tableRowMatch[4] || "шт",
        descriptionRu: `${tableRowMatch[1]} ${tableRowMatch[2]}`.trim(),
        explicitArticle: true,
        sourceLine: tableRowSource
      });
      continue;
    }

    // ── Exact numbered article lines: "1) WK06Y-01-C-N-0" ──
    const numberedExactArticleMatch = line.match(/^\d{1,3}[.)]\s*([A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8})$/i);
    if (numberedExactArticleMatch) {
      items.push({ article: normalizeArticleCode(numberedExactArticleMatch[1]), quantity: 1, unit: "шт", descriptionRu: line, explicitArticle: true, sourceLine: line });
      continue;
    }

    // ── Numbered branded line: "1) Bieri AKP20-0,012-300-V" ──
    const numberedBrandArticleMatch = line.match(/^\d{1,3}[.)]\s*[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.+-]{1,30}\s+([A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8})$/i);
    if (numberedBrandArticleMatch) {
      items.push({ article: normalizeArticleCode(numberedBrandArticleMatch[1]), quantity: 1, unit: "шт", descriptionRu: line, explicitArticle: true, sourceLine: line });
      continue;
    }

    // ── Numbered descriptive line with stable code: "1) Coil 230DG-32-1329" ──
    const numberedDescriptorArticleMatch = line.match(/^\d{1,3}[.)]\s*(?:Coil|Катушка|Клапан|Насос)\s+([A-Za-zА-ЯЁа-яё0-9]+(?:[-/,.:][A-Za-zА-ЯЁа-яё0-9]+){1,8})$/i);
    if (numberedDescriptorArticleMatch) {
      items.push({ article: normalizeArticleCode(numberedDescriptorArticleMatch[1]), quantity: 1, unit: "шт", descriptionRu: line, explicitArticle: true, sourceLine: line });
      continue;
    }

    // ── Format: "Description ARTICLE - N шт" (product line with trailing qty) ──
    const productQtyMatch = line.match(PRODUCT_QTY_PATTERN);
    if (productQtyMatch) {
      const beforeQty = line.slice(0, line.length - productQtyMatch[0].length).trim();
      const qty = parseFloat(productQtyMatch[1].replace(",", "."));
      const unit = productQtyMatch[2] || "шт";
      const shortBrandNumeric = beforeQty.match(/\b[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30}\s+(\d{3,6})\b/i);
      if (shortBrandNumeric && !DATE_LIKE_PATTERN.test(shortBrandNumeric[1])) {
        items.push({ article: normalizeArticleCode(shortBrandNumeric[1]), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: true, sourceLine: line });
        continue;
      }
      const trailingMixedCode = beforeQty.match(/([A-Za-zА-Яа-яЁё]{1,4}[A-Za-zА-Яа-яЁё0-9]{1,8}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})\s*$/i);
      if (trailingMixedCode) {
        items.push({ article: normalizeArticleCode(trailingMixedCode[1]), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: true, sourceLine: line });
        continue;
      }
      // Extract article code from the description part
      const articleFromDesc = extractArticleFromDescription(beforeQty);
      if (articleFromDesc) {
        // Brand-adjacent articles (short numeric codes next to a brand) are explicitly trusted
        const isBrandAdjacent = new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ-]{2,20}\\s+`, "i").test(beforeQty) && /^\d{3,9}$/.test(normalizeArticleCode(articleFromDesc));
        items.push({ article: normalizeArticleCode(articleFromDesc), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: isBrandAdjacent || undefined, sourceLine: line });
        continue;
      }
      const brandAdjacentAlpha = beforeQty.match(new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ-]{2,20}\\s+(\\d[A-Za-z0-9]{3,15})\\b`, "i"));
      if (brandAdjacentAlpha && /\d/.test(brandAdjacentAlpha[1]) && /[A-Za-z]/.test(brandAdjacentAlpha[1])) {
        items.push({ article: normalizeArticleCode(brandAdjacentAlpha[1]), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: true, sourceLine: line });
        continue;
      }
      const brandAdjacentNum = beforeQty.match(new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ-]{2,20}\\s+(\\d{4,9})\\b`, "i"));
      if (brandAdjacentNum && !DATE_LIKE_PATTERN.test(brandAdjacentNum[1])) {
        items.push({ article: normalizeArticleCode(brandAdjacentNum[1]), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: true, sourceLine: line });
        continue;
      }
      const fallbackArticles = extractAllArticlesFromDescription(beforeQty).filter((article) => !isObviousArticleNoise(article, beforeQty));
      if (fallbackArticles.length) {
        items.push({ article: normalizeArticleCode(fallbackArticles[0]), quantity: Math.round(qty) || 1, unit, descriptionRu: line, explicitArticle: true, sourceLine: line });
        continue;
      }
    }

    // ── Format: ARTICLE x 20 / ARTICLE х 20 / ARTICLE * 20 ──
    const itemMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/i);
    if (itemMatch) {
      items.push({ article: normalizeArticleCode(itemMatch[1]), quantity: Number(itemMatch[2]), unit: itemMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: ARTICLE в количестве N шт / в количестве N шт ──
    const inlineQtyMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s+в\s+количестве\s+(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|м|кг|л)?/i);
    if (inlineQtyMatch) {
      items.push({ article: normalizeArticleCode(inlineQtyMatch[1]), quantity: Number(inlineQtyMatch[2]), unit: inlineQtyMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: количество к поставке N / количество: N ──
    const qtyKeywordMatch = line.match(/^[кК]оличеств\w*(?:\s+к\s+поставке)?\s*:?\s*(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|м|кг)?/i);
    if (qtyKeywordMatch && items.length > 0) {
      // Assign quantity to the last found article without quantity
      const last = [...items].reverse().find((i) => !i.quantity || i.quantity === 1);
      if (last) {
        last.quantity = Number(qtyKeywordMatch[1]);
        if (qtyKeywordMatch[2]) last.unit = qtyKeywordMatch[2];
      }
      continue;
    }

    // ── Format: ARTICLE (N штук/шт) ──
    const parenMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s*\((\d+)\s*(штук[аи]?|шт|единиц[аы]?|компл|к-т|пар[аы]?)?\)/i);
    if (parenMatch) {
      items.push({ article: normalizeArticleCode(parenMatch[1]), quantity: Number(parenMatch[2]), unit: parenMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: ARTICLE — N шт / ARTICLE - N шт (article code THEN dash-qty) ──
    // Also handles trailing closing words: "STA.9461/12-08-11 — 5 шт Спасибо!"
    const dashMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т)?\.?(?:\s+[А-Яа-яЁё!.]+)?\s*$/i);
    if (dashMatch && !VOLTAGE_PATTERN.test(dashMatch[1])) {
      items.push({ article: normalizeArticleCode(dashMatch[1]), quantity: Math.round(parseFloat(dashMatch[2].replace(",", "."))) || 1, unit: dashMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: tabular — ARTICLE\tQTY or ARTICLE;QTY;UNIT or ARTICLE|QTY ──
    const tabMatch = line.match(/([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})[\t;,|]\s*(\d+)(?:[\t;,|]\s*([A-Za-zА-Яа-я.]+))?/);
    if (tabMatch && tabMatch[2] !== "0") {
      items.push({ article: normalizeArticleCode(tabMatch[1]), quantity: Number(tabMatch[2]), unit: tabMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: pipe-delimited table with header row ──
    // "1 | 6EP1334-3BA10 | 2" or "6EP1334-3BA10 | 2 | шт"
    const pipeMatch = line.match(/(?:^\d+\s*\|)?\s*([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_.]{2,})\s*\|\s*(\d+)(?:\s*\|\s*([A-Za-zА-Яа-я.]+))?/);
    if (pipeMatch && pipeMatch[2] !== "0" && !/^(?:Позиция|Наименование|Артикул|Описание|Количество|Name|Article|Qty|Pos)/i.test(pipeMatch[1])) {
      items.push({ article: normalizeArticleCode(pipeMatch[1]), quantity: Number(pipeMatch[2]), unit: pipeMatch[3] || "шт", descriptionRu: line, sourceLine: line });
      continue;
    }

    // ── Format: N шт ARTICLE (reversed) ──
    const reverseMatch = line.match(/(\d+)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?)\s+([A-Za-zА-ЯЁа-яё0-9][-A-Za-zА-ЯЁа-яё0-9/:_]{2,})/i);
    if (reverseMatch) {
      items.push({ article: normalizeArticleCode(reverseMatch[3]), quantity: Number(reverseMatch[1]), unit: reverseMatch[2] || "шт", descriptionRu: line, sourceLine: line });
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

  return pruneShadowLineItems(items);
}

function pruneShadowLineItems(items) {
  return items.filter((item, _, allItems) => {
    const article = normalizeArticleCode(item.article);
    if (!article) return false;

    return !allItems.some((other) => {
      if (other === item) return false;
      const otherArticle = normalizeArticleCode(other.article);
      if (!otherArticle || otherArticle === article) return false;
      if (!otherArticle.includes(article) || otherArticle.length < article.length + 2) return false;

      const itemDescription = cleanup(item.descriptionRu || item.sourceLine || "");
      const otherDescription = cleanup(other.descriptionRu || other.sourceLine || "");

      if (itemDescription && otherDescription && itemDescription === otherDescription) return true;
      if (itemDescription && itemDescription.includes(otherArticle)) return true;
      if (otherDescription && otherDescription.includes(article) && /[-/,.:]/.test(otherArticle)) return true;
      return false;
    });
  });
}

/**
 * Extract free-text line items — positions described without explicit article codes.
 * Returns items with synthetic DESC: codes.
 *
 * @param {string} body
 * @param {string[]} detectedBrands
 * @param {string[]} existingArticles
 * @returns {Array}
 */
function extractFreeTextItems(body, detectedBrands = [], existingArticles = []) {
  const MAX_ITEMS = 30;
  const MIN_DESC_LENGTH = 5;

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = [];

  // Non-DESC codes ≥4 chars for containment checks
  const existingSet = new Set(
    existingArticles.filter((a) => a && !a.startsWith("DESC:") && a.length >= 4).map((a) => a.toLowerCase())
  );

  const isNoiseLine = (line) => {
    if (SIGNATURE_PATTERNS.some((p) => p.test(line))) return true;
    if (INN_PATTERN.test(line) || KPP_PATTERN.test(line) || OGRN_PATTERN.test(line)) return true;
    if (/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/.test(line)) return true;
    if (/\+?[78][\s(-]\d{3}[\s)-]\d{3}[-\s]?\d{2}[-\s]?\d{2}/.test(line)) return true;
    if (/^https?:\/\//.test(line)) return true;
    if (/^\s*(?:web|сайт|url|www)\s*[:#]\s*\S+/i.test(line)) return true;
    // PDF/Office internal metadata keywords
    if (/\b(?:CreationDate|StructTreeRoot|DescendantFonts|ImageMask|ViewerPreferences|PickTrayByPDFSize|FontDescriptor|CIDFont|MediaBox|ToUnicode|CropBox|XObject|XrefStm)\b/i.test(line)) return true;
    if (line.length < MIN_DESC_LENGTH) return true;
    return false;
  };

  const addItem = (desc, qty, unit) => {
    const cleanDesc = desc.trim().replace(/\s+/g, " ");
    if (cleanDesc.length < MIN_DESC_LENGTH) return;
    const lowerClean = cleanDesc.toLowerCase();
    // Skip if description already contains an extracted article code (prevents DESC: duplicates)
    if (existingSet.size > 0 && [...existingSet].some((a) => lowerClean.includes(a))) return;
    const article = transliterateToSlug(cleanDesc);
    if (items.some((i) => i.article === article)) return;
    items.push({
      article,
      descriptionRu: cleanDesc,
      quantity: Math.round(parseFloat(String(qty).replace(",", "."))) || 1,
      unit: unit || "шт",
      source: "freetext"
    });
  };

  const REQUEST_RE = /^(?:нужен|нужна|нужно|нужны|прошу(?:\s+(?:счёт|кп|цену|предложение)\s+на)?|требуется|необходим[аое]?|запрос\s+на|интересует(?:е)?)\s+(.{5,80})$/i;

  for (const line of lines) {
    if (items.length >= MAX_ITEMS) break;
    if (isNoiseLine(line)) continue;

    // ── Trigger A: quantity signal ──
    // Pattern A1: "description — N unit" (explicit dash separator)
    const dashMatch = line.match(/^(.{5,80}?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)\s*$/i);
    // Pattern A2: "description N unit" (space only, no dash)
    const spaceMatch = line.match(/^(.{5,60}?)\s+(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)\s*$/i);
    const qtyMatch = dashMatch || spaceMatch;
    if (qtyMatch) {
      const desc = qtyMatch[1].trim();
      const qty = qtyMatch[2];
      const unit = qtyMatch[3];
      // Skip if description looks like a bare article code (already handled by extractLineItems)
      if (/^[A-Za-z0-9][-A-Za-z0-9/:_.]{2,}$/.test(desc)) continue;
      // Skip if this line already contributed a structured article (avoid duplicate items)
      const lineUpper = line.toUpperCase();
      if (existingArticles.some((a) => lineUpper.includes(a.toUpperCase()))) continue;
      addItem(desc, qty, unit);
      continue;
    }

    // ── Trigger B: request keyword signal ──
    const reqMatch = line.match(REQUEST_RE);
    if (reqMatch) {
      const desc = reqMatch[1].trim();
      // Check if there's an embedded qty in the description
      const embeddedQty = desc.match(/(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|компл|к-т|пар[аы]?|м|кг|л|уп|рул|бух)\b/i);
      const cleanDesc = embeddedQty
        ? desc.slice(0, embeddedQty.index).trim() || desc
        : desc;
      // Skip if description starts with a verb infinitive (e.g. "подготовить КП", "выслать счёт")
      const firstWord = cleanDesc.split(/\s/)[0].toLowerCase();
      if (firstWord.endsWith("ть") || firstWord.endsWith("тись") || firstWord.endsWith("тся") || firstWord.endsWith("чь")) continue;
      if (cleanDesc.length >= MIN_DESC_LENGTH) {
        addItem(cleanDesc, embeddedQty ? embeddedQty[1] : 1, embeddedQty ? embeddedQty[2] : "шт");
        continue;
      }
    }

    // ── Trigger C: known brand on line, no article code found ──
    if (detectedBrands.length > 0) {
      const lowerLine = line.toLowerCase();
      const brandOnLine = detectedBrands.find((b) => lowerLine.includes(b.toLowerCase()));
      if (brandOnLine) {
        // Only create freetext item if no real article was already detected for this line
        const lineHasRealArticle = existingArticles.some((a) =>
          a && !a.startsWith("DESC:") && lowerLine.includes(a.toLowerCase())
        );
        if (!lineHasRealArticle && line.length >= MIN_DESC_LENGTH && line.length <= 120) {
          addItem(line, 1, "шт");
          continue;
        }
      }
    }
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
      explicitArticle: true,
      sourceLine: line
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
  const isValidArticleCandidate = (code) =>
    code.length >= 3 && /\d/.test(code) && !VOLTAGE_PATTERN.test(code)
    && !BRAND_NOISE.has(code.toUpperCase()) && !ENGINEERING_SPEC_PATTERN.test(code);

  const candidates = [];
  const pushCandidate = (code) => {
    const normalized = normalizeArticleCode(code);
    if (normalized && isValidArticleCandidate(normalized) && isLikelyArticle(normalized, new Set(), text)) {
      candidates.push(normalized);
    }
  };

  const productContextMatch = text.match(/(?:^|[\s-])(?:[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30}(?:\s+(?:und|and|&)\s+[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30})?)\s+([A-Za-zА-Яа-яЁё]?\d[A-Za-zА-Яа-яЁё0-9/-]{2,20}|\d{4,9}|[A-Za-zА-Яа-яЁё]{1,4}[A-Za-zА-Яа-яЁё0-9]{1,8}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})/i);
  if (productContextMatch) pushCandidate(productContextMatch[1]);

  for (const m of text.matchAll(EXTENDED_CODE_PATTERN)) pushCandidate(m[1]);
  for (const m of text.matchAll(DIGIT_LEAD_SEGMENTED_CODE_PATTERN)) pushCandidate(m[1]);
  for (const m of text.matchAll(MIXED_CASE_SEGMENTED_CODE_PATTERN)) pushCandidate(m[1]);
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) pushCandidate(m[1]);
  for (const m of text.matchAll(CYRILLIC_MIXED_CODE_PATTERN)) pushCandidate(m[1]);

  const endCodeMatch = text.match(/\b([A-Za-zА-ЯЁа-яё]{1,10}[-]?\d{2,}(?:[-/.][A-Za-zА-Яа-яЁа-яё0-9]+)*)\s*$/);
  if (endCodeMatch && endCodeMatch[1].length >= 3 && !ENGINEERING_SPEC_PATTERN.test(endCodeMatch[1])) pushCandidate(endCodeMatch[1]);

  for (const m of text.matchAll(SERIES_MODEL_PATTERN)) pushCandidate(`${m[1]} ${m[2]}`);

  const brandCodeMatch = text.match(/\b([A-Z]{2,10})\s+(\d{2,6})\b/);
  if (brandCodeMatch && !ENGINEERING_SPEC_PATTERN.test(`${brandCodeMatch[1]} ${brandCodeMatch[2]}`)) pushCandidate(`${brandCodeMatch[1]} ${brandCodeMatch[2]}`);

  const brandAlphaMatch = text.match(new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}(?:\\s+(?:und|and|&)\\s+[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20})?\\s+(\\d[A-Za-z0-9]{3,15})\\b`, "i"));
  if (brandAlphaMatch && /[A-Za-z]/.test(brandAlphaMatch[1]) && !ENGINEERING_SPEC_PATTERN.test(brandAlphaMatch[1])) {
    pushCandidate(brandAlphaMatch[1]);
  }

  const brandNumMatch = text.match(new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}(?:\\s+(?:und|and|&)\\s+[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20})?\\s+(\\d{4,9})\\b`, "i"));
  if (brandNumMatch && !DATE_LIKE_PATTERN.test(brandNumMatch[1])) pushCandidate(brandNumMatch[1]);

  const articleBeforeBrandMatch = text.match(/\b([A-Za-zА-Яа-яЁё]{1,6}\s*\d(?:[A-Za-zА-Яа-яЁё0-9./-]{1,20}))\s+фирмы\s+[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁёüöäÜÖÄ&.\- ]{1,40}\b/i);
  if (articleBeforeBrandMatch) {
    pushCandidate(articleBeforeBrandMatch[1]);
  }

  return unique(candidates)
    .sort((a, b) => {
      const scoreDelta = scoreArticleCandidate(b, text) - scoreArticleCandidate(a, text);
      if (scoreDelta !== 0) return scoreDelta;
      return b.length - a.length;
    })[0] || null;
}

/**
 * Extract ALL article codes from a product description line (not just the first one).
 * Returns array of codes, filtering out engineering specs and brand noise.
 */
function extractAllArticlesFromDescription(text) {
  const results = [];
  const seen = new Set();
  const isValid = (code) =>
    code.length >= 3 && /\d/.test(code) && !VOLTAGE_PATTERN.test(code)
    && !BRAND_NOISE.has(code.toUpperCase()) && !ENGINEERING_SPEC_PATTERN.test(code);
  const add = (code) => {
    const norm = normalizeArticleCode(code);
    if (norm && !seen.has(norm) && isValid(norm)) { seen.add(norm); results.push(norm); }
  };

  const productContextPattern = /(?:^|[\s-])(?:[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30}(?:\s+(?:und|and|&)\s+[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30})?)\s+([A-Za-zА-Яа-яЁё]?\d[A-Za-zА-Яа-яЁё0-9/-]{2,20}|\d{4,9}|[A-Za-zА-Яа-яЁё]{1,4}[A-Za-zА-Яа-яЁё0-9]{1,8}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})/gi;
  for (const m of text.matchAll(productContextPattern)) add(m[1]);
  for (const m of text.matchAll(/\b(\d{5,9})\b(?=\s+(?:NBR|FKM|EPDM|PTFE|VITON|FPM|VMQ|HNBR|SIL)\b|\s+\d{1,4}[xх×*]\d{1,4}(?:[xх×*]\d{1,4})?\b)/gi)) add(m[1]);

  for (const m of text.matchAll(EXTENDED_CODE_PATTERN)) add(m[1]);
  for (const m of text.matchAll(DIGIT_LEAD_SEGMENTED_CODE_PATTERN)) add(m[1]);
  for (const m of text.matchAll(MIXED_CASE_SEGMENTED_CODE_PATTERN)) add(m[1]);
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) add(m[1]);
  for (const m of text.matchAll(CYRILLIC_MIXED_CODE_PATTERN)) add(m[1]);
  for (const m of text.matchAll(SERIES_MODEL_PATTERN)) add(`${m[1]} ${m[2]}`);
  return results;
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
    "WEBKIT", "CHARSET", "VIEWPORT", "DOCTYPE",
    // Common words with numbers that are not articles
    "TOP-10", "TOP-20", "TOP-50", "TOP-100", "COVID-19", "24/7"
  ]);
  const matches = [];
  // Standard latin-only codes
  for (const m of text.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 5 && /\d/.test(code) && !noise.has(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      matches.push(code);
    }
  }
  // Extended codes: dots (233.50.100), colons (VV64:KMD)
  for (const m of text.matchAll(EXTENDED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 4 && /\d/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  for (const m of text.matchAll(DIGIT_LEAD_SEGMENTED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 4 && /\d/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Cyrillic mixed codes: АИР100S4 (Cyrillic look-alikes transliterated)
  for (const m of text.matchAll(CYRILLIC_MIXED_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Reverse: 100А13/1.5Т220 (digits first, then Cyrillic)
  for (const m of text.matchAll(DIGITS_CYRILLIC_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]); // transliterateCyrillicInCode applied inside
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  for (const m of text.matchAll(DIGITS_CYRILLIC_HYPHEN_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    if (code.length >= 4 && /\d/.test(code) && /[A-Za-z]/.test(code) && !noise.has(code.toUpperCase()) && !BRAND_NOISE.has(code.toUpperCase()) && isLikelyArticle(code, forbiddenDigits, sourceLine)) {
      if (!matches.includes(code)) matches.push(code);
    }
  }
  // Series + model: "CR 10-3", "WDU 2.5" — combine as single code
  for (const m of text.matchAll(SERIES_MODEL_PATTERN)) {
    const combined = `${m[1]} ${m[2]}`;
    const sourceLine = getContextLine(text, m.index, m[0]?.length || combined.length);
    if (combined.length >= 4 && !noise.has(m[1]) && !BRAND_NOISE.has(m[1]) && isLikelyArticle(combined, forbiddenDigits, sourceLine)) {
      if (!matches.includes(combined)) matches.push(combined);
    }
  }
  return matches;
}

function extractNumericArticles(text, forbiddenDigits = new Set()) {
  const matches = [];
  for (const m of text.matchAll(NUMERIC_ARTICLE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    const sourceLine = getContextLine(text, m.index, m[0]?.length || code.length);
    // Skip date-like patterns (01-12, 25/03/2026)
    if (DATE_LIKE_PATTERN.test(code)) continue;
    const digitsOnly = code.replace(/\D/g, "");
    // Must have at least 5 total digits to avoid short noise like 72-03, 63-90
    if (digitsOnly.length < 5) continue;
    // Skip phone-fragment-shaped codes: XX-XX-XX
    if (/^\d{2,3}-\d{2}-\d{2}$/.test(code)) continue;
    if (!isLikelyArticle(code, forbiddenDigits, sourceLine)) continue;
    matches.push(code);
  }
  return matches;
}

function extractStrongContextArticles(text, forbiddenDigits = new Set()) {
  const matches = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    if (!STRONG_ARTICLE_CONTEXT_PATTERN.test(line)) continue;
    const numericMatches = line.match(/\b\d{7,12}\b/g) || [];
    for (const code of numericMatches) {
      if (!forbiddenDigits.has(code) && isLikelyArticle(code, forbiddenDigits, line)) {
        matches.push(code);
      }
    }
    for (const m of line.matchAll(NUMERIC_ARTICLE_PATTERN)) {
      const code = normalizeArticleCode(m[1]);
      if (!DATE_LIKE_PATTERN.test(code) && isLikelyArticle(code, forbiddenDigits, line)) {
        matches.push(code);
      }
    }
  }
  return unique(matches);
}

function extractTrailingMixedArticles(text, forbiddenDigits = new Set()) {
  const matches = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(?:[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30}(?:\s+(?:und|and|&)\s+[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30})?).*?([A-Za-zА-Яа-яЁё]{1,4}[A-Za-zА-Яа-яЁё0-9]{1,8}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})\s*$/i);
    if (!match) continue;
    const code = normalizeArticleCode(match[1]);
    if (!isObviousArticleNoise(code, line) && isLikelyArticle(code, forbiddenDigits, line)) {
      matches.push(code);
    }
  }
  return unique(matches);
}

function extractProductContextArticles(text, forbiddenDigits = new Set()) {
  const matches = [];
  const lines = String(text || "").split(/\r?\n/);
  const productContextRegex = /(?:^|[\s:;,(])(?:клапан|коннектор|расходомер|барабан|пневмоштуцер|защелка|крюк|цилиндр|мотор-редуктор|станок|датчик|редуктор|контроллер|соединение|узел|головка|штуцер|клапаны)(?:$|[\s:;,.()])/i;
  const trailingCodeRegex = /(?:^|[\s(])([A-Za-zА-Яа-яЁё]{1,6}[A-Za-zА-Яа-яЁё0-9]{1,12}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})\s*$/i;

  for (const line of lines) {
    if (!productContextRegex.test(line)) continue;
    const match = line.match(trailingCodeRegex);
    if (!match) continue;
    const code = normalizeArticleCode(match[1]);
    const hasLetters = /[A-Za-zА-Яа-яЁё]/.test(code);
    const hasDigits = /\d/.test(code);
    const looksLikeMixedProductCode = hasLetters && hasDigits && code.length >= 6 && /[-/.]/.test(code);
    if (!isObviousArticleNoise(code, line) && (isLikelyArticle(code, forbiddenDigits, line) || looksLikeMixedProductCode)) {
      matches.push(code);
    }
  }

  return unique(matches);
}

function extractArticlesFromSubject(subject, forbiddenDigits = new Set()) {
  const articles = [];
  // Prefixed articles in subject
  for (const m of subject.matchAll(ARTICLE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (isLikelyArticle(code, forbiddenDigits, subject)) articles.push(code);
  }
  // Standalone alpha-numeric codes in subject
  for (const m of subject.matchAll(STANDALONE_CODE_PATTERN)) {
    const code = normalizeArticleCode(m[1]);
    if (code.length >= 4 && /\d/.test(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits, subject)) {
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
  const productContextPattern = /(?:^|[\s-])(?:[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30}(?:\s+(?:und|and|&)\s+[A-Za-zÀ-ÿА-Яа-яЁё][A-Za-zÀ-ÿА-Яа-яЁё&.-]{1,30})?)\s+([A-Za-zА-Яа-яЁё]?\d[A-Za-zА-Яа-яЁё0-9/-]{2,20}|\d{4,9}|[A-Za-zА-Яа-яЁё]{1,4}[A-Za-zА-Яа-яЁё0-9]{1,8}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})/gi;
  for (const m of text.matchAll(productContextPattern)) {
    const code = normalizeArticleCode(m[1]);
    if (/\d/.test(code) && !isObviousArticleNoise(code, m[0]) && isLikelyArticle(code, forbiddenDigits, m[0])) {
      matches.push(code);
    }
  }
  const pattern = new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}(?:\\s+(?:und|and|&)\\s+[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20})?\\s+(\\d{4,9})\\b`, "gi");
  for (const m of text.matchAll(pattern)) {
    const code = m[1];
    if (!forbiddenDigits.has(code) && !DATE_LIKE_PATTERN.test(code)) {
      matches.push(code);
    }
  }
  // Pattern: BRAND + space + alphanumeric code starting with digit, e.g. "Danfoss 032U1240"
  const alphaPattern = new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}(?:\\s+(?:und|and|&)\\s+[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20})?\\s+(\\d[A-Za-z0-9]{3,15})\\b`, "gi");
  for (const m of text.matchAll(alphaPattern)) {
    const code = m[1];
    // Must contain both digits and letters, not be an engineering spec
    if (/\d/.test(code) && /[A-Za-z]/.test(code) && !ENGINEERING_SPEC_PATTERN.test(code)
        && !forbiddenDigits.has(code.replace(/\D/g, ""))) {
      matches.push(code);
    }
  }
  const mixedPattern = new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}(?:\\s+(?:und|and|&)\\s+[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20})?\\s+([A-Za-zА-Яа-яЁё]{1,6}[A-Za-zА-Яа-яЁё0-9]{0,12}(?:[-/.][A-Za-zА-Яа-яЁё0-9]{1,12}){1,6})\\b`, "gi");
  for (const m of text.matchAll(mixedPattern)) {
    const code = normalizeArticleCode(m[1]);
    if (/\d/.test(code) && !ENGINEERING_SPEC_PATTERN.test(code) && isLikelyArticle(code, forbiddenDigits, getContextLine(text, m.index, m[0]?.length || code.length))) {
      matches.push(code);
    }
  }
  return unique(matches);
}

function extractArticlesFromAttachments(attachments, forbiddenDigits = new Set()) {
  const articles = [];
  for (const name of attachments) {
    if (!isAttachmentLikelyToContainArticle(name)) {
      continue;
    }
    // Strip extension
    const baseName = name.replace(/\.[^.]+$/, "").replace(/[_\s]+/g, "-");
    const brandNumericAttachment = baseName.match(new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ&.-]{1,20}[-_](\\d{4,9})\\b`, "i"));
    if (brandNumericAttachment && !DATE_LIKE_PATTERN.test(brandNumericAttachment[1])) {
      articles.push(brandNumericAttachment[1]);
    }
    for (const m of baseName.matchAll(STANDALONE_CODE_PATTERN)) {
      const code = normalizeArticleCode(m[1]);
      if (code.length >= 4 && /\d/.test(code) && !BRAND_NOISE.has(code) && isLikelyArticle(code, forbiddenDigits, baseName)) {
        articles.push(code);
      }
    }
    for (const m of baseName.matchAll(NUMERIC_ARTICLE_PATTERN)) {
      const code = normalizeArticleCode(m[1]);
      if (!DATE_LIKE_PATTERN.test(code) && code.replace(/\D/g, "").length >= 5) {
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
  /^\d+(?:Nm|Нм)\/\d+\s*(?:V|В)\b/i,  // 180Nm/230V
];

// Pipe/thread size and engineering spec patterns — never valid articles
// PN only matches short specs (PN1-PN999), not article codes like PN2271 (4+ digits)
// Also covers measurement ranges: 0-16 (pressure), 0-120 (temperature), 0-100, etc.
const ENGINEERING_SPEC_PATTERN = /^(?:G\s*\d+\/\d+|R\s*\d+\/\d+|Rc\s*\d+\/\d+|Rp\s*\d+\/\d+|DN\s*\d{1,4}|PN\s*\d{1,3}|NPS\s*\d+|ISO\s*[A-Z]?\d+|M\s*\d+(?:x\d+)?|NPT\s*\d*|BSP\s*\d*|0-\d+)$/i;

// Ticket/reference number patterns — never valid product articles
const TICKET_NOISE_PATTERN = /^(?:TK|REQ|INC|SR|CASE|ORD|INV|REF|CHG|PRB|WO|CR|RQ|HD|SD)[-#]\d{3,}$/i;

// Year-like numbers that are almost never product articles
const YEAR_LIKE_PATTERN = /^(?:19|20)\d{2}$/;

// Common PDF binary residue that leaks into article detection
const PDF_RESIDUE_PATTERNS = [
  /\d{4,}:[A-Z]{6,}/i,                     // JPEG DCT markers: 456789:CDEFGHIJSTUVWXYZ
  /^IEC\s*61966/i,                          // ICC sRGB profile
  /^\d+\s+\d+\s+(?:obj|R)$/i,              // PDF object references
  /^(?:endobj|endstream|stream|xref)$/i,    // PDF stream markers
];

// Known PDF dimension values (A4/A3 at common DPIs: 72, 150, 200, 300, 600)
const PDF_DIMENSION_VALUES = new Set([
  "595", "842", "1169", "1240", "1653", "1654", "1748", "1754",
  "2338", "2339", "2480", "2481", "3307", "3508", "4961",
  // Common font metrics
  "65535", "1000"
]);

function isLikelyArticle(code, forbiddenDigits = new Set(), sourceLine = "") {
  const normalized = normalizeArticleCode(code);
  if (!normalized || normalized.length < 3 || normalized.length > 40) {
    return false;
  }

  if (isObviousArticleNoise(normalized, sourceLine)) {
    return false;
  }

  if (!/\d/.test(normalized)) {
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
  if (VOLTAGE_RANGE_PATTERN.test(normalized) && ELECTRICAL_SPEC_CONTEXT_PATTERN.test(sourceLine)) {
    return false;
  }
  if (VOLTAGE_RANGE_PATTERN.test(normalized) && /\b(?:питание|напряжение|voltage)\b/i.test(sourceLine)) {
    return false;
  }
  if (CERTIFICATE_CODE_PATTERN.test(normalized) && CERTIFICATION_CONTEXT_PATTERN.test(sourceLine)) {
    return false;
  }
  if (SHORT_PREFIX_NUMBER_PATTERN.test(normalized) && (CERTIFICATION_CONTEXT_PATTERN.test(sourceLine) || LEGAL_FORM_CONTEXT_PATTERN.test(sourceLine) || ELECTRICAL_SPEC_CONTEXT_PATTERN.test(sourceLine))) {
    return false;
  }
  if (MATERIAL_OR_TYPE_FRAGMENT_PATTERN.test(normalized)) {
    return false;
  }
  if (STRICT_TECHNICAL_NOISE_PATTERN.test(normalized)) {
    return false;
  }
  if (/^(?:R\/[A-Z0-9]+|TYPE\/[A-Z0-9/_-]+|[A-Z]+\/[A-Z0-9/_-]+)$/i.test(normalized)) {
    return false;
  }
  if (/^(?:\d+\/[A-Z][A-Z0-9/_-]*|[A-Z][A-Z0-9/_-]*\/\d+)$/i.test(normalized)) {
    return false;
  }
  if (/^(?:TYPE\d+|PDF-\d(?:\.\d+)?|C\d+_\d+)$/i.test(normalized)) {
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
  // Reject pipe/thread sizes, engineering standards: G1/2, DN50, PN16, M12x1, NPT, BSP
  if (ENGINEERING_SPEC_PATTERN.test(normalized)) {
    return false;
  }
  if (/(?:^|[./-])(?:ru|com|net|org|info|biz)$/i.test(normalized) || normalized.includes("/unsubscribe")) {
    return false;
  }
  // Reject ticket/reference numbers: TK-44821, REQ-123, INC-00001
  if (TICKET_NOISE_PATTERN.test(normalized)) {
    return false;
  }
  // Reject PDF binary residue patterns
  if (PDF_RESIDUE_PATTERNS.some((p) => p.test(normalized))) {
    return false;
  }
  // Reject known PDF dimension/metric values
  if (PDF_DIMENSION_VALUES.has(normalized)) {
    return false;
  }
  // Reject year-like numbers without strong context
  if (YEAR_LIKE_PATTERN.test(normalized) && !STRONG_ARTICLE_CONTEXT_PATTERN.test(sourceLine)) {
    return false;
  }
  // Reject IEC standard identifiers (IEC61966-2.1 etc.)
  if (/^IEC\d/i.test(normalized)) {
    return false;
  }

  const digits = normalized.replace(/\D/g, "");
  const letters = normalized.replace(/[^A-Za-zА-Яа-я]/g, "");
  const line = String(sourceLine || "").trim();
  const digitOnlyWithSeparators = /^[\d-/_]+$/.test(normalized);
  const hasStrongArticleContext = STRONG_ARTICLE_CONTEXT_PATTERN.test(line);
  const hasBrandAdjacentNumericContext = Boolean(
    line && new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ-]{2,20}\\s+${escapeRegExp(normalized)}\\b`, "i").test(line)
  );

  if (!/[-/]/.test(normalized) && line && new RegExp(`\\b${escapeRegExp(normalized)}[-/][A-Za-zА-ЯЁа-яё0-9]`, "i").test(line)) {
    return false;
  }

  if (CLASSIFIER_CONTEXT_PATTERN.test(line)) {
    return false;
  }

  if (forbiddenDigits.has(digits) && digits.length >= 5) {
    return false;
  }

  if (line && digitOnlyWithSeparators && hasArticleNoiseContext(line)) {
    return false;
  }

  if (!letters) {
    // R. STAHL article format: XXXX/XX-XXs (e.g. 9444/15-11, 8040/1260-R5A without letters part)
    if (/^\d{4}\/\d{2,4}-\d{2,5}$/.test(normalized) && /\b(?:R\.?\s*STAHL|STA\.)\b/i.test(sourceLine)) {
      return true;
    }
    // Pure 3-4 digit numbers: only accept with brand context
    if (/^\d{3,4}$/.test(normalized) && !hasBrandAdjacentNumericContext) {
      return false;
    }
    if (digits.length >= 4 && digits.length <= 9 && hasBrandAdjacentNumericContext) {
      return true;
    }
    if (digitOnlyWithSeparators && digits.length >= 6 && PRODUCT_QTY_PATTERN.test(line)) {
      return true;
    }
    // Structured multi-segment codes with dots/dashes: 8240402.9101.024.00 (Norgren style)
    // These have 3+ segments and brand context — allow even with many digits
    const segments = normalized.split(/[-/.]/).filter(Boolean);
    if (segments.length >= 3 && hasBrandAdjacentNumericContext) {
      return true;
    }
    if (digits.length < 7) {
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

    if (!hasStrongArticleContext) {
      return false;
    }
  }

  if (/^\d{3,4}(?:-\d{2}){2,}$/.test(normalized)) {
    return false;
  }

  if (letters) {
    const score = scoreArticleCandidate(normalized, line || normalized);
    if (score < ARTICLE_SCORE_THRESHOLDS.acceptProbable) {
      return false;
    }
  }

  return true;
}

function isObviousArticleNoise(code, sourceLine = "") {
  const normalized = normalizeArticleCode(code);
  const line = String(sourceLine || "");
  const compactLine = line.replace(/\s+/g, "");
  const compactNormalized = normalized.replace(/\s+/g, "");
  const hasStrongArticleContext = STRONG_ARTICLE_CONTEXT_PATTERN.test(line);
  const hasBrandAdjacentNumericContext = Boolean(
    line && new RegExp(`\\b[${EXTENDED_BRAND_WORD_RE}][${EXTENDED_BRAND_WORD_RE}üöäÜÖÄ-]{2,20}\\s+${escapeRegExp(normalized)}\\b`, "i").test(line)
  );
  if (!normalized) return true;
  // DESC: synthetic slug articles (freetext positions without real article code)
  if (/^DESC:/i.test(normalized)) return true;
  // mailto: links mistaken for articles
  if (/^mailto:/i.test(normalized)) return true;
  // XML/RDF/EXIF/photo namespace-qualified names: ns3:PMZNumber, crs:Exposure2012, xmp.did:...
  if (/^(?:ns\d+|crs|xmp|rdf|dc|pdf|sha|md5|tiff|exif|photoshop|illustrator|stRef|stEvt|stMfs|aux|gpano|lr|mwg|aux|iptc|plus|drone|acdsee)[:/]/i.test(normalized)) return true;
  // PDF font style tokens: 20Italic, 14Bold, 12Regular, 8Normal
  if (/^\d{1,2}(?:Bold|Italic|Roman|Normal|Light|Regular|Condensed|Medium|Black|Narrow)$/i.test(normalized)) return true;
  if (/^(?:https?|www|cid)$/i.test(normalized) || normalized.includes("@")) return true;
  if (/^cid:/i.test(normalized) || /^image\d+$/i.test(normalized)) return true;
  // Common expressions with numbers that are never product articles
  if (/^TOP-?\d+$/i.test(normalized) || /^COVID-?\d+$/i.test(normalized)) return true;
  // Image filenames: image001.jpg, image005.png
  if (/^image\d+\.\w+$/i.test(normalized)) return true;
  // Currency expressions: EUR 6, USD 100
  if (/^(?:EUR|USD|RUB|GBP|CHF)\s+\d/i.test(normalized)) return true;
  // PDF/XML version markers: PDF-1.7, PDF-1.3, 1.0, 2.0, 0.0, 3.0
  if (/^PDF-\d+(?:\.\d+)?$/i.test(normalized)) return true;
  if (/^\d\.\d$/.test(normalized)) return true;
  // CSS style tokens: ms-text-size-adjust:100, webkit-text-size-adjust:100
  if (/^(?:ms|webkit|moz|o)-[a-z-]+:\d/i.test(normalized)) return true;
  // PDF metadata: GTS_PDFA1, GTS_PDFX
  if (/^GTS_PDF/i.test(normalized)) return true;
  // Office internal: 20Roman (Word style), drs/e2oDoc.xml
  if (/^\d+ROMAN$/i.test(normalized)) return true;
  if (/^drs\//i.test(normalized)) return true;
  // PDF font/producer names: CAOLAN80, ALLLEX86, ALFABY2X, CALIBRI1, ARIAL1, CYR1
  if (/^(?:CAOLAN|ALLLEX|ALFABY|CALIBRI\d|ARIAL\d|CYR\d)/i.test(normalized)) return true;
  // Date patterns: 01-2026, 03-2025
  if (/^\d{2}-(?:19|20)\d{2}$/.test(normalized)) return true;
  // Full dates: dd.mm.yyyy or dd/mm/yyyy (from company card attachments)
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(normalized)) return true;
  // UUID and UUID fragments: hex chars + dashes, 3+ segments, must contain at least one A-F letter
  // Pure-digit codes like 1114-160-318 are excluded (no hex letters)
  if (/^[0-9A-F-]+$/i.test(normalized) && /[A-Fa-f]/.test(normalized) && !/[G-Zg-z]/.test(normalized)) {
    const uuidSegs = normalized.split("-");
    if (uuidSegs.length >= 3 && uuidSegs.every((s) => s.length >= 3 && s.length <= 12)) return true;
  }
  // Russian PFR (pension fund) registration codes: 2BM-9701077015-770101001, BM-9701077015
  if (/^[02]?[A-ZА-Я]{1,2}-\d{10}(?:-\d{9})?$/i.test(normalized)) return true;
  // OKPO/OKTMO/INN/KPP/UNP codes (7-12 pure digits) in company registration context
  if (/^\d{7,12}$/.test(normalized) && REQUISITES_CONTEXT_PATTERN.test(line)) return true;
  // Phone numbers in contact/signature context (Тел:, моб., факс, доб., Сот. etc.)
  // Pattern uses suffix chars to avoid matching mid-word (e.g. "тель" in "нагреватель")
  if (/^[\d\s\-().]{5,}$/.test(normalized) && normalized.replace(/\D/g, "").length >= 6
    && /(?:тел[.:\s/,]|тел$|телефон|моб[.:\s/,]|моб$|мобильн|факс|сот[.:\s/,]|сот$|доб[.:\s/,]|доб$|раб[.:\s/,]|раб$|\bmob\.?|\btel\.?|\bphone)/i.test(line)) return true;
  // URL slugs: fdmrn8c0b-bilge-level-switch-float, n8-30x32l-nbr-connecting-type
  // Slugs have 4+ segments with at least 2 long lowercase word segments (4+ chars each)
  if (normalized.split("-").length >= 4 && normalized.length > 20) {
    const longWordSegments = normalized.split("-").filter((s) => /^[a-z]{4,}$/i.test(s)).length;
    if (longWordSegments >= 2) return true;
  }
  // Decimal numbers: 595.2, 841.9
  if (/^\d{2,4}\.\d{1,2}$/.test(normalized)) return true;
  // Bank account/BIK/corr.account: 30101810*, 40702810*, 04452*
  if (/^(?:301|407|044)\d{5,17}$/.test(normalized)) return true;
  // Simple fractions: 1/2, 1/4, 1/1, 10/2
  if (/^\d{1,2}\/\d{1,2}$/.test(normalized)) return true;
  // Hash-like strings (24+ uppercase alphanumeric without separators)
  if (/^[A-Z0-9]{24,}$/.test(normalized) && !/[-/.]/.test(normalized)) return true;
  // PDF Unicode escape residue: 000A, 000C, 004A, 004O etc.
  if (/^0{2,}\d?[A-Z]$/i.test(normalized)) return true;
  // Office document filenames: e2oDoc.xml, e2oDoc.xmlPK
  if (/^E2ODOC/i.test(normalized)) return true;
  // Page/section references: СТР.1, CTP.1, стр.2 (Cyrillic С→C, Т→T, Р→P after transliteration)
  if (/^(?:CTP|СТР|CTR|STR|PAG)\.\d{1,3}$/i.test(normalized)) return true;
  // Year with Cyrillic suffix: 2026г, 2025г (год = year)
  if (/^(?:19|20)\d{2}[гГgG]$/i.test(normalized)) return true;
  // Russian ordinal numbers: 1-я, 2-й, 3-е, 15-го (addresses, dates)
  if (/^\d{1,3}-[яйеому](?:[йаяе])?$/i.test(normalized)) return true;
  // Sensor type designations that are not articles: PT100, PT500, PT1000, NTC10K
  if (/^(?:PT|NTC|PTC|KTY)\d{2,5}(?:K)?$/i.test(normalized)) return true;
  // PDF metadata: font creators, producer names (CAOLAN80, ADOBEPS5)
  if (/^(?:CAOLAN|ADOBEPS|ADOBE)\d+$/i.test(normalized)) return true;
  // Office internal zip paths: drs/e2oDoc.xmlPK, word/document.xmlPK
  if (/(?:\.xmlPK|\.relsPK|drs\/|word\/|xl\/)$/i.test(normalized)) return true;
  // UI/spam artifact: "51Просмотр", "24Просмотр" (garbled Cyrillic "Просмотр"=View)
  if (/\d+[Пп][рp][оo][сc][мm][оo][тt][рp]/i.test(normalized)) return true;
  if (/Пpocmotp$/i.test(normalized)) return true;
  if (/^(?:8|7)?-?800(?:-\d{1,4}){1,}$/.test(normalized)) return true;
  if (/^[a-z]+(?:\.[a-z0-9]+){2,}$/i.test(normalized)) return true;
  // URL paths with domain-like segments: ns.adobe.com/xap/1.0, purl.org/dc/elements/1.1
  if (/^[a-z]+\.[a-z]+\.[a-z]+/i.test(normalized)) return true;
  // Domain-like with path: purl.org/dc/elements/1.1, www.w3.org/1999/02/22-rdf
  if (/^(?:www|ns|purl)\./i.test(normalized)) return true;
  // RDF/XML namespace paths: 1999/02/22-rdf-syntax-ns
  if (/^\d{4}\/\d{2}\/\d{2}-/i.test(normalized)) return true;
  if (OFFICE_XML_ARTICLE_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (/^(?:XML|DOCX|XLSX|WORD|EXCEL)\/[A-Z0-9/_-]+$/i.test(normalized)) return true;
  if (OFFICE_XML_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(line))) return true;
  if (PDF_INTERNAL_TEXT_NOISE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(line))) return true;
  if (VOLTAGE_RANGE_PATTERN.test(normalized) && ELECTRICAL_SPEC_CONTEXT_PATTERN.test(line)) return true;
  if (CSS_STYLE_TOKEN_PATTERN.test(normalized)) return true;
  if (WORD_INTERNAL_TOKEN_PATTERN.test(normalized)) return true;
  if (WORD_STYLE_TOKEN_PATTERN.test(normalized)) return true;
  // Russian steel grades: 08Х18Н10Т, 12Х18Н9, 20Х13, 40ХН и т.п. (digit(s) + Cyrillic letters + digits/letters)
  if (/^\d{1,2}[А-ЯЁ]{1,4}\d{1,3}[А-ЯЁТ]?$/.test(normalized)) return true;
  // Material standards: AISI 304, AISI 316L — STANDARD_TOKEN_PATTERN now covers AISI without space, handle "AISI NNN" with space
  if (/^AISI\s+\d{3}[A-Z]?$/.test(normalized)) return true;
  // Dimension/size expressions: 4x14mm, 20mm, 10x10, 3/4" — engineering sizes, not articles
  if (/^\d+[xхх×*]\d+(?:[.,]\d+)?(?:mm|cm|m|")?$/i.test(normalized)) return true;
  if (/^\d+[xхх×*]\d+(?:[xхх×*]\d+){1,3}(?:[.,]\d+)?(?:mm|cm|m|")?$/i.test(normalized)) return true;
  if (/^\d+(?:[.,]\d+)?\s*(?:mm|cm|мм|см)$/i.test(normalized)) return true;
  if (/^\d{2,5}(?:-\d{2,5}){2,}(?:-[a-z]{1,4})?$/i.test(normalized) && /(?:ysclid|rab-temp|processed|orders|bitrix|form_result|isa-hd)/i.test(line)) return true;
  // Image/file attachment names used as articles: IMG-5248, DSC-1234, SCAN-001
  if (GENERIC_IMAGE_ATTACHMENT_PATTERN.test(normalized)) return true;
  // Prefixed catalog/INN codes misidentified as articles: 2A3952010011, 3A3952010260
  if (/^[1-9][A-Z]\d{9,11}$/i.test(normalized)) return true;
  if (compactLine && /^[A-ZА-Я]?\d+(?:[.-]\d+)+$/i.test(compactNormalized)) {
    const standardTokens = compactLine.match(/(?:IEC|ISO|ГОСТ|DIN|EN|ASTM|TU|ТУ)[A-ZА-Я]?\d+(?:[.-]\d+)+/gi) || [];
    if (standardTokens.some((token) => token.toUpperCase().endsWith(compactNormalized.toUpperCase()))) return true;
  }
  if (STANDARD_TOKEN_PATTERN.test(normalized)) return true;
  if (STANDARD_OR_NORM_PATTERN.test(normalized)) return true;
  if (CLASSIFIER_DOTTED_CODE_PATTERN.test(normalized)) return true;
  if (/^\d{1,6}$/.test(normalized) && !hasStrongArticleContext && !hasBrandAdjacentNumericContext) return true;
  if (/^\d+\.\d{2,}$/.test(normalized)) return true;
  if (/^EOF\s+\d+$/i.test(normalized)) return true;
  if (/^65535$/.test(normalized)) return true;
  if (/^\d{20}$/.test(normalized)) return true;
  if (/^0+$/.test(normalized)) return true;
  if (/^\d{5,}:[A-Z]{8,}$/i.test(normalized)) return true;
  if (/^\d{1,4}\s*(?:VAC|VDC|AC|DC|HZ)$/i.test(normalized)) return true;
  // PDF binary residue: JPEG DCT markers, ICC profiles, object references
  if (PDF_RESIDUE_PATTERNS.some((p) => p.test(normalized))) return true;
  // Known PDF dimension/metric values
  if (PDF_DIMENSION_VALUES.has(normalized)) return true;
  // Year-like numbers (2000-2039) without strong article context
  if (YEAR_LIKE_PATTERN.test(normalized) && !hasStrongArticleContext && !hasBrandAdjacentNumericContext) return true;
  // Pure 3-4 digit numbers: require brand-adjacent or strong article context
  if (/^\d{3,4}$/.test(normalized) && !hasStrongArticleContext && !hasBrandAdjacentNumericContext) return true;
  // JPEG DCT residue with colon (e.g., "456789:CDEFGHIJ...")
  if (/^\d+:[A-Z]{4,}/i.test(normalized)) return true;
  // IEC standard versions misidentified as articles
  if (/^IEC\d/i.test(normalized)) return true;
  // Digit-only codes (with separators) in phone/contact/requisites context
  if (/^[\d\-.\s()]+$/.test(normalized) && hasArticleNoiseContext(line)) return true;
  // PDF CreationDate/ModDate tokens: D:20231202154827Z
  if (/^D:\d{8,}/i.test(normalized)) return true;
  // Software version strings: PXC-Ver:10.3.0.386, Build:1234
  if (/(?:Ver|Version|Build|Release):\d/i.test(normalized)) return true;
  // Field label prefixes: CODE:4-017-1816, TYPE: L110-F2G
  if (/^(?:CODE|TYPE|REF|PART):/i.test(normalized)) return true;
  // Email field values extracted as articles: Email:user123, e-mail:snab4
  if (/^e-?mail:\w+/i.test(normalized)) return true;
  // Full URLs that slipped through: HTTPS://M4D.NALOG.GOV.RU
  if (/^https?:\/\//i.test(normalized)) return true;
  // Short PDF internal reference keys: Sohv3:X, vmf:i0, IgN:F5, 4U:K
  // Pattern: 1-8 alphanumeric chars, colon, 1-4 alphanumeric chars (no separators on right side)
  if (/^[A-Za-z0-9]{1,8}:[A-Za-z0-9]{1,4}$/.test(normalized)) return true;
  return false;
}

function scoreArticleCandidate(normalized, context = "") {
  let score = 0;
  const value = String(normalized || "").toUpperCase();
  const line = String(context || "").toUpperCase();
  const hasLetters = /[A-ZА-Я]/i.test(value);
  const hasDigits = /\d/.test(value);
  const segments = value.split(/[-/.+]/).filter(Boolean).length;

  if (hasLetters && hasDigits) score += 3;
  if (/[-/]/.test(value)) score += 2;
  if (value.length >= 6) score += 2;
  if (segments >= 2) score += 2;
  if (value === value.toUpperCase()) score += 1;

  if (ARTICLE_POSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    score += 3;
  }
  if (ARTICLE_NEGATIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    score -= 8;
  }

  for (const pattern of ARTICLE_CONTEXT_POSITIVE_PATTERNS) {
    if (pattern.test(line)) score += 2;
  }
  for (const pattern of ARTICLE_CONTEXT_NEGATIVE_PATTERNS) {
    if (pattern.test(line)) score -= 4;
  }

  return score;
}

function buildSuggestedReply(label, sender, lead, crm) {
  const name = sender.fullName && sender.fullName !== "Не определено" ? sender.fullName.split(" ")[0] : "";
  const greeting = name ? `${name}, добрый день!` : "Добрый день!";

  if (label === "СПАМ") return null;

  if (label === "Клиент" && crm.needsClarification) {
    // Build specific list of missing data
    const missingItems = [];
    if (!sender.companyName) missingItems.push("наименование и форму организации (ООО, АО, ИП)");
    if (!sender.inn) missingItems.push("ИНН и КПП");
    if (!(lead.articles || []).length) missingItems.push("точные артикулы и количество");
    if (!sender.cityPhone && !sender.mobilePhone) missingItems.push("контактный телефон");
    const missingStr = missingItems.length
      ? missingItems.map((item) => `- ${item}`).join("\n")
      : "- Полные реквизиты компании (ИНН, КПП, юридический адрес)\n- Точные артикулы и количество";
    return `${greeting}\n\nСпасибо за обращение.\nДля подготовки коммерческого предложения, пожалуйста, уточните:\n${missingStr}\n\nС уважением,\n${crm.curatorMop || "Отдел продаж"}`;
  }

  if (label === "Клиент") {
    const articles = (lead.articles || []).slice(0, 5).join(", ");
    const brandStr = (lead.detectedBrands || []).join(", ");
    const urgencyNote = lead.urgency === "urgent" ? "\nМы понимаем срочность запроса и обработаем его в приоритетном порядке." : "";
    const positionsNote = (lead.totalPositions || 0) > 3 ? ` (${lead.totalPositions} позиций)` : "";
    return `${greeting}\n\nСпасибо за заявку${brandStr ? ` по ${brandStr}` : ""}${positionsNote}.\n${articles ? `Артикулы: ${articles}\n` : ""}Мы подготовим коммерческое предложение и направим в ближайшее время.${urgencyNote}\n\nС уважением,\n${crm.curatorMop || "Отдел продаж"}`;
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

/** Case-insensitive dedup for brands — keeps the first casing encountered */
function uniqueBrands(items) {
  const seen = new Map();
  for (const item of items) {
    const key = String(item).toLowerCase();
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
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
  return String(value || "")
    .replace(/\u00AD/g, "")    // soft hyphens
    .replace(/\u00A0/g, " ")   // non-breaking spaces
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getContextLine(text, index = 0, length = 0) {
  const source = String(text || "");
  if (!source) return "";
  const start = Math.max(0, source.lastIndexOf("\n", Math.max(0, index)) + 1);
  const nextNewline = source.indexOf("\n", Math.max(0, index + length));
  const end = nextNewline === -1 ? source.length : nextNewline;
  return source.slice(start, end).trim();
}

// Known webform notification senders (noreply-only form services)
const TILDA_FORM_DOMAINS = new Set(["tilda.ws", "tilda.cc"]);

function isTildaWebFormSender(email) {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return TILDA_FORM_DOMAINS.has(domain);
}

function parseTildaFormBody(body) {
  // Strip HTML tags to get plain text for parsing
  const plain = body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  // Extract form section between "Request details:" and "Additional information:"
  const detailsIdx = plain.search(/Request\s+details:/i);
  const additionalIdx = plain.search(/Additional\s+information:/i);
  const sectionStart = detailsIdx !== -1 ? detailsIdx : 0;
  const formSection = additionalIdx > sectionStart
    ? plain.slice(sectionStart, additionalIdx)
    : plain.slice(sectionStart, sectionStart + 2000);

  // Parse key: value pairs (name, phone, email, comment, v1..vN)
  const kvRe = /^([a-zA-Zа-яёА-ЯЁ0-9_\s]+?)\s*:\s*(.+)$/gm;
  const fields = {};
  let m;
  while ((m = kvRe.exec(formSection)) !== null) {
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    if (val && val !== "yes" && val !== "no") fields[key] = val;
  }

  // Name: "name", "Name", "ФИО", "имя"
  const name = fields["name"] || fields["фио"] || fields["имя"] || null;

  // Phone
  const phoneVal = fields["phone"] || fields["телефон"] || fields["тел"] || null;

  // Email
  const emailVal = fields["email"] || fields["e-mail"] || null;

  // Product/message: "comment", "message", "сообщение", "запрос", "v1" (first text field)
  const product = fields["comment"] || fields["message"] || fields["сообщение"]
    || fields["запрос"] || fields["товар"] || fields["продукт"]
    || fields["v1"] || null;

  // Company/INN
  const company = fields["company"] || fields["компания"] || fields["организация"] || null;
  const innMatch = formSection.match(/ИНН\s*[:\-]?\s*(\d{10,12})/i);
  const inn = innMatch?.[1] || null;

  return { name, phone: phoneVal, email: emailVal, product, company, inn, formSection };
}

function parseRobotFormBody(subject, body) {
  // Detect form section boundary (Bitrix standard and widget formats)
  const formHeaderIdx = body.search(/Заполнена\s+(?:форма|web-форма)|Имя\s+посетителя:|Новый\s+(?:заказ|лид)|Заказ\s+звонка/i);
  const formEndIdx = body.search(/(?:Запрос|Заявка|Вопрос)\s+отправлен[а]?:/i);
  const sectionStart = formHeaderIdx !== -1 ? formHeaderIdx : 0;
  let formSection = (formEndIdx > sectionStart)
    ? body.slice(sectionStart, formEndIdx)
    : body.slice(sectionStart, sectionStart + 1500);
  formSection = formSection
    .replace(/^Страница\s+отправки:\s*.*$/gim, "")
    .replace(/^Просмотр\s+результата\s+на\s+сайте:\s*.*$/gim, "")
    .replace(/^https?:\/\/[^\s]+$/gim, "")
    .replace(/^\s*\*\s*(?:From|Sent|To|Cc|Subject)\*:\s*.*$/gim, "")
    .trim();

  // Visitor name: "Имя посетителя: X" or widget "Ваше имя\n***\nX"
  const nameMatch =
    formSection.match(/Имя\s+посетителя:\s*(.+?)[\r\n]/i) ||
    body.match(/Ваше\s+имя\s*[\r\n]\*+[\r\n](.+?)[\r\n]/i);
  const name = nameMatch?.[1]?.trim() || null;

  // Real sender email embedded in form body (not robot@siderus.ru)
  const emailInlineMatch = formSection.match(/^E?-?mail:\s*([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,})/im);
  const emailMailtoMatch = formSection.match(/mailto:([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,})/i);
  const emailWidgetMatch = body.match(/E-?mail\s*[\r\n]\*+[\r\n]\s*([\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-z]{2,})/i);
  const email = (emailInlineMatch?.[1] || emailMailtoMatch?.[1] || emailWidgetMatch?.[1] || null)
    ?.toLowerCase().replace(/:$/, "") || null;

  // Phone: "Телефон: +7..." or "WhatsApp: +7..." or widget "Телефон\n***\n+7..."
  const phoneInlineMatch = formSection.match(/(?:Телефон|WhatsApp):\s*([+\d][\d\s\-()]{5,})/i);
  const phoneWidgetMatch = body.match(/(?:Телефон|WhatsApp)\s*[\r\n]\*+[\r\n]\s*([+\d][\d\s\-()]{5,})/i);
  const phone = (phoneInlineMatch?.[1] || phoneWidgetMatch?.[1])?.trim() || null;

  // Product / item name
  const productMatch = formSection.match(/(?:Название\s+товара|Продукт|Товар):\s*(.+?)[\r\n]/i);
  const product = productMatch?.[1]?.trim() || null;

  // Message / question text (stop before next form field or URL)
  const msgMatch = formSection.match(/(?:Сообщение|Вопрос):\s*([\s\S]+?)(?:\n[ \t]*\n|\nСтраница\s+отправки|\nID\s+товара|$)/i);
  const message = msgMatch?.[1]?.trim().slice(0, 500) || null;

  // Company and INN (sometimes present in advanced forms)
  const companyMatch = formSection.match(/Название\s+организации:\s*(.+?)[\r\n]/i);
  const company = companyMatch?.[1]?.trim() || null;
  const innMatch = formSection.match(/ИНН:\s*(\d{10,12})/i);
  const inn = innMatch?.[1] || null;

  // Resume form → should be classified as spam
  const isResume = /резюме|вакансия/i.test(subject + " " + formSection);

  return { name, email, phone, product, message, company, inn, formSection, isResume };
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
  // Handle combined ИНН/КПП: X/Y format first (КПП after slash)
  const innKppMatch = text.match(/(?:ИНН|inn)\/КПП\s*[:#-]?\s*(\d{10,12})\/(\d{9})/i);
  return {
    inn: innKppMatch?.[1] || text.match(INN_PATTERN)?.[1] || null,
    kpp: innKppMatch?.[2] || text.match(KPP_PATTERN)?.[1] || null,
    ogrn: text.match(OGRN_PATTERN)?.[1] || null
  };
}

function normalizeComparableText(text) {
  return ` ${String(text || "")
    .toLowerCase()
    .replace(/\u00AD/g, "")    // soft hyphens
    .replace(/\u00A0/g, " ")   // non-breaking spaces
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
  if (!/<[a-zA-Z]/.test(text)) return cleanupText(text);
  return cleanupText(text
    // Remove style/script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    // Remove data URIs in inline styles (base64 images)
    .replace(/data:[^;]*;[^,]*,[A-Za-z0-9+/=\s]{10,}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    // Remove CSS-like artifacts (mj-column-per-100, font-family lines)
    .replace(/mj-[\w-]+/gi, " "));
}

function cleanupText(text) {
  return text
    .replace(/\u00AD/g, "")    // soft hyphens
    .replace(/\u00A0/g, " ")   // non-breaking spaces
    .replace(/\u200B/g, "")    // zero-width spaces
    .replace(/\uFEFF/g, "")    // byte order mark
    .replace(/\u226A/g, "«")   // ≪ → «
    .replace(/\u226B/g, "»")   // ≫ → »
    .replace(/ {2,}/g, " ")    // collapse multiple spaces (preserve tabs for table parsing)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
