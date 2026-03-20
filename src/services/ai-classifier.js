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

const CLASSIFICATION_PROMPT = `You are an email classification system for a B2B industrial equipment distributor (Siderus/Коловрат).
Classify the following email into exactly one category:

- "Клиент" — A customer requesting products, prices, quotation, commercial proposal, or technical specifications
- "СПАМ" — Marketing, newsletters, unsolicited offers, mass mailings, promotions
- "Поставщик услуг" — Suppliers, service providers, partnership or cooperation proposals

Also extract:
- detected_brands: array of industrial brand names mentioned (ABB, Siemens, Endress+Hauser, etc.)
- confidence: 0.0-1.0 how confident you are
- reasoning: brief 1-sentence explanation

Respond with JSON only:
{"label":"<category>","confidence":<0.0-1.0>,"detected_brands":["Brand1"],"reasoning":"<brief>"}`;

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
    const validLabels = ["Клиент", "СПАМ", "Поставщик услуг"];
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
