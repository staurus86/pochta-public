/**
 * LLM-powered entity extraction (final pass) using OpenAI-compatible API.
 * Fills gaps left by rules-based extraction and logs detection improvement hints.
 *
 * Env vars:
 *   LLM_EXTRACT_ENABLED=true          — enable
 *   LLM_EXTRACT_API_KEY=sk-...        — API key
 *   LLM_EXTRACT_BASE_URL              — default: https://api.artemox.com/v1
 *   LLM_EXTRACT_MODEL                 — default: gpt-4o-mini
 *   LLM_EXTRACT_TIMEOUT_MS            — default: 20000
 *   LLM_EXTRACT_LOG_SUGGESTIONS=true  — write detection hints to data/llm-suggestions.jsonl
 */

import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SUGGESTIONS_LOG = path.resolve(__dir, "../../data/llm-suggestions.jsonl");

// Read env vars lazily (at call time) so the module works correctly when
// env vars are set after module load (e.g. in test scripts).
function cfg() {
    return {
        enabled: process.env.LLM_EXTRACT_ENABLED === "true",
        apiKey: process.env.LLM_EXTRACT_API_KEY || "",
        baseUrl: process.env.LLM_EXTRACT_BASE_URL || "https://api.artemox.com/v1",
        model: process.env.LLM_EXTRACT_MODEL || "gpt-4o-mini",
        timeoutMs: Number(process.env.LLM_EXTRACT_TIMEOUT_MS || 30000),
        logSuggestions: process.env.LLM_EXTRACT_LOG_SUGGESTIONS !== "false"
    };
}

export function isLlmExtractEnabled() {
    const c = cfg();
    return c.enabled && c.apiKey.length > 0;
}

