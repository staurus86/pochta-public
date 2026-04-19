/**
 * Quality gate — runs before assigning pipeline status "ready_for_crm".
 *
 * Returns { ok, errors[], warnings[] }:
 *   - errors: block ready_for_crm (send to review instead)
 *   - warnings: informational, do not block
 *
 * Business rules (from TZ 2026-04-19):
 *   1. Для quotation/order — обязателен контакт (ФИО или company или phone) И товар (article, brand или lineItem)
 *   2. ИНН должен быть либо валидным (digit-only 9/10/12), либо отсутствовать (не строкой-мусором)
 *   3. Если компания присутствует, она должна пройти sanitizer (no <>/mailto/url)
 *   4. Низкая confidence (<0.5) при пустых реквизитах → block
 */

const VALID_INN_RE = /^\d{9}$|^\d{10}$|^\d{12}$/;
const DIRTY_COMPANY_RE = /[<>]|mailto:|https?:\/\//i;

/**
 * @param {object} analysis
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateBeforeCrm(analysis) {
    const errors = [];
    const warnings = [];
    if (!analysis) return { ok: false, errors: ["empty_analysis"], warnings };

    const sender = analysis.sender || {};
    const lead = analysis.lead || {};
    const rt = analysis.llmExtraction?.requestType || null;
    const conf = Number(analysis.classification?.confidence ?? 0);

    // Rule 2: INN must be valid-or-absent.
    if (sender.inn && !VALID_INN_RE.test(String(sender.inn))) {
        errors.push("invalid_inn_format");
    }

    // Rule 3: company must be clean if set.
    if (sender.companyName && DIRTY_COMPANY_RE.test(String(sender.companyName))) {
        errors.push("dirty_company_name");
    }

    // Rule 1: for quotation/order — require contact AND product signal.
    if (rt === "quotation" || rt === "order") {
        const hasContact = Boolean(
            sender.fullName ||
            sender.companyName ||
            sender.cityPhone ||
            sender.mobilePhone
        );
        const hasProduct =
            (Array.isArray(lead.articles) && lead.articles.length > 0) ||
            (Array.isArray(analysis.detectedBrands) && analysis.detectedBrands.length > 0) ||
            (Array.isArray(lead.lineItems) && lead.lineItems.length > 0);

        if (!hasContact) errors.push("no_contact_info");
        if (!hasProduct) errors.push("no_product_signal");
    }

    // Rule 4: low confidence + no requisites → block.
    const noRequisites = !sender.inn && !sender.companyName && !sender.fullName;
    if (conf > 0 && conf < 0.5 && noRequisites) {
        errors.push("low_confidence_no_requisites");
    }

    // Warn (no block) on missing phone when there's no INN.
    if (!sender.inn && !sender.cityPhone && !sender.mobilePhone) {
        warnings.push("no_phone_no_inn");
    }

    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Attach gate result to analysis.qualityGate for downstream use.
 * Does NOT modify pipeline status — caller decides how to consume.
 */
export function annotateQualityGate(analysis) {
    if (!analysis) return;
    const result = validateBeforeCrm(analysis);
    analysis.qualityGate = {
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
        evaluatedAt: new Date().toISOString()
    };
    return result;
}
