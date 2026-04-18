/**
 * Optional AI-powered email classification using Claude API.
 * Activated by AI_ENABLED=true + AI_API_KEY env vars.
 * Falls back to rule-based classification on failure.
 */

const AI_ENABLED = process.env.AI_ENABLED === "true";
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-4-20250514";
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.anthropic.com";
const AI_CONFIDENCE_THRESHOLD = Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.75);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 15000);

const CLASSIFICATION_PROMPT = `Ты — классификатор входящих писем для B2B дистрибьютора промышленного оборудования (Siderus / Коловрат). Распредели письмо РОВНО в одну из четырёх категорий.

КАТЕГОРИИ:
• "Клиент" — внешний покупатель просит цену / КП / счёт / прайс / техспецификации / аналоги на промышленное оборудование, либо размещает заказ. Обычно: русскоязычный текст, обращение по делу, артикулы или описание позиций, упоминание сроков/тендера/объекта.
• "СПАМ" — массовая маркетинговая рассылка, вебинар, новостной дайджест, «подпишитесь», «узнайте первым», рекламная англоязычная рассылка из .cn/.in/.pk, промо-акции, нерелевантная реклама, письма без конкретного запроса к нам.
• "Поставщик услуг" — компания предлагает СВОИ услуги/товары/партнёрство (логистика, сертификация, аутсорсинг ВЭД, рассылка завода-производителя «please find our catalog»), предложение сотрудничества, резюме кандидатов, ищут дилеров/представителей.
• "Не определено" — автоответ / отбивка / доставки / уведомление о недоставке / out-of-office / служебное уведомление / пустое письмо / непонятный технический шум, внутренняя корреспонденция без запроса.

ПРИОРИТЕТЫ (при конфликте сигналов — сверху вниз):
1) Служебное письмо (автоответ, «сообщение не доставлено», OOO, Bitrix "invited to Siderus", Outlook test message) → "Не определено".
2) Отправитель предлагает СВОИ товары/услуги → "Поставщик услуг". Сюда же: банк с предложением ВЭД/валютного контроля/SWIFT; китайский/индийский vendor на английском («we are a supplier of», «manufacturer of»); длинный перечень 5+ брендов через запятую без артикулов («мы поставим IFM, SICK, E+H, Festo…»); логистика/таможня/типография/металлопрокат/выставочный стенд.
3) Рассылка, реклама, webinar, newsletter, «конференция», «форум», «регистрация по ссылке», «принять участие в выставке», «ДНС Гипер», «закрой долги», «стабильная доходность», «ChatGPT Plus Payment Error», DGA-домен → "СПАМ".
4) Конкретный запрос цены / заказа / уточнения по позиции → "Клиент". Сюда же тендеры: «открытый запрос предложений», «процедура №», «поставка для ООО X в 2026», «согласно ТЗ».
5) Пересылка (Fwd/Fw): классифицируй по ОРИГИНАЛУ внутри цитаты, не по заголовку пересылающего (если верхний header от info@siderus.ru/robot@siderus.ru — внутри переадресованное клиентское письмо).
6) Короткий ответ «Карточка/реквизиты во вложении» = "Клиент" (продолжение активной сделки).

detected_brands — только реальные промышленные бренды (ABB, Siemens, Schneider, Endress+Hauser, Festo, Danfoss, WAGO, Phoenix Contact и т.п.). НЕ бренды: общие слова (power, safety, control, smart, ultra), типы оборудования (датчик, клапан, кабель), домены, «Siderus»/«Коловрат» (это мы сами).

confidence:
• ≥0.90 — явные однозначные сигналы (реквизиты+артикулы+«прошу КП» → Клиент 0.95; «please find attached catalog» → Поставщик 0.92).
• 0.75–0.89 — основные сигналы есть, мелкая неоднозначность.
• 0.60–0.74 — сигналы частично противоречивые, но одна категория явно ведёт.
• <0.60 — сигналы слабые, ставь "Не определено".

ФОРМАТ ОТВЕТА: ТОЛЬКО валидный JSON без markdown, без пояснений. Первый символ «{», последний «}».
{"label":"Клиент|СПАМ|Поставщик услуг|Не определено","confidence":0.0-1.0,"detected_brands":["..."],"reasoning":"одна короткая фраза на русском с ключевым сигналом"}

=== ПРИМЕРЫ ===

Пример 1 → Клиент (0.95):
Вход: "Прошу КП на Siemens 6ES7214-1AG40-0XB0 — 3 шт. ООО «Прибор», ИНН 7712345678, +7(495)111-22-33"
Выход: {"label":"Клиент","confidence":0.95,"detected_brands":["Siemens"],"reasoning":"Запрос КП с артикулом, количеством и реквизитами клиента"}

Пример 2 → Поставщик услуг (0.90):
Вход: "Dear Sir, we are a Chinese manufacturer of LED explosion-proof lights with ATEX certification. Please find our catalog attached."
Выход: {"label":"Поставщик услуг","confidence":0.90,"detected_brands":[],"reasoning":"Завод предлагает свой каталог продукции (vendor outreach)"}

Пример 3 → СПАМ (0.92):
Вход: "Приглашаем на бесплатный вебинар: как выбрать частотник. Регистрация по ссылке. Узнайте первым о новинках!"
Выход: {"label":"СПАМ","confidence":0.92,"detected_brands":[],"reasoning":"Массовая маркетинговая рассылка с приглашением на вебинар"}

Пример 4 → Не определено (0.85):
Вход: "Я в отпуске до 25.04. По срочным вопросам обращайтесь к коллеге."
Выход: {"label":"Не определено","confidence":0.85,"detected_brands":[],"reasoning":"Автоответ об отпуске без предметного содержания"}

Пример 5 → Клиент (0.88):
Вход: "Добрый день! Подскажите аналог датчика давления E+H PMC71-AAD1H2GBAA. Срочно, оборудование встало."
Выход: {"label":"Клиент","confidence":0.88,"detected_brands":["Endress+Hauser"],"reasoning":"Запрос аналога конкретного артикула с пометкой срочности"}

Пример 6 → Не определено (0.80):
Вход: "Сообщение не доставлено получателю info@example.com. Mail Delivery Subsystem."
Выход: {"label":"Не определено","confidence":0.80,"detected_brands":[],"reasoning":"Служебное уведомление о недоставке почты"}`;

