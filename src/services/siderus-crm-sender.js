import { normalizeArticleCode } from "./article-normalizer.js";

function resolveBody(message) {
    const analysis = message.analysis || {};
    return message.body
        || analysis.rawInput?.body
        || analysis.lead?.freeText
        || message.bodyPreview
        || "";
}

function buildOrderFromMail(lead) {
    const lineItems = lead.lineItems || [];
    const nomenclatureMatches = lead.nomenclatureMatches || [];
    const detectedBrands = lead.detectedBrands || [];
    const mainBrand = detectedBrands[0] || null;

    const articleBrandMap = new Map();
    for (const match of nomenclatureMatches) {
        if (match.article && match.brand) {
            articleBrandMap.set(normalizeArticleCode(match.article).toLowerCase(), match.brand);
        }
    }

    const structured = lineItems
        .filter((item) => item.article && !item.article.startsWith("DESC:"))
        .map((item) => ({
            brand: articleBrandMap.get(normalizeArticleCode(item.article).toLowerCase()) || mainBrand,
            desc: item.descriptionRu || null,
            item_number: item.article,
            quantity: item.quantity != null ? Number(item.quantity) : null
        }));

    if (structured.length > 0) return structured;

    if ((lead.productNames || []).length > 0) {
        return lead.productNames.map((p) => ({
            brand: mainBrand,
            desc: p.name || null,
            item_number: p.article,
            quantity: null
        }));
    }

    if ((lead.articles || []).length > 0) {
        return lead.articles.map((a) => ({
            brand: mainBrand,
            desc: null,
            item_number: a,
            quantity: null
        }));
    }

    return [];
}

export function buildSiderusCrmPayload(project, message) {
    const analysis = message.analysis || {};
    const sender = analysis.sender || {};
    const lead = analysis.lead || {};
    const crm = analysis.crm || {};

    return {
        // Required fields (n8n contract)
        company_name: sender.companyName || crm.company?.legalName || null,
        inn: sender.inn || crm.company?.inn || null,
        client_name: sender.fullName || null,
        phone_number: sender.mobilePhone || sender.cityPhone || null,
        subject_email: message.subject || "",
        original_markdown: resolveBody(message),
        order_from_mail: buildOrderFromMail(lead),

        // Extended fields
        sender_email: sender.email || message.from || null,
        mailbox: message.mailbox || project.mailbox || null,
        position: sender.position || null,
        city_phone: sender.cityPhone || null,
        website: sender.website || null,
        kpp: sender.kpp || null,
        ogrn: sender.ogrn || null,
        classification: analysis.classification?.label || null,
        request_type: lead.requestType || null,
        detected_brands: lead.detectedBrands || [],
        pipeline_status: message.pipelineStatus || null,
        message_key: message.messageKey || message.id || null,
        created_at: message.createdAt || null,
        project_id: project.id,
        project_name: project.name,
        crm_existing_company: Boolean(crm.isExistingCompany),
        crm_company_id: crm.company?.id || null
    };
}

export class SiderusCrmSender {
    constructor({ url, authToken, timeoutMs = 10_000, logger = console } = {}) {
        this.url = url;
        this.authToken = authToken;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
    }

    isEnabled() {
        return Boolean(this.url && this.authToken);
    }

    async sendNewMessages(project, messages = []) {
        if (!this.isEnabled()) return;

        const eligible = messages.filter((m) => m.pipelineStatus === "ready_for_crm");
        for (const message of eligible) {
            const key = message.messageKey || message.id || "unknown";
            try {
                const payload = buildSiderusCrmPayload(project, message);
                await this._post(payload);
                this.logger.log(`[siderus-crm] sent ${key}`);
            } catch (err) {
                this.logger.warn(`[siderus-crm] failed ${key}: ${err.message}`);
            }
        }
    }

    async _post(payload) {
        const body = JSON.stringify(payload);
        const response = await fetch(this.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": this.authToken
            },
            body,
            signal: AbortSignal.timeout(this.timeoutMs)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
    }
}

export function createSiderusCrmSender(env = process.env) {
    const url = String(env.SIDERUS_CRM_WEBHOOK_URL || "").trim();
    const authToken = String(env.SIDERUS_CRM_AUTH_TOKEN || "").trim();
    if (!url || !authToken) return null;
    return new SiderusCrmSender({ url, authToken });
}
