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
import { writeLlmCache } from "./llm-cache.js";

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

const SYSTEM_PROMPT = `Ты — экстрактор структурированных данных для B2B дистрибьютора промышленного оборудования (Siderus/Коловрат). Работаешь с русскоязычной деловой перепиской: запросы КП, заказы, техзадания, реквизиты.

ДОМЕН. Что считается «оборудованием»: приборы КИПиА (датчики, контроллеры, регуляторы), электроника (частотные преобразователи, реле, УЗО), механика (подшипники, редукторы, муфты), трубопроводная арматура (клапаны, задвижки, краны), кабельная продукция (силовые/контрольные кабели, провода), электрооборудование (двигатели, щиты, автоматика), запчасти и расходники промышленного назначения.

ПОДХОД:
1) Сначала мысленно ответь на 3 вопроса — кто написал (клиент/поставщик/робот), чего хочет (запрос/заказ/коммерческое предложение/рассылка), какие позиции упомянуты.
2) Потом верни JSON строго по схеме без дополнительных полей.
3) Для каждого поля: если НЕ уверен — верни null, не выдумывай.

ФОРМАТ ОТВЕТА: только валидный JSON. Никакого markdown, никакого кода, никаких пояснений, никаких комментариев. Первый символ — «{», последний — «}».`;

