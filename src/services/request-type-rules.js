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
    /(?:^|\W)запрос(?:\s+на)?\s+(?:кп|коммерческ)/iu,
    /(?:^|\W)просим\s+(?:выставить|предоставить)\s+(?:кп|счёт|цен)/iu,
    /(?:^|\W)(?:прошу|просьба)\s+(?:выставить|предоставить)\s+(?:кп|цен)/iu,
    /(?:^|\W)расчёт(?:\s+стоимост|\s+цен)/iu,
    /\bprice\s+(?:request|quote|inquiry)/i,
    /\brequest\s+for\s+quot(?:e|ation)/i,
    /\bRFQ\b/,
    /(?:^|\W)коммерческ(?:ое|ого)\s+предложен/iu,
    /(?:^|\W)прайс[-\s]?лист/iu,
];

const ORDER_PATTERNS = [
    /(?:^|\W)(?:подтверждаем|подтверждение)\s+заказ/iu,
    /(?:^|\W)наш\s+заказ\s*№/iu,
    /(?:^|\W)заказ(?:ываем|ать)\s+(?:следующ|товар)/iu,
    /\bpurchase\s+order\b/i,
    /(?:^|\W)счёт\s+на\s+оплату\s*№/iu,
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