export function getLlmExtractConfig() {
    const c = cfg();
    return {
        enabled: c.enabled && c.apiKey.length > 0,
        model: c.model,
        baseUrl: c.baseUrl,
        logSuggestions: c.logSuggestions
    };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — система точного извлечения данных из деловых писем для B2B дистрибьютора промышленного оборудования (приборы КИПиА, электроника, механика, электрооборудование, запчасти, расходники, кабели).

Задача: извлечь структурированные данные и выявить системные пробелы в правил-based детекции (для её улучшения).

Отвечай ТОЛЬКО валидным JSON без markdown, без пояснений, без пробелов перед скобками.`;

const buildUserPrompt = (emailText, rulesFound) => `Письмо для анализа:

---
${emailText}
---

Что уже нашла правил-based система (не дублируй это в detection_gaps):
${JSON.stringify(rulesFound, null, 2)}

Верни JSON строго в этом формате (без markdown, без пояснений):
{
  "articles": [
    {
      "code": "технический код/артикул — СТРОКА, никогда не null",
      "brand": "бренд этой позиции или null",
      "description": "наименование/описание позиции или null",
      "quantity": число или null,
      "unit": "шт/м/кг/л/компл/пара/рул/уп или null"
    }
  ],
  "brands": ["реальные промышленные бренды упомянутые в письме"],
  "sender_name": "ФИО контактного лица или null",
  "sender_email": "email или null",
  "sender_phone": "телефон сохранить как есть из письма или null",
  "company_name": "название компании с правовой формой или null",
  "inn": "ИНН 10 или 12 цифр или null",
  "kpp": "КПП 9 цифр или null",
  "ogrn": "ОГРН 13-15 цифр или null",
  "request_type": "quotation|order|info_request|complaint|vendor_offer|other",
  "is_urgent": true или false,
  "missing_for_processing": ["article","brand","quantity","contact_name","company","inn"],
  "detection_gaps": [
    {
      "type": "article|brand|phone|company|inn|name|quantity|unit",
      "value": "значение которое нашёл LLM но НЕ НАШЛИ правила",
      "context": "цитата из письма до 80 символов",
      "suggestion": "конкретный regex-паттерн или правило для исправления"
    }
  ]
}

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА — нарушение ломает систему:
1. articles[].code — НИКОГДА не null, не пустая строка. Если нет кода — не включай позицию.
2. Кабели и провода: марка кабеля (ПВ1, КВВГ, ВВГнг, КВВГнг, ВВГ и т.д.) — это артикул. Каждое сечение — отдельная позиция с description включающим сечение (например: code="ПВ1", description="ПВ1 1.5 мм²").
3. sender_phone — сохрани как в письме (не нормализуй в +7XXXXXXXXXX).
4. detection_gaps — ТОЛЬКО пробелы в правилах для вещей что rules НЕ нашли. НЕ пиши gaps для: отсутствующих в письме ОГРН/КПП, полей которые уже есть в rulesFound, общих советов не связанных с конкретным письмом.
5. brands — только реальные промышленные бренды (не типы оборудования: "ball valves", "автоматика").
6. inn — только если в письме явно указан как ИНН; БИН/BIN казахских компаний не является ИНН.
7. company_name — ТОЛЬКО компания КЛИЕНТА (отправителя запроса). НЕ бренд продукта, НЕ производитель оборудования. Если клиент запрашивает товар бренда X, company_name не может быть X, "X GmbH", "X Ltd" и т.д. Бери название из подписи, email-домена или текста письма.
8. Если это автоответ/маркетинговая рассылка/спам — верни request_type="other", is_urgent=false, articles=[], brands=[], detection_gaps=[]. НЕ извлекай компанию/контакты из рекламных текстов.
9. missing_for_processing — только то что нужно для обработки КЛИЕНТСКОЙ ЗАЯВКИ (не для vendor_offer/other).
10. Пересланное письмо (Fwd/Forward): извлекай данные из ОРИГИНАЛА, не от пересылающего.
11. articles[].code — НЕ включай: номера счетов, ИНН/ОГРН, номера заказов/тикетов (TK-XXXXX, REQ-XXXX), трекинг-коды, номера банковских документов, случайные токены (4TUU4U, VY1TTJ и подобные). Артикул — это технический код детали/оборудования.
12. Если в description позиции есть явный артикульный код (буквенно-цифровой, ≥4 символов, без пробелов) — используй его как code, а полное описание — как description.`;

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Extract entities from email using LLM.
 * @param {object} params
 * @param {string} params.subject
 * @param {string} params.body
 * @param {string} params.fromEmail
 * @param {string} [params.attachmentText]
 * @param {object} [params.rulesFound] — already-found data from rules engine (to compute gaps)
 * @returns {Promise<object|null>}
 */
export async function llmExtract({ subject, body, fromEmail, attachmentText = "", rulesFound = {} }) {
    if (!isLlmExtractEnabled()) return null;

    const emailContent = [
        `От: ${fromEmail}`,
        `Тема: ${subject}`,
        "",
        body.slice(0, 3500),
        attachmentText ? `\n[Текст из вложений]:\n${attachmentText.slice(0, 1500)}` : ""
    ].filter(Boolean).join("\n");

    const { apiKey, baseUrl, model, timeoutMs } = cfg();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                max_tokens: 1600,
                temperature: 0,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: buildUserPrompt(emailContent, rulesFound) }
                ]
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            console.warn(`LLM extraction HTTP ${response.status}: ${errorText.slice(0, 200)}`);
            return null;
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "";

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn("LLM extraction: no JSON in response");
            return null;
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        if (error.name === "AbortError") {
            console.warn("LLM extraction timed out");
        } else {
            console.warn("LLM extraction error:", error.message);
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Merge LLM results into rules-based result
// ---------------------------------------------------------------------------

/**
 * Merge LLM extraction into existing rules-based analysis result.
 * LLM fills gaps — does NOT override confirmed rules-based data.
 *
 * @param {object} result — analyzeEmail result (mutated in place)
 * @param {object|null} llmData — parsed LLM JSON response
 * @param {string} [messageKey] — for suggestion logging
 * @returns {object} mutated result
 */
export function mergeLlmExtraction(result, llmData, messageKey = "") {
    if (!llmData) return result;

    // --- Merge articles -------------------------------------------------------
    const existingCodes = new Set(
        (result.lead?.articles || []).map((a) => String(a).toLowerCase())
    );
    const newLineItems = [];

    if (Array.isArray(llmData.articles)) {
        for (const item of llmData.articles) {
            // Skip null/empty codes — prompt rule 1 violation guard
            if (!item?.code || item.code === "null" || String(item.code).trim() === "") continue;
            const codeNorm = String(item.code).toLowerCase();
            if (existingCodes.has(codeNorm)) continue;

            existingCodes.add(codeNorm);
            newLineItems.push({
                article: item.code,
                descriptionRu: item.description || null,
                quantity: item.quantity != null ? Number(item.quantity) : null,
                unit: item.unit || "шт",
                brand: item.brand || null,
                source: "llm"
            });
            if (result.lead.articles) {
                result.lead.articles.push(item.code);
            } else {
                result.lead.articles = [item.code];
            }
        }
    }

    if (newLineItems.length > 0) {
        if (!result.lead.lineItems) result.lead.lineItems = [];
        result.lead.lineItems.push(...newLineItems);
        result.lead.totalPositions = (result.lead.lineItems || []).length || (result.lead.articles || []).length;
    }

    // --- Merge brands ---------------------------------------------------------
    if (Array.isArray(llmData.brands) && llmData.brands.length > 0) {
        const existingBrands = new Set(
            (result.detectedBrands || []).map((b) => b.toLowerCase())
        );
        const newBrands = llmData.brands.filter((b) => b && !existingBrands.has(b.toLowerCase()));
        if (newBrands.length > 0) {
            result.detectedBrands = [...(result.detectedBrands || []), ...newBrands];
            result.lead.detectedBrands = [...(result.lead.detectedBrands || []), ...newBrands];
        }
    }

    // --- Fill sender fields (gaps only) ---------------------------------------
    const sender = result.sender || {};
    if (!sender.sources) sender.sources = {};

    if (!sender.fullName && llmData.sender_name) {
        sender.fullName = llmData.sender_name;
        sender.sources.name = "llm";
    }
    if (!sender.cityPhone && !sender.mobilePhone && llmData.sender_phone) {
        const phone = llmData.sender_phone;
        // Classify as mobile (9XX) vs city
        const isMobile = /(?:\+7|8)[\s(.-]*9/.test(phone);
        if (isMobile) {
            sender.mobilePhone = phone;
        } else {
            sender.cityPhone = phone;
        }
        sender.sources.phone = "llm";
    }
    if (!sender.companyName && llmData.company_name) {
        sender.companyName = llmData.company_name;
        sender.sources.company = "llm";
    }
    if (!sender.inn && llmData.inn) {
        sender.inn = String(llmData.inn);
        sender.sources.inn = "llm";
    }
    if (!sender.kpp && llmData.kpp) {
        sender.kpp = String(llmData.kpp);
    }
    if (!sender.ogrn && llmData.ogrn) {
        sender.ogrn = String(llmData.ogrn);
    }
    result.sender = sender;

    // --- Reclassify "Не определено" using LLM request_type -------------------
    if (result.classification?.label === "Не определено" && llmData.request_type) {
        const rt = llmData.request_type;
        if (["quotation", "order", "info_request", "complaint"].includes(rt)) {
            result.classification.label = "Клиент";
            result.classification.llmReclassified = true;
            result.classification.llmRequestType = rt;
        } else if (rt === "vendor_offer") {
            result.classification.label = "Поставщик услуг";
            result.classification.llmReclassified = true;
            result.classification.llmRequestType = rt;
        }
    }

    // --- Attach LLM extraction metadata --------------------------------------
    const { model, logSuggestions } = cfg();
    result.llmExtraction = {
        processedAt: new Date().toISOString(),
        model,
        requestType: llmData.request_type || null,
        isUrgent: Boolean(llmData.is_urgent),
        missingForProcessing: Array.isArray(llmData.missing_for_processing) ? llmData.missing_for_processing : [],
        newArticlesAdded: newLineItems.length,
        detectionGapsCount: Array.isArray(llmData.detection_gaps) ? llmData.detection_gaps.length : 0
    };

    // --- Log detection gaps for system improvement ---------------------------
    if (logSuggestions && Array.isArray(llmData.detection_gaps) && llmData.detection_gaps.length > 0) {
        writeSuggestionsLog({
            at: new Date().toISOString(),
            messageKey,
            subject: result.rawInput?.subject || "",
            senderEmail: sender.email || "",
            classification: result.classification?.label || "",
            gaps: llmData.detection_gaps,
            newArticlesAdded: newLineItems.map((i) => i.article),
            newBrandsAdded: Array.isArray(llmData.brands) ? llmData.brands.filter((b) => !(result.detectedBrands || []).includes(b)) : []
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Build "rulesFound" summary to pass to LLM prompt
// ---------------------------------------------------------------------------

/**
 * Summarize what rules already found — passed to LLM so it can compute gaps.
 */
export function buildRulesFoundSummary(result) {
    return {
        articles: (result.lead?.articles || []).slice(0, 20),
        brands: (result.detectedBrands || []).slice(0, 15),
        sender_name: result.sender?.fullName || null,
        sender_email: result.sender?.email || null,
        sender_phone: result.sender?.mobilePhone || result.sender?.cityPhone || null,
        company_name: result.sender?.companyName || null,
        inn: result.sender?.inn || null,
        kpp: result.sender?.kpp || null,
        ogrn: result.sender?.ogrn || null,
        classification: result.classification?.label || null,
        is_auto_reply: result.extractionMeta?.autoReplyDetected || false
    };
}

// ---------------------------------------------------------------------------
// Suggestion log writer
// ---------------------------------------------------------------------------

function writeSuggestionsLog(entry) {
    try {
        appendFileSync(SUGGESTIONS_LOG, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
        console.warn("LLM suggestions log write error:", err.message);
    }
}