const buildUserPrompt = (emailText, rulesFound) => `Письмо:
---
${emailText}
---

Что уже нашли правила (не включай это в detection_gaps):
${JSON.stringify(rulesFound, null, 2)}

Верни ровно такой JSON (все поля обязательны; если данных нет — null или []):
{
  "articles": [
    {
      "code": "строка, никогда не null",
      "brand": "бренд позиции или null",
      "description": "название/описание позиции или null",
      "quantity": число или null,
      "unit": "шт|м|кг|л|компл|пара|рул|уп или null"
    }
  ],
  "brands": ["реальные промышленные бренды из письма"],
  "sender_name": "ФИО контакта или null",
  "sender_email": "email контакта или null",
  "sender_phone": "телефон как в письме или null",
  "company_name": "компания-отправитель с правовой формой или null",
  "inn": "ИНН 10 или 12 цифр или null",
  "kpp": "КПП 9 цифр или null",
  "ogrn": "ОГРН 13-15 цифр или null",
  "request_type": "quotation|order|info_request|complaint|vendor_offer|other",
  "is_urgent": true | false,
  "missing_for_processing": ["article"|"brand"|"quantity"|"contact_name"|"company"|"inn"],
  "detection_gaps": [
    {"type":"article|brand|phone|company|inn|name|quantity|unit","value":"...","context":"цитата ≤80 символов","suggestion":"regex или правило"}
  ]
}

=== ПРИОРИТЕТНАЯ ИЕРАРХИЯ (при конфликте сигналов — сверху вниз) ===
A. Пересылка (Fwd/Fw/Fwd:/Forwarded): извлекай данные из ОРИГИНАЛА внутри цитирования, не из заголовка пересылающего.
B. Автоответы / отбивки / доставки / out-of-office / «Сообщение не доставлено»: request_type="other", articles=[], brands=[], company=null, name=null. НЕ извлекай ничего из служебных писем.
C. Рекламные рассылки / вебинары / «подпишитесь» / «узнайте первым»: request_type="other", articles=[], brands=[].
D. Карточка контрагента / реквизиты без запроса товара: заполни только sender_*/company/inn/kpp/ogrn; articles=[], brands=[], request_type="info_request".
E. Реальный запрос с позициями: заполняй всё.

=== ЖЁСТКИЕ ПРАВИЛА ===
R1. articles[].code — СТРОКА, никогда null/пустая. Если код не ясен, но позиция явно упомянута — используй code="DESC:<транслит-латиницей-через-дефис-до-40-символов>" (пример: "DESC:sharovoy-kran-DN50-PN16"). Если позиции вообще нет — не включай запись.
R2. НЕ артикулы: номера счетов (Счёт № …), ИНН/ОГРН/КПП, номера заявок/тикетов (REQ-…, TK-…, JSW-…), трек-номера, банковские реквизиты, номера договоров, коды ЭДО (Диадок), номера телефонов и их фрагменты, номера пунктов списка (1.3.1, POS.12), единицы/параметры (380V, 75A, 100-240V, DN 65), случайные токены без прикладного смысла (4TUU4U, VY1TTJ).
R3. Кабели и провода: марка кабеля (ПВ1, КВВГ, ВВГнг, ВВГ, КГтп, РК-75) — это code. Каждое сечение — отдельный article с description, содержащим сечение (пример: code="ПВ1", description="ПВ1 1×2.5", unit="м").
R4. brands — ТОЛЬКО реальные промышленные бренды (Siemens, Festo, Endress+Hauser, ABB, Schneider, Danfoss, Phoenix Contact, WAGO, Пневмакс и т.п.). НЕ бренд: названия типов оборудования («ball valves», «автоматика», «кабель», «датчик»), общие прилагательные («power», «safety», «control», «smart»), домены, торговые марки Siderus/Коловрат (это мы сами).
R5. company_name — ТОЛЬКО компания-ОТПРАВИТЕЛЬ. Источники (в порядке надёжности): правовая форма в подписи → юр. адрес в подписи → email-домен → текст письма «от лица». НЕ бери название бренда продукта как компанию клиента (запрос на «Festo» → company_name ≠ "Festo GmbH"). НЕ Siderus/Коловрат.
R6. inn — 10 или 12 цифр, ТОЛЬКО при явной метке «ИНН». Казахский БИН/BIN — это не ИНН, верни null. Номера договоров/счетов похожей длины — не ИНН.
R7. sender_phone — как в письме (+7 (495) 123-45-67 оставь как есть), не нормализуй. Если несколько — бери личный (мобильный/прямой) из подписи, не корпоративный.
R8. sender_name — ФИО контакта из подписи, «С уважением», блока reply-from; не из local-part email если в теле есть живое имя. Игнорируй «info», «sales», «robot», «admin», «no-reply».
R9. request_type:
    • quotation — просят цену/КП/счёт/прайс на конкретный товар;
    • order — просят поставить/отгрузить/заказать с готовым списком;
    • info_request — уточняющий вопрос, аналоги, совместимость, срок поставки без конкретного заказа;
    • complaint — рекламация/возврат/брак;
    • vendor_offer — предлагают СВОИ услуги/товары (партнёрство, рассылка от завода, услуги логистики);
    • other — автоответ/спам/нерелевантно/пустое письмо.
R10. is_urgent=true только при явных маркерах: «срочно», «ASAP», «до конца дня», «максимально быстро», «тендер истекает», «оборудование встало». Длинный список без дедлайна — не urgent.
R11. detection_gaps — ТОЛЬКО то, что нашёл LLM и чего НЕТ в rulesFound. Не дублируй найденное правилами. Не пиши gaps для реально отсутствующих полей (если в письме нет КПП — это не gap). Suggestion должен быть конкретным regex или правилом, не общим советом.
R12. missing_for_processing — что реально нужно для обработки ИМЕННО этого письма как клиентской заявки. Для vendor_offer/other верни [].
R13. Банк/финструктура предлагает услуги ВЭД / валютного контроля / импортных расчётов / SWIFT → request_type="vendor_offer". company_name = банк-отправитель (Первоуральскбанк, Альфа-Банк и т.п.), НЕ ООО «КОЛОВРАТ»/«Siderus» из тела. articles=[], brands=[].
R14. Длинный перечень известных промбрендов через запятую БЕЗ артикулов и количеств («мы поставим / работаем с / наш ассортимент: IFM, SICK, E+H, PILZ, SEW, SMC, Siemens, Festo, ABB...») = каталог поставщика. brands=[] (это не запрос клиента), request_type="vendor_offer".
R15. Короткий ответ «Карточка/реквизиты во вложении», «Реквизиты для оплаты», «Данные компании» без нового запроса товара → request_type="info_request" (продолжение активной сделки). Извлекай company/INN/phone/sender_name из подписи и вложения, но articles=[], brands=[].
R16. Fwd:/FW:/Пересылаемое сообщение — извлекай company/sender_name/inn/phone/brands/articles из ОРИГИНАЛА внутри цитаты, а не из forwarder-заголовка. Если верхний header от info@siderus.ru/robot@siderus.ru, а внутри внешний отправитель — это переадресация клиентского письма, берём данные из оригинала.
R17. Различай приглашение на мероприятие vs тендер:
    • Тендер (request_type="quotation", извлекай brand/article из ТЗ): маркеры «открытый запрос предложений», «процедура №», «согласно ТЗ», «поставка ... для ООО X в 2026», «направить предложение».
    • СПАМ-рассылка (request_type="other", articles=[], brands=[]): маркеры «конференция», «форум», «вебинар», «регистрация по ссылке», «программа мероприятия», «спикеры», «докладов».

=== ПРИМЕРЫ ===

Пример 1 — клиент с артикулами:
Вход: "Добрый день, нужно КП на ABB ACS580-01-09A5-4 — 2 шт. и Schneider ATV320U15N4B — 1 шт. Срок до пятницы. С уважением, Иван Петров, ООО «Механика», ИНН 7712345678, +7 (495) 111-22-33"
Выход (фрагмент):
{"articles":[{"code":"ACS580-01-09A5-4","brand":"ABB","description":"ABB ACS580-01-09A5-4","quantity":2,"unit":"шт"},{"code":"ATV320U15N4B","brand":"Schneider","description":"Schneider ATV320U15N4B","quantity":1,"unit":"шт"}],"brands":["ABB","Schneider"],"sender_name":"Иван Петров","sender_phone":"+7 (495) 111-22-33","company_name":"ООО «Механика»","inn":"7712345678","request_type":"quotation","is_urgent":true,"missing_for_processing":[]}

Пример 2 — описательная позиция без артикула:
Вход: "Нужны шаровые краны DN50 PN16 из нерж. стали — 5 штук"
Выход (articles фрагмент): [{"code":"DESC:sharovoy-kran-DN50-PN16","brand":null,"description":"Шаровой кран DN50 PN16 нержавеющая сталь","quantity":5,"unit":"шт"}]

Пример 3 — рассылка завода (vendor_offer):
Вход: "Dear partner, we are a manufacturer of explosion-proof LED lights with ATEX certification. Please find our catalog attached. Power options from 20W to 380W."
Выход: {"articles":[],"brands":[],"sender_name":null,"company_name":null,"request_type":"vendor_offer","is_urgent":false,"missing_for_processing":[],"detection_gaps":[]}

Пример 4 — автоответ:
Вход: "Письмо получено. Отвечу после 25.04. Менеджер Сидорова."
Выход: {"articles":[],"brands":[],"sender_name":null,"company_name":null,"request_type":"other","is_urgent":false,"missing_for_processing":[],"detection_gaps":[]}

Пример 5 — кабели:
Вход: "Прошу цену: ПВ3 1×1.5 — 200м, ПВ3 1×2.5 — 150м, КВВГ 5×1.5 — 80м"
Выход (articles): [{"code":"ПВ3","description":"ПВ3 1×1.5","quantity":200,"unit":"м","brand":null},{"code":"ПВ3","description":"ПВ3 1×2.5","quantity":150,"unit":"м","brand":null},{"code":"КВВГ","description":"КВВГ 5×1.5","quantity":80,"unit":"м","brand":null}]

Пример 6 — банк предлагает ВЭД (vendor_offer, R13):
Вход: "Меня Лариса зовут, представляю подразделение ВЭД Первоуральскбанка. Пишу с предложением о сотрудничестве в части расчетов по импортным контрактам в иностранной валюте для ООО «КОЛОВРАТ». Банк не включен в списки санкций."
Выход: {"articles":[],"brands":[],"sender_name":"Лариса","company_name":"АО «Первоуральскбанк»","inn":null,"request_type":"vendor_offer","is_urgent":false,"missing_for_processing":[]}

Пример 7 — китайский поставщик с перечнем брендов (R14):
Вход: "Наша компания Huizhou Token Trading осуществляет поставки в Россию. Мы поставим IFM, SICK, E+H, PILZ, SEW, SMC, Siemens, Festo, ABB, Schneider. Оптимальные цены и сроки."
Выход: {"articles":[],"brands":[],"sender_name":"Антон","company_name":"Huizhou Token Trading Co., Ltd","inn":null,"request_type":"vendor_offer","is_urgent":false,"missing_for_processing":[]}

Пример 8 — реквизиты по активной сделке (R15, info_request):
Вход: "Re: ZGA05MV005 Тормоз двигателя. Добрый день. Карточка предприятия во вложении. С уважением, Dmitri Iusupov, Plant Manager, OOO Serioplast."
Выход: {"articles":[],"brands":[],"sender_name":"Dmitri Iusupov","company_name":"OOO Serioplast","inn":null,"request_type":"info_request","is_urgent":false,"missing_for_processing":[]}

Пример 9 — тендер, не СПАМ (R17):
Вход: "ООО «УК ВОЛМА» объявляет открытый запрос предложений на поставку электродвигателей PERSKE на торцеватель ГКЛ для ВОЛМА-Воскресенск в 2026 году. Просим направить предложение согласно ТЗ."
Выход: {"articles":[{"code":"DESC:elektrodvigatel-PERSKE-dlya-tortsevatelya-GKL","brand":"PERSKE","description":"Электродвигатель PERSKE на торцеватель ГКЛ","quantity":null,"unit":"шт"}],"brands":["PERSKE"],"company_name":"ООО «УК ВОЛМА»","request_type":"quotation","is_urgent":false,"missing_for_processing":["quantity"]}

Пример 10 — рассылка про форум (СПАМ, R17):
Вход: "Программа онлайн-форума по инженерному оборудованию ЖК. 18-20 марта, 57 докладов, пять заседаний. НП АВОК приглашает вас. Регистрация по ссылке."
Выход: {"articles":[],"brands":[],"sender_name":null,"company_name":null,"request_type":"other","is_urgent":false,"missing_for_processing":[],"detection_gaps":[]}

=== SELF-CHECK ПЕРЕД ОТВЕТОМ ===
✓ Каждый articles[].code — непустая строка?
✓ В brands нет «типов оборудования», доменов, общих слов, своих брендов?
✓ company_name — это отправитель, а не бренд продукта?
✓ Для автоответа/спама/рассылки все списки пустые и request_type=other?
✓ ИНН 10 или 12 цифр и явно помечен как ИНН?
✓ detection_gaps содержит только то, чего нет в rulesFound?
✓ JSON валиден (запятые, кавычки, скобки)?`;

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

    // --- Reclassify using LLM request_type -----------------------------------
    if (llmData.request_type) {
        const rt = llmData.request_type;
        const label = result.classification?.label;

        if (label === "Не определено") {
            // Upgrade: unknown → client/vendor
            if (["quotation", "order", "info_request", "complaint"].includes(rt)) {
                result.classification.label = "Клиент";
                result.classification.llmReclassified = true;
                result.classification.llmRequestType = rt;
            } else if (rt === "vendor_offer") {
                result.classification.label = "Поставщик услуг";
                result.classification.llmReclassified = true;
                result.classification.llmRequestType = rt;
            }
        } else if (rt === "other" && (label === "Клиент" || label === "Поставщик услуг")) {
            // Downgrade: LLM says this is not a real request → "Не определено" (review)
            result.classification.label = "Не определено";
            result.classification.llmRequestType = rt;
            result.classification.llmDowngraded = true;
            result.classification.needsReview = true;
        } else if (rt === "vendor_offer" && label === "Клиент") {
            // Misclassified vendor outreach → flip to supplier
            result.classification.label = "Поставщик услуг";
            result.classification.llmRequestType = rt;
            result.classification.llmReclassified = true;
        }
    }

    // --- Compute missing_for_processing (filter already-found fields) --------
    const rawMissing = Array.isArray(llmData.missing_for_processing) ? llmData.missing_for_processing : [];
    const hasArticles = (result.lead?.articles || []).length > 0;
    const hasBrands = (result.detectedBrands || []).length > 0;
    const hasName = Boolean(result.sender?.fullName);
    const hasCompany = Boolean(result.sender?.companyName);
    const hasInn = Boolean(result.sender?.inn);
    const hasQty = (result.lead?.lineItems || []).some((i) => i.quantity != null);
    const filteredMissing = rawMissing.filter((f) => {
        if (f === "article") return !hasArticles;
        if (f === "brand") return !hasBrands;
        if (f === "contact_name") return !hasName;
        if (f === "company") return !hasCompany;
        if (f === "inn") return !hasInn;
        if (f === "quantity") return !hasQty;
        return true; // kpp, ogrn, phone — keep as-is
    });

    // --- Attach LLM extraction metadata --------------------------------------
    const { model, logSuggestions } = cfg();
    result.llmExtraction = {
        processedAt: new Date().toISOString(),
        model,
        requestType: llmData.request_type || null,
        isUrgent: Boolean(llmData.is_urgent),
        missingForProcessing: filteredMissing,
        newArticlesAdded: newLineItems.length,
        detectionGapsCount: Array.isArray(llmData.detection_gaps) ? llmData.detection_gaps.length : 0
    };

    // --- Persist LLM result to durable cache (survives reanalysis) -----------
    writeLlmCache(messageKey, {
        processedAt: result.llmExtraction.processedAt,
        model,
        subject: result.rawInput?.subject || "",
        fromEmail: sender.email || "",
        classification: result.classification?.label || "",
        requestType: result.llmExtraction.requestType,
        isUrgent: result.llmExtraction.isUrgent,
        missingForProcessing: result.llmExtraction.missingForProcessing,
        articles: (result.lead?.articles || []).slice(),
        brands: (result.detectedBrands || []).slice(),
        contact: { name: result.lead?.contactName || null, company: result.lead?.companyName || null, phone: result.lead?.phone || null, inn: result.lead?.inn || null },
        newArticlesAdded: result.llmExtraction.newArticlesAdded,
        detectionGaps: Array.isArray(llmData.detection_gaps) ? llmData.detection_gaps : []
    });

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
        articles: (result.lead?.articles || []).slice(0, 50),
        brands: (result.detectedBrands || []).slice(0, 30),
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