export function isAiEnabled() {
  return AI_ENABLED && AI_API_KEY.length > 0;
}

export function getAiConfig() {
  return {
    enabled: isAiEnabled(),
    model: AI_MODEL,
    confidenceThreshold: AI_CONFIDENCE_THRESHOLD
  };
}

/**
 * Classify email using AI if rules-based confidence is below threshold.
 * Returns enhanced classification or null if AI is disabled/fails.
 */
export async function aiClassify({ subject, body, fromEmail, attachments = [] }) {
  if (!isAiEnabled()) return null;

  const emailContent = [
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    `Attachments: ${attachments.join(", ") || "none"}`,
    "",
    body.slice(0, 3000) // Limit body to save tokens
  ].join("\n");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const response = await fetch(`${AI_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AI_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `${CLASSIFICATION_PROMPT}\n\n---\n${emailContent}`
          }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`AI classification HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate response
    const validLabels = ["Клиент", "СПАМ", "Поставщик услуг", "Не определено"];
    if (!validLabels.includes(parsed.label)) return null;

    return {
      label: parsed.label,
      confidence: Math.min(0.99, Math.max(0, Number(parsed.confidence) || 0.5)),
      detectedBrands: Array.isArray(parsed.detected_brands) ? parsed.detected_brands : [],
      reasoning: String(parsed.reasoning || ""),
      source: "ai"
    };
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn("AI classification timed out");
    } else {
      console.warn("AI classification error:", error.message);
    }
    return null;
  }
}

/**
 * Hybrid classification: use rules first, fallback to AI for uncertain cases.
 * @param {object} rulesResult - Result from detection-kb classifyMessage
 * @param {object} emailData - { subject, body, fromEmail, attachments }
 * @returns {object} Enhanced classification
 */
export async function hybridClassify(rulesResult, emailData) {
  if (!isAiEnabled()) {
    return { ...rulesResult, source: "rules" };
  }

  // If rules are confident enough, use them directly
  if (rulesResult.confidence >= AI_CONFIDENCE_THRESHOLD) {
    return { ...rulesResult, source: "rules" };
  }

  // Try AI for low-confidence cases
  const aiResult = await aiClassify(emailData);
  if (!aiResult) {
    return { ...rulesResult, source: "rules" };
  }

  // If both agree, boost confidence
  if (rulesResult.label === aiResult.label) {
    return {
      ...rulesResult,
      confidence: Math.min(0.99, (rulesResult.confidence + aiResult.confidence) / 2 + 0.15),
      detectedBrands: [...new Set([...rulesResult.detectedBrands, ...aiResult.detectedBrands])],
      source: "hybrid",
      aiReasoning: aiResult.reasoning
    };
  }

  // If they disagree, pick the more confident one
  if (aiResult.confidence > rulesResult.confidence + 0.1) {
    return {
      label: aiResult.label,
      confidence: aiResult.confidence,
      scores: rulesResult.scores,
      matchedRules: rulesResult.matchedRules,
      detectedBrands: [...new Set([...rulesResult.detectedBrands, ...aiResult.detectedBrands])],
      source: "ai",
      aiReasoning: aiResult.reasoning
    };
  }

  return { ...rulesResult, source: "rules", aiReasoning: aiResult.reasoning };
}
