/**
 * Canonical enum normalization for llmExtraction.missingForProcessing.
 *
 * Accepts free-form keys from LLM ("company_name", "sender_phone", "ИНН")
 * and maps them to canonical set: contact_name | phone | company | inn |
 * kpp | ogrn | article | brand | quantity | delivery_address
 */

export const ALLOWED_MISSING = Object.freeze(new Set([
    "contact_name",
    "phone",
    "company",
    "inn",
    "kpp",
    "ogrn",
    "article",
    "brand",
    "quantity",
    "delivery_address"
]));

const ALIAS_MAP = new Map([
    // contact_name
    ["fullname", "contact_name"],
    ["full_name", "contact_name"],
    ["fio", "contact_name"],
    ["фио", "contact_name"],
    ["имя", "contact_name"],
    ["name", "contact_name"],
    ["contactname", "contact_name"],
    ["contact", "contact_name"],

    // phone
    ["telephone", "phone"],
    ["tel", "phone"],
    ["телефон", "phone"],
    ["sender_phone", "phone"],
    ["mobile", "phone"],
    ["mobile_phone", "phone"],
    ["city_phone", "phone"],

    // company
    ["company_name", "company"],
    ["companyname", "company"],
    ["organization", "company"],
    ["org", "company"],
    ["организация", "company"],
    ["компания", "company"],

    // inn
    ["tax_id", "inn"],
    ["taxid", "inn"],
    ["инн", "inn"],

    // kpp
    ["кпп", "kpp"],

    // ogrn
    ["огрн", "ogrn"],
    ["огрнип", "ogrn"],
    ["ogrnip", "ogrn"],

    // article
    ["sku", "article"],
    ["part_number", "article"],
    ["partnumber", "article"],
    ["артикул", "article"],

    // brand
    ["manufacturer", "brand"],
    ["бренд", "brand"],
    ["производитель", "brand"],

    // quantity
    ["qty", "quantity"],
    ["количество", "quantity"],
    ["amount", "quantity"],

    // delivery_address
    ["delivery", "delivery_address"],
    ["address", "delivery_address"],
    ["адрес", "delivery_address"],
    ["адрес_доставки", "delivery_address"],
    ["доставка", "delivery_address"],
    ["shipping", "delivery_address"],
    ["shipping_address", "delivery_address"],
]);

/**
 * Normalize one missing-field key. Returns canonical key or null if unmappable.
 */
export function normalizeMissingKey(raw) {
    if (raw == null) return null;
    const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!key) return null;
    if (ALLOWED_MISSING.has(key)) return key;
    if (ALIAS_MAP.has(key)) return ALIAS_MAP.get(key);
    return null;
}

/**
 * Normalize an array of missing keys. Drops unmappable entries, deduplicates.
 */
export function normalizeMissingList(list) {
    if (!Array.isArray(list)) return [];
    const out = new Set();
    for (const item of list) {
        const k = normalizeMissingKey(item);
        if (k) out.add(k);
    }
    return [...out];
}

/**
 * Build rule-based missing list from analysis state. Used as a safety net
 * when LLM didn't fire or produced an incomplete list.
 */
export function deriveMissingFromState(analysis) {
    if (!analysis) return [];
    const s = analysis.sender || {};
    const lead = analysis.lead || {};
    const out = [];

    if (!s.fullName) out.push("contact_name");
    if (!s.cityPhone && !s.mobilePhone) out.push("phone");
    if (!s.companyName) out.push("company");
    if (!s.inn) out.push("inn");

    const hasArticles = Array.isArray(lead.articles) && lead.articles.length > 0;
    const hasBrands = Array.isArray(analysis.detectedBrands) && analysis.detectedBrands.length > 0;
    const hasQty = Array.isArray(lead.lineItems) &&
        lead.lineItems.some((i) => i && i.quantity != null);

    if (!hasArticles) out.push("article");
    if (!hasBrands) out.push("brand");
    if (!hasQty) out.push("quantity");

    return out;
}

/**
 * Post-process analysis.llmExtraction.missingForProcessing:
 *   1) normalize keys to canonical enum
 *   2) union with rule-derived list (covers LLM omissions)
 *   3) drop fields that are actually present
 */
export function reconcileMissingForProcessing(analysis) {
    if (!analysis) return;
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
    const llmList = normalizeMissingList(analysis.llmExtraction.missingForProcessing);
    const ruleList = deriveMissingFromState(analysis);
    const union = new Set([...llmList, ...ruleList]);

    // Drop fields that ARE present (belt & suspenders — derive already handles this,
    // but LLM may insist on already-filled field).
    const s = analysis.sender || {};
    const lead = analysis.lead || {};
    if (s.fullName) union.delete("contact_name");
    if (s.cityPhone || s.mobilePhone) union.delete("phone");
    if (s.companyName) union.delete("company");
    if (s.inn) union.delete("inn");
    if (s.kpp) union.delete("kpp");
    if (s.ogrn) union.delete("ogrn");
    if (Array.isArray(lead.articles) && lead.articles.length > 0) union.delete("article");
    if (Array.isArray(analysis.detectedBrands) && analysis.detectedBrands.length > 0) union.delete("brand");
    if (Array.isArray(lead.lineItems) && lead.lineItems.some((i) => i && i.quantity != null)) union.delete("quantity");

    analysis.llmExtraction.missingForProcessing = [...union];
}
