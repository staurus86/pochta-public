import https from "node:https";
import { normalizeArticleCode } from "./article-normalizer.js";

// n8n test server uses a cert not in Node's bundle; scoped agent for webhook calls only.
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

function resolveBody(message) {
    const analysis = message.analysis || {};
    return message.body
        || analysis.rawInput?.body
        || analysis.lead?.freeText
        || message.bodyPreview
        || "";
}

// Filters out measurement specs, size fractions, and transliterated Cyrillic
// that slip through the analyzer but are not real article codes.
function isPayloadArticleNoise(article) {
    if (!article || article.length < 3) return true;
    const a = article.trim();
    // Pure measurement: "11mm", "0-500ppm" — digit(s) + lowercase unit only
    // Uppercase suffix (e.g. "121CT") means it's a real code, not a unit
    if (/^\d[\d\s.\-]*[a-z]{1,4}$/.test(a)) return true;
    // Size fraction / thread: "5B/10A", "G1/4.1" — digit ratio or thread size
    if (/^[A-Z]?\d+[A-Za-z]*\/[\d.]+[A-Za-z]*$/.test(a)) return true;
    // Pure dimensions mistaken for an article: "601.7x605.5x318.4", "48х2х10".
    // Triggered only with 3+ groups or a decimal group, so integer profile codes
    // like "40x40" are preserved.
    if (/^\d+(?:[.,]\d+)?(?:\s?[xхX×*]\s?\d+(?:[.,]\d+)?){1,3}$/.test(a)
        && (/[.,]/.test(a) || (a.match(/[xхX×*]/g) || []).length >= 2)) return true;
    // Transliterated Cyrillic: first hyphen/space token is 5+ uppercase-only letters
    // e.g. "HYTPOMEP HI 18-35-1", "TEPMOCTAT R5THV2", "PYKAB 72609.925.00.850"
    const firstToken = a.split(/[\s-]/)[0];
    if (/^[A-Z]{5,}$/.test(firstToken)) return true;
    // Russian word fragment attached to digit: "16-ti"
    if (/^\d+-[a-z]{2,}$/.test(a)) return true;
    return false;
}

