import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { config } from '../config.js';

export interface ExtractedEntities {
  sender: SenderInfo;
  contacts: ContactInfo;
  articles: ArticleInfo[];
  signature: SignatureInfo | null;
  confidence: number;
}

export interface SenderInfo {
  email: string;
  fullName: string | null;
  position: string | null;
  companyName: string | null;
}

export interface ContactInfo {
  phones: string[];
  cityPhone: string | null;
  mobilePhone: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  website: string | null;
}

export interface ArticleInfo {
  code: string;
  quantity: number | null;
  unit: string;
  brand: string | null;
  description: string | null;
}

export interface SignatureInfo {
  fullName: string | null;
  position: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
}

// Regex patterns ported from email-analyzer.js
const PHONE_PATTERN = /(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
const INN_PATTERN = /(?:ИНН|inn)[^0-9]{0,5}(\d{10,12})/i;
const KPP_PATTERN = /(?:КПП|kpp)[^0-9]{0,5}(\d{9})/i;
const OGRN_PATTERN = /(?:ОГРН|ogrn)[^0-9]{0,5}(\d{13,15})/i;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const ARTICLE_PATTERN = /(?:арт(?:икул)?|sku|код)[^A-Za-zА-Яа-я0-9]{0,5}([A-Za-zА-Яа-я0-9\-/_]+)/gi;

const COMPANY_PATTERNS = [
  /(ООО\s+["«][^"»]+["»])/iu,
  /(АО\s+["«][^"»]+["»])/iu,
  /(ЗАО\s+["«][^"»]+["»])/iu,
  /(ПАО\s+["«][^"»]+["»])/iu,
  /(ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/iu,
];

const POSITION_PATTERNS = [
  /генеральный\s+директор/iu,
  /коммерческий\s+директор/iu,
  /менеджер\s+по\s+закупкам/iu,
  /менеджер\s+по\s+продажам/iu,
  /начальник\s+отдела/iu,
  /главный\s+инженер/iu,
  /менеджер/iu,
  /инженер/iu,
  /директор/iu,
];

const SIGNATURE_PATTERN =
  /(?:с\s+уважением|best\s+regards|спасибо|regards)[,\s]*\n+([\s\S]{10,300}?)(?:\n\n|\n-{2,}|$)/iu;

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'yandex.ru', 'ya.ru', 'hotmail.com', 'outlook.com',
]);

const LLM_EXTRACTION_PROMPT = `Extract structured data from this email body. Return JSON only:
{
  "companyName": "<legal entity name or null>",
  "contactName": "<full name or null>",
  "position": "<job title or null>",
  "inn": "<INN digits or null>",
  "articles": [{ "code": "...", "quantity": <number|null>, "brand": "<brand|null>" }],
  "phones": ["<phone>"]
}

Email body (first 3000 chars):
{body}`;

export class EntityExtractor {
  constructor(
    private prisma: PrismaClient,
    private log: Logger,
  ) {}

  async extract(
    emailId: string,
    content: { subject: string; bodyText: string },
  ): Promise<ExtractedEntities> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
      select: {
        senderEmail: true,
        senderName: true,
      },
    });

    const senderEmail = email?.senderEmail ?? '';
    const senderName = email?.senderName ?? '';

    const sender = this.extractSender(senderName, senderEmail, content.bodyText);
    const contacts = this.extractContacts(content.bodyText);
    const articles = this.extractArticles(content.bodyText);
    const signature = this.extractFromSignature(content.bodyText);

    // Try LLM extraction for richer results when available
    let llmEntities: Partial<ExtractedEntities> | null = null;
    if (config.LLM_API_URL && config.LLM_API_KEY) {
      try {
        llmEntities = await this.extractWithLlm(content.bodyText);
      } catch (err) {
        this.log.warn({ err, emailId }, 'LLM entity extraction failed');
      }
    }

    // Merge regex and LLM results (regex takes precedence for structured fields)
    const merged = this.mergeResults(
      { sender, contacts, articles, signature },
      llmEntities,
    );

    // Calculate overall confidence
    const confidence = this.calculateConfidence(merged);

    return { ...merged, confidence };
  }

  extractSender(
    fromName: string,
    fromEmail: string,
    body: string,
  ): SenderInfo {
    const companyName =
      this.extractCompanyName(body) ?? this.inferCompanyFromDomain(fromEmail);
    const fullName = fromName || this.extractNameFromSignature(body) || null;
    const position = this.extractPosition(body);

    return { email: fromEmail, fullName, position, companyName };
  }

  extractContacts(body: string): ContactInfo {
    const phones = body.match(PHONE_PATTERN) ?? [];
    const uniquePhones = [...new Set(phones.map((p) => p.replace(/\s+/g, ' ').trim()))];
    const { cityPhone, mobilePhone } = this.splitPhones(uniquePhones);

    const innMatch = body.match(INN_PATTERN);
    const kppMatch = body.match(KPP_PATTERN);
    const ogrnMatch = body.match(OGRN_PATTERN);
    const urls = body.match(URL_PATTERN) ?? [];

    return {
      phones: uniquePhones,
      cityPhone,
      mobilePhone,
      inn: innMatch?.[1] ?? null,
      kpp: kppMatch?.[1] ?? null,
      ogrn: ogrnMatch?.[1] ?? null,
      website: urls[0] ?? null,
    };
  }

  extractArticles(body: string): ArticleInfo[] {
    const articles: ArticleInfo[] = [];
    const seen = new Set<string>();

    // Pattern: article_code x quantity [unit]
    const lineItemRegex =
      /([A-Za-zА-Яа-я0-9\-/_]{3,})\s+[xх*]\s*(\d+)(?:\s*([A-Za-zА-Яа-я.]+))?/gi;
    for (const match of body.matchAll(lineItemRegex)) {
      const code = match[1];
      if (!seen.has(code.toLowerCase())) {
        seen.add(code.toLowerCase());
        articles.push({
          code,
          quantity: Number(match[2]),
          unit: match[3] || 'pcs',
          brand: null,
          description: null,
        });
      }
    }

    // Generic article code pattern
    for (const match of body.matchAll(ARTICLE_PATTERN)) {
      const code = match[1];
      if (!seen.has(code.toLowerCase())) {
        seen.add(code.toLowerCase());
        articles.push({
          code,
          quantity: null,
          unit: 'pcs',
          brand: null,
          description: null,
        });
      }
    }

    return articles;
  }

  extractFromSignature(body: string): SignatureInfo | null {
    const sigMatch = body.match(SIGNATURE_PATTERN);
    if (!sigMatch) return null;

    const sigBlock = sigMatch[1].trim();
    const lines = sigBlock.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const fullName = lines[0] ?? null;
    const position = lines.find((l) => POSITION_PATTERNS.some((p) => p.test(l))) ?? null;
    const company = lines.find((l) => COMPANY_PATTERNS.some((p) => p.test(l))) ?? null;
    const phone = lines.find((l) => PHONE_PATTERN.test(l)) ?? null;
    const emailMatch = sigBlock.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

    return {
      fullName,
      position,
      company,
      phone,
      email: emailMatch?.[0] ?? null,
    };
  }

  private extractCompanyName(body: string): string | null {
    for (const pattern of COMPANY_PATTERNS) {
      const match = body.match(pattern);
      if (match) return match[1].replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  private inferCompanyFromDomain(email: string): string | null {
    const domain = email.split('@')[1];
    if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
    const base = domain.split('.')[0];
    return base ? base.replace(/[-_]/g, ' ') : null;
  }

  private extractNameFromSignature(body: string): string | null {
    const sigHint =
      /(?:с\s+уважением|best\s+regards|спасибо)[,\s]*\n+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/iu;
    const match = body.match(sigHint);
    return match?.[1]?.trim() ?? null;
  }

  private extractPosition(body: string): string | null {
    for (const pattern of POSITION_PATTERNS) {
      const match = body.match(pattern);
      if (match) return match[0].replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  private splitPhones(phones: string[]): {
    cityPhone: string | null;
    mobilePhone: string | null;
  } {
    const mobilePhone =
      phones.find((p) => /\+?7?8?[\s(.-]*9\d{2}/.test(p.replace(/\s/g, ''))) ?? null;
    const cityPhone = phones.find((p) => p !== mobilePhone) ?? null;
    return { cityPhone, mobilePhone };
  }

  private async extractWithLlm(
    body: string,
  ): Promise<Partial<ExtractedEntities>> {
    const prompt = LLM_EXTRACTION_PROMPT.replace('{body}', body.slice(0, 3000));

    const response = await fetch(config.LLM_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.0,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty LLM extraction response');

    const parsed = JSON.parse(text);

    return {
      sender: {
        email: '',
        fullName: parsed.contactName ?? null,
        position: parsed.position ?? null,
        companyName: parsed.companyName ?? null,
      },
      contacts: {
        phones: parsed.phones ?? [],
        cityPhone: null,
        mobilePhone: null,
        inn: parsed.inn ?? null,
        kpp: null,
        ogrn: null,
        website: null,
      },
      articles: (parsed.articles ?? []).map(
        (a: { code: string; quantity?: number; brand?: string }) => ({
          code: a.code,
          quantity: a.quantity ?? null,
          unit: 'pcs',
          brand: a.brand ?? null,
          description: null,
        }),
      ),
    };
  }

  private mergeResults(
    regex: {
      sender: SenderInfo;
      contacts: ContactInfo;
      articles: ArticleInfo[];
      signature: SignatureInfo | null;
    },
    llm: Partial<ExtractedEntities> | null,
  ): Omit<ExtractedEntities, 'confidence'> {
    if (!llm) {
      return regex;
    }

    // Regex results take precedence; LLM fills gaps
    return {
      sender: {
        email: regex.sender.email,
        fullName: regex.sender.fullName ?? llm.sender?.fullName ?? null,
        position: regex.sender.position ?? llm.sender?.position ?? null,
        companyName: regex.sender.companyName ?? llm.sender?.companyName ?? null,
      },
      contacts: {
        phones: regex.contacts.phones.length > 0
          ? regex.contacts.phones
          : (llm.contacts?.phones ?? []),
        cityPhone: regex.contacts.cityPhone,
        mobilePhone: regex.contacts.mobilePhone,
        inn: regex.contacts.inn ?? llm.contacts?.inn ?? null,
        kpp: regex.contacts.kpp,
        ogrn: regex.contacts.ogrn,
        website: regex.contacts.website,
      },
      articles:
        regex.articles.length > 0
          ? regex.articles
          : (llm.articles ?? []),
      signature: regex.signature,
    };
  }

  private calculateConfidence(
    entities: Omit<ExtractedEntities, 'confidence'>,
  ): number {
    let score = 0.3; // base

    if (entities.sender.companyName) score += 0.15;
    if (entities.sender.fullName) score += 0.1;
    if (entities.contacts.inn) score += 0.15;
    if (entities.contacts.phones.length > 0) score += 0.1;
    if (entities.articles.length > 0) score += 0.1;
    if (entities.signature) score += 0.05;
    if (entities.contacts.website) score += 0.05;

    return Math.min(0.99, Number(score.toFixed(2)));
  }
}
