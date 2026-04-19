/**
 * Rule-based fallback for llmExtraction.requestType.
 * Runs when LLM is disabled, didn't fire, or returned null.
 *
 * Enum (canonical): quotation | order | vendor_offer | info_request |
 *                   complaint | service_request | spam | other
 */

// NOTE: ASCII `\b` boundaries don't work around Cyrillic chars in JS regex.
// Cyrillic patterns rely on whitespace/punctuation anchoring via (?:^|\W).
const RFQ_PATTERNS = [
    // Direct "запрос" variations — most common RFQ prefix
    /(?:^|\W)запрос(?:\s+на)?\s+(?:кп|коммерческ|цен|стоимост|счет|счёт|поставк|оборудован|расчет|расчёт|калькуляц)/iu,
    /(?:^|\W)запрос(?:\s+от)?\s*(?:№|\d)/iu,                  // "Запрос №123", "Запрос от 15.04"
    /(?:^|^[\s\W]*)запрос(?:\s|$)/iu,                          // standalone "Запрос" at start
    // "Заявка" — quotation/order request
    /(?:^|\W)заявка(?:\s+на|\s+от|\s+№|\s*$|\s+для)/iu,
    // Просим/прошу предоставить/выставить/рассчитать/рассмотреть
    /(?:^|\W)просим\s+(?:выставить|предоставить|рассчитать|просчитать|сообщить|уточнить)/iu,
    /(?:^|\W)(?:прошу|просьба)\s+(?:выставить|предоставить|рассчитать|просчитать|рассмотреть|сообщить|уточнить|помочь)/iu,
    // Расчёт стоимости/цен
    /(?:^|\W)расч[её]т(?:\s+стоимост|\s+цен|\s+на)/iu,
    // Коммерческое предложение / КП
    /(?:^|\W)коммерческ(?:ое|ого)\s+предложен/iu,
    /(?:^|\W)КП(?:\s|$|[,.:;-])/u,                            // standalone КП
    // Прайс, счёт на оплату (без №), цена
    /(?:^|\W)прайс[-\s]?лист/iu,
    /(?:^|\W)(?:счёт|счет)\s+на(?:\s|$)/iu,
    /(?:^|\W)цена(?:\s+на|\s+за)/iu,
    // "Заполнена форма" — web-form lead (quotation)
    /(?:^|\W)заполнен(?:а|о)\s+форм/iu,
    /(?:^|\W)(?:новая\s+)?форма(?:\s+с\s+сайта|\s+обратной\s+связи|\s+на\s+сайте)/iu,
    // Вопрос через / вопрос с сайта
    /(?:^|\W)вопрос\s+(?:через|с\s+сайт|по)/iu,
    // English
    /\bprice\s+(?:request|quote|inquiry|list)/i,
    /\brequest\s+for\s+quot(?:e|ation)/i,
    /\bRFQ\b/,
    /\bquotation\b/i,
];

const ORDER_PATTERNS = [
    /(?:^|\W)(?:подтверждаем|подтверждение)\s+заказ/iu,
    /(?:^|\W)наш\s+заказ(?:\s|$|[,.:;№])/iu,
    /(?:^|\W)новый\s+заказ(?:\s|$|[,.:;№])/iu,
    /(?:^|\W)заказ(?:ываем|ать)\s+(?:следующ|товар)/iu,
    /\bpurchase\s+order\b/i,
    /(?:^|\W)счёт\s+на\s+оплату\s*№/iu,
    /(?:^|^[\s\W]*)заказ(?:\s+№|\s+от|\s*$)/iu,
    /\bplace\s+(?:an\s+)?order/i,
];

const VENDOR_OFFER_PATTERNS = [
    /(?:^|\W)(?:предлагаем|предложение)\s+(?:сотрудничеств|поставк|услуг)/iu,
    /(?:^|\W)мы\s+являемся\s+(?:производ|поставщ|дистрибьют)/iu,
    /(?:^|\W)наша\s+компания\s+(?:предлагает|производит|поставляет)/iu,
    /(?:^|\W)(?:мы|наша\s+компания).{0,40}\s+(?:дистрибьютор|дилер|производитель)/iu,
    /(?:^|\W)выгодн(?:ое|ые)\s+услови/iu,
];

const INFO_REQUEST_PATTERNS = [
    /(?:^|\W)подскажите[,\s]+(?:пожалуйста|плз)/iu,
    /(?:^|\W)как\s+(?:заказать|купить|оплатить)/iu,
    /(?:^|\W)(?:техническ|инструкц|документац|паспорт)/iu,
    /(?:^|\W)как(?:ие|ая|ой)\s+(?:срок|условия|гаранти)/iu,
];

const COMPLAINT_PATTERNS = [
    /(?:^|\W)(?:претенз|жалоб|рекламац)/iu,
    /(?:^|\W)некачествен/iu,
    /(?:^|\W)не\s+работает(?:$|\W)/iu,
    /(?:^|\W)возврат(?:\s+товар|\s+денег)/iu,
];

const SERVICE_REQUEST_PATTERNS = [
    /(?:^|\W)(?:ремонт|сервис|обслуживан|диагностик)/iu,
    /(?:^|\W)(?:пусконаладк|монтаж|шеф-?монтаж)/iu,
    /(?:^|\W)(?:гарантийн|негарантийн)\s+(?:ремонт|случ)/iu,
];

/**
 * Classify by rules. Returns canonical enum string.
 * @param {object} params
 * @param {string} [params.subject]
 * @param {string} [params.body]
 * @param {string} [params.label] — current classification label (Клиент/СПАМ/etc)
 * @returns {string|null} canonical request type or null if nothing matched
 */
export function classifyRequestType({ subject = "", body = "", label = "" } = {}) {
    if (label === "СПАМ") return "spam";

    const haystack = `${subject}\n${String(body || "").slice(0, 1500)}`;

    if (RFQ_PATTERNS.some((p) => p.test(haystack))) return "quotation";
    if (ORDER_PATTERNS.some((p) => p.test(haystack))) return "order";
    if (VENDOR_OFFER_PATTERNS.some((p) => p.test(haystack))) return "vendor_offer";
    if (COMPLAINT_PATTERNS.some((p) => p.test(haystack))) return "complaint";
    if (SERVICE_REQUEST_PATTERNS.some((p) => p.test(haystack))) return "service_request";
    if (INFO_REQUEST_PATTERNS.some((p) => p.test(haystack))) return "info_request";

    return null;
}

/**
 * Apply fallback: if LLM didn't set requestType, try rules. Idempotent.
 * @param {object} analysis — analyzeEmail result
 * @returns {boolean} true if requestType was filled/changed by fallback
 */
export function applyRequestTypeFallback(analysis) {
    if (!analysis) return false;
    const existing = analysis.llmExtraction?.requestType;
    if (existing) return false;

    const label = analysis.classification?.label || "";
    const guessed = classifyRequestType({
        subject: analysis.rawInput?.subject || "",
        body: analysis.rawInput?.body || "",
        label
    });

    if (!guessed) return false;

    if (!analysis.llmExtraction) {
        analysis.llmExtraction = {
            processedAt: null,
            model: null,
            requestType: null,
            isUrgent: false,
            missingForProcessing: [],
            newArticlesAdded: 0,
            detectionGapsCount: 0
        };
    }
    analysis.llmExtraction.requestType = guessed;
    analysis.llmExtraction.requestTypeSource = "rules";
    return true;
}