// Quantities are sometimes a fragment of the article number that leaked into the qty
// field (e.g. article "32143-48" → qty 32143) or an out-of-range outlier. Drop those
// rather than send a bogus count to the manager. A genuine small count (1-9999) that is
// not embedded in the article digits is kept.
function sanitizePayloadQuantity(quantity, article) {
    if (quantity == null) return null;
    const n = Number(quantity);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n > 10000) return null;
    const q = String(Math.trunc(n));
    if (q.length >= 4 && article) {
        const artDigits = String(article).replace(/\D/g, "");
        if (artDigits.includes(q)) return null;
    }
    return n;
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

    // Broadcast a single detected brand ONLY when there is exactly one real position.
    // Multiple positions sharing one detected brand → leave brandless rather than stamp
    // the wrong brand on every line (manager feedback: "бренд из первой строки на все товары").
    const realPositionCount = lineItems.filter(
        (i) => i.article && !i.article.startsWith("DESC:") && !isPayloadArticleNoise(i.article)
    ).length;
    const brandFallback = (detectedBrands.length === 1 && realPositionCount === 1) ? mainBrand : null;
    // For positions sourced from a structured spreadsheet, keep name+qty rows even when the
    // sheet has no dedicated article column (article embedded in the name) — those are real
    // positions the manager counts. Body-derived leads keep the strict article requirement.
    const isStructured = lead.positionsSource === "structured_attachment";
    const seen = new Set();
    const structured = lineItems
        .filter((item) => {
            if (item.article) return !item.article.startsWith("DESC:") && !isPayloadArticleNoise(item.article);
            // Article-less spreadsheet row: keep only if it looks like a real position
            // (has a quantity), so junk/empty cells in messy sheets are not flooded in.
            return isStructured && Boolean(item.descriptionRu) && item.quantity != null;
        })
        .filter((item) => {
            const key = item.article ? normalizeArticleCode(item.article).toLowerCase() : `desc:${(item.descriptionRu || "").toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((item) => ({
            brand: item.brand
                || (item.article ? articleBrandMap.get(normalizeArticleCode(item.article).toLowerCase()) : null)
                || brandFallback,
            desc: item.descriptionRu || null,
            item_number: item.article || null,
            quantity: sanitizePayloadQuantity(item.quantity, item.article)
        }));

    if (structured.length > 0) return structured;

    if ((lead.productNames || []).length > 0) {
        return lead.productNames
            .filter((p) => !isPayloadArticleNoise(p.article))
            .map((p) => ({
                brand: mainBrand,
                desc: p.name || null,
                item_number: p.article,
                quantity: null
            }));
    }

    if ((lead.articles || []).length > 0) {
        return lead.articles
            .filter((a) => !isPayloadArticleNoise(a))
            .map((a) => ({
                brand: mainBrand,
                desc: null,
                item_number: a,
                quantity: null
            }));
    }

    return [];
}

const DOCUMENT_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "docx", "doc", "csv", "txt", "rtf", "odt", "ods", "pptx", "ppt", "zip", "rar", "7z"]);

function isDocumentAttachment(filename) {
    const ext = String(filename || "").split(".").pop().toLowerCase();
    return DOCUMENT_EXTENSIONS.has(ext);
}

function buildAttachmentsForPayload(message, baseUrl = "", attachmentToken = "") {
    const allFiles = message.attachmentFiles || message.attachments || [];
    const files = allFiles.filter((item) => {
        const filename = typeof item === "string" ? item : (item.filename || item.name || "");
        return isDocumentAttachment(filename);
    });
    const messageKey = message.messageKey || message.id || "";
    const tokenSuffix = attachmentToken ? `?token=${encodeURIComponent(attachmentToken)}` : "";
    return files.map((item) => {
        const filename = typeof item === "string" ? item : (item.filename || item.name || "");
        const safeName = typeof item === "string" ? item : (item.safeName || filename);
        const relPath = safeName
            ? `/api/attachments/${encodeURIComponent(messageKey)}/${encodeURIComponent(safeName)}`
            : null;
        return {
            filename,
            content_type: typeof item === "string" ? null : (item.contentType || null),
            size: typeof item === "string" ? null : (item.size || null),
            download_url: relPath ? `${baseUrl}${relPath}${tokenSuffix}` : null
        };
    });
}

export function buildSiderusCrmPayload(project, message, baseUrl = "", attachmentToken = "") {
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
        attachments: buildAttachmentsForPayload(message, baseUrl, attachmentToken),

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
    constructor({ url, authToken, baseUrl = "", attachmentToken = "", timeoutMs = 10_000, logger = console } = {}) {
        this.url = url;
        this.authToken = authToken;
        this.baseUrl = baseUrl;
        this.attachmentToken = attachmentToken;
        this.timeoutMs = timeoutMs;
        this.logger = logger;
    }

    isEnabled() {
        return Boolean(this.url && this.authToken);
    }

    buildPayload(project, message) {
        return buildSiderusCrmPayload(project, message, this.baseUrl, this.attachmentToken);
    }

    async sendNewMessages(project, messages = []) {
        if (!this.isEnabled()) return;

        const eligible = messages.filter((m) => m.pipelineStatus === "ready_for_crm");
        for (const message of eligible) {
            const key = message.messageKey || message.id || "unknown";
            try {
                const payload = this.buildPayload(project, message);
                await this._post(payload);
                this.logger.log(`[siderus-crm] sent ${key}`);
            } catch (err) {
                this.logger.warn(`[siderus-crm] failed ${key}: ${err.message}`);
            }
        }
    }

    async _post(payload) {
        const body = JSON.stringify(payload);
        const parsed = new URL(this.url);
        const timeoutMs = this.timeoutMs;
        const authToken = this.authToken;

        await new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: parsed.hostname,
                    port: parsed.port || 443,
                    path: parsed.pathname + parsed.search,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: authToken,
                        "Content-Length": Buffer.byteLength(body)
                    },
                    agent: insecureAgent,
                    timeout: timeoutMs
                },
                (res) => {
                    res.resume();
                    res.on("end", () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve();
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}`));
                        }
                    });
                }
            );
            req.on("timeout", () => { req.destroy(); reject(new Error("Request timeout")); });
            req.on("error", reject);
            req.write(body);
            req.end();
        });
    }
}

export function createSiderusCrmSender(env = process.env) {
    const url = String(env.SIDERUS_CRM_WEBHOOK_URL || "").trim();
    const authToken = String(env.SIDERUS_CRM_AUTH_TOKEN || "").trim();
    if (!url || !authToken) return null;
    const domain = String(env.RAILWAY_PUBLIC_DOMAIN || "").trim();
    const baseUrl = domain ? `https://${domain}` : String(env.APP_BASE_URL || "https://pochta-production.up.railway.app").trim();
    const attachmentToken = String(env.ATTACHMENT_API_TOKEN || "").trim();
    return new SiderusCrmSender({ url, authToken, baseUrl, attachmentToken });
}
