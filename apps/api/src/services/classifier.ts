import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { config } from '../config.js';

export type ClassificationLabel = 'client' | 'spam' | 'vendor' | 'unknown';

export interface ClassificationResult {
  label: ClassificationLabel;
  confidence: number;
  source: 'rules' | 'llm' | 'hybrid';
  scores: Record<string, number>;
  matchedRules: MatchedRule[];
}

interface MatchedRule {
  ruleId: string;
  classifier: string;
  scope: string;
  pattern: string;
  weight: number;
}

// Ported from detection-kb.js
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'yandex.ru', 'ya.ru', 'hotmail.com', 'outlook.com',
]);

const LLM_CLASSIFICATION_PROMPT = `You are an email classification system for a B2B industrial equipment distributor.
Classify the following email into exactly one of these categories:
- "client": A potential or existing customer requesting products, prices, or quotation
- "spam": Marketing, newsletters, unsolicited offers, mass mailings
- "vendor": Suppliers, service providers, partnership proposals
- "unknown": Cannot determine with confidence

Respond with JSON only: { "label": "<category>", "confidence": <0.0-1.0>, "reasoning": "<brief>" }

Subject: {subject}
Body (first 2000 chars): {body}`;

export class Classifier {
  constructor(
    private prisma: PrismaClient,
    private log: Logger,
  ) {}

  async classify(
    emailId: string,
    content: { subject: string; bodyText: string },
  ): Promise<ClassificationResult> {
    // Load the email for sender info
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
      select: { senderEmail: true },
    });

    const senderEmail = email?.senderEmail ?? '';

    // Step 1: Rule-based scoring
    const ruleResult = await this.classifyByRules(content, senderEmail);

    // If rules produce high confidence, use them directly
    if (ruleResult.confidence >= 0.8) {
      this.log.debug({ emailId, label: ruleResult.label, confidence: ruleResult.confidence }, 'Rule-based classification (high confidence)');
      return { ...ruleResult, source: 'rules' };
    }

    // Step 2: Try LLM classification for uncertain cases
    if (config.LLM_API_URL && config.LLM_API_KEY) {
      try {
        const llmResult = await this.classifyByLlm(content);

        // Hybrid: combine rule and LLM scores
        if (ruleResult.label === llmResult.label) {
          // Agreement boosts confidence
          const combinedConfidence = Math.min(
            0.99,
            (ruleResult.confidence + llmResult.confidence) / 2 + 0.15,
          );
          return {
            label: ruleResult.label,
            confidence: combinedConfidence,
            source: 'hybrid',
            scores: ruleResult.scores,
            matchedRules: ruleResult.matchedRules,
          };
        }

        // Disagreement: prefer whichever has higher confidence
        if (llmResult.confidence > ruleResult.confidence + 0.1) {
          return {
            label: llmResult.label,
            confidence: llmResult.confidence,
            source: 'llm',
            scores: ruleResult.scores,
            matchedRules: ruleResult.matchedRules,
          };
        }

        return { ...ruleResult, source: 'hybrid' };
      } catch (err) {
        this.log.warn({ err, emailId }, 'LLM classification failed, falling back to rules');
      }
    }

    return { ...ruleResult, source: 'rules' };
  }

  /**
   * Rule-based classification ported from detection-kb.js
   */
  private async classifyByRules(
    content: { subject: string; bodyText: string },
    senderEmail: string,
  ): Promise<Omit<ClassificationResult, 'source'>> {
    const rules = await this.prisma.templateRule.findMany({
      where: { isActive: true },
    });

    const scopes: Record<string, string> = {
      subject: content.subject.toLowerCase(),
      body: content.bodyText.toLowerCase(),
      domain: senderEmail.split('@')[1]?.toLowerCase() ?? '',
      all: [content.subject, content.bodyText, senderEmail].join('\n').toLowerCase(),
    };

    const scores: Record<string, number> = { client: 0, spam: 0, vendor: 0 };
    const matchedRules: MatchedRule[] = [];

    for (const rule of rules) {
      const haystack = scopes[rule.scope] ?? scopes.all;
      if (this.isRuleMatch(rule.matchType, rule.pattern, haystack)) {
        scores[rule.classifier] = (scores[rule.classifier] ?? 0) + rule.weight;
        matchedRules.push({
          ruleId: rule.id,
          classifier: rule.classifier,
          scope: rule.scope,
          pattern: rule.pattern,
          weight: rule.weight,
        });
      }
    }

    // Sender profile matching
    const senderProfiles = await this.prisma.senderProfile.findMany({
      where: { isActive: true },
    });
    const domain = senderEmail.split('@')[1]?.toLowerCase() ?? '';

    for (const profile of senderProfiles) {
      const byEmail = profile.senderEmail?.toLowerCase() === senderEmail.toLowerCase();
      const byDomain = profile.senderDomain?.toLowerCase() === domain;
      if (byEmail || byDomain) {
        scores[profile.classification] = (scores[profile.classification] ?? 0) + 6;
        matchedRules.push({
          ruleId: `sender:${profile.id}`,
          classifier: profile.classification,
          scope: byEmail ? 'sender_email' : 'sender_domain',
          pattern: profile.senderEmail || profile.senderDomain || '',
          weight: 6,
        });
      }
    }

    // Non-free domain bonus
    if (senderEmail && !FREE_EMAIL_DOMAINS.has(domain)) {
      scores.client = (scores.client ?? 0) + 1;
    }

    const label = this.decideLabel(scores);
    const topScore = Math.max(scores.client ?? 0, scores.spam ?? 0, scores.vendor ?? 0, 0);
    const totalScore = (scores.client ?? 0) + (scores.spam ?? 0) + (scores.vendor ?? 0);
    const confidence =
      topScore === 0
        ? 0.35
        : Math.min(0.99, 0.45 + (topScore / Math.max(totalScore, 1)) * 0.5);

    return {
      label,
      confidence: Number(confidence.toFixed(2)),
      scores,
      matchedRules: matchedRules.slice(0, 12),
    };
  }

  private decideLabel(scores: Record<string, number>): ClassificationLabel {
    const entries = [
      { label: 'client' as const, score: scores.client ?? 0 },
      { label: 'spam' as const, score: scores.spam ?? 0 },
      { label: 'vendor' as const, score: scores.vendor ?? 0 },
    ].sort((a, b) => b.score - a.score);

    if (!entries[0] || entries[0].score <= 0) return 'unknown';
    if (entries[0].score === entries[1]?.score && entries[0].score < 4) return 'unknown';
    return entries[0].label;
  }

  private isRuleMatch(matchType: string, pattern: string, haystack: string): boolean {
    if (!haystack) return false;

    switch (matchType) {
      case 'contains':
        return haystack.includes(pattern.toLowerCase());
      case 'exact':
        return haystack.trim() === pattern.toLowerCase().trim();
      case 'regex':
        try {
          return new RegExp(pattern, 'iu').test(haystack);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  /**
   * LLM-based classification for ambiguous cases.
   */
  private async classifyByLlm(content: {
    subject: string;
    bodyText: string;
  }): Promise<{ label: ClassificationLabel; confidence: number }> {
    const prompt = LLM_CLASSIFICATION_PROMPT
      .replace('{subject}', content.subject)
      .replace('{body}', content.bodyText.slice(0, 2000));

    const response = await fetch(config.LLM_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty LLM response');

    const parsed = JSON.parse(text);
    const validLabels: ClassificationLabel[] = ['client', 'spam', 'vendor', 'unknown'];
    const label = validLabels.includes(parsed.label) ? parsed.label : 'unknown';
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));

    return { label, confidence };
  }
}
