import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ExtractedEntities } from './entity-extractor.js';

export interface CrmMatchResult {
  clientId: string | null;
  clientName: string | null;
  matchMethod: string;
  confidence: number;
  isNewClient: boolean;
  candidates: CrmCandidate[];
  suggestedActions: string[];
}

interface CrmCandidate {
  clientId: string;
  clientName: string;
  matchMethod: string;
  score: number;
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'yandex.ru', 'ya.ru', 'hotmail.com', 'outlook.com',
]);

/**
 * CRM matching cascade ported from crm-matcher.js:
 * 1. Match by INN
 * 2. Match by company name
 * 3. Match by contact email
 * 4. Match by domain
 */
export class CrmMatcher {
  constructor(
    private prisma: PrismaClient,
    private log: Logger,
  ) {}

  async match(entities: ExtractedEntities): Promise<CrmMatchResult> {
    const candidates: CrmCandidate[] = [];

    // Cascade 1: Match by INN (highest confidence)
    if (entities.contacts.inn) {
      const byInn = await this.matchByInn(entities.contacts.inn);
      if (byInn) {
        candidates.push(byInn);
      }
    }

    // Cascade 2: Match by company name
    if (entities.sender.companyName) {
      const byName = await this.matchByCompanyName(entities.sender.companyName);
      candidates.push(...byName);
    }

    // Cascade 3: Match by contact email
    if (entities.sender.email) {
      const byEmail = await this.matchByContactEmail(entities.sender.email);
      if (byEmail) {
        candidates.push(byEmail);
      }
    }

    // Cascade 4: Match by domain
    if (entities.sender.email) {
      const byDomain = await this.matchByDomain(entities.sender.email);
      if (byDomain) {
        candidates.push(byDomain);
      }
    }

    // Deduplicate and score
    const scored = this.scoreCandidates(candidates);

    if (scored.length > 0) {
      const best = scored[0];
      this.log.info(
        { clientId: best.clientId, method: best.matchMethod, score: best.score },
        'CRM match found',
      );

      return {
        clientId: best.clientId,
        clientName: best.clientName,
        matchMethod: best.matchMethod,
        confidence: Math.min(0.99, best.score / 100),
        isNewClient: false,
        candidates: scored.slice(0, 5),
        suggestedActions: [
          'Link email to existing client record',
          'Create request and assign managers',
        ],
      };
    }

    // No match found: suggest creating a draft client
    this.log.info(
      { senderEmail: entities.sender.email },
      'No CRM match found, suggesting new client',
    );

    const missingLegalData = !entities.contacts.inn && !entities.sender.companyName;

    const suggestedActions = [
      'Check sender contact and domain against CRM',
      entities.contacts.website
        ? `Use website ${entities.contacts.website} to look up legal details`
        : 'Website not auto-detected',
      missingLegalData
        ? 'Request legal details (INN, company name) via reply'
        : 'Create new client card with available details',
      'After receiving details, create client card and contact person',
    ];

    return {
      clientId: null,
      clientName: null,
      matchMethod: 'none',
      confidence: 0,
      isNewClient: true,
      candidates: [],
      suggestedActions,
    };
  }

  async matchByInn(inn: string): Promise<CrmCandidate | null> {
    const client = await this.prisma.crmClient.findFirst({
      where: { inn },
      select: { id: true, legalName: true },
    });

    if (!client) return null;

    return {
      clientId: client.id,
      clientName: client.legalName,
      matchMethod: 'inn',
      score: 95,
    };
  }

  async matchByCompanyName(companyName: string): Promise<CrmCandidate[]> {
    const normalized = companyName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length < 3) return [];

    const clients = await this.prisma.crmClient.findMany({
      where: {
        legalName: { contains: normalized, mode: 'insensitive' },
      },
      select: { id: true, legalName: true },
      take: 5,
    });

    return clients.map((c) => ({
      clientId: c.id,
      clientName: c.legalName,
      matchMethod: 'company_name',
      score: this.nameMatchScore(normalized, c.legalName.toLowerCase()),
    }));
  }

  async matchByContactEmail(email: string): Promise<CrmCandidate | null> {
    const contact = await this.prisma.crmContact.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { client: { select: { id: true, legalName: true } } },
    });

    if (!contact?.client) return null;

    return {
      clientId: contact.client.id,
      clientName: contact.client.legalName,
      matchMethod: 'contact_email',
      score: 80,
    };
  }

  async matchByDomain(email: string): Promise<CrmCandidate | null> {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;

    const client = await this.prisma.crmClient.findFirst({
      where: { domain: { equals: domain, mode: 'insensitive' } },
      select: { id: true, legalName: true },
    });

    if (!client) return null;

    return {
      clientId: client.id,
      clientName: client.legalName,
      matchMethod: 'domain',
      score: 60,
    };
  }

  private scoreCandidates(candidates: CrmCandidate[]): CrmCandidate[] {
    // Deduplicate by clientId, keeping highest-scored entry
    const bestByClient = new Map<string, CrmCandidate>();
    for (const candidate of candidates) {
      const existing = bestByClient.get(candidate.clientId);
      if (!existing || candidate.score > existing.score) {
        bestByClient.set(candidate.clientId, candidate);
      }
    }

    return Array.from(bestByClient.values()).sort((a, b) => b.score - a.score);
  }

  private nameMatchScore(query: string, candidate: string): number {
    if (candidate === query) return 85;
    if (candidate.includes(query) || query.includes(candidate)) return 70;

    // Simple Jaccard-like similarity on words
    const queryWords = new Set(query.split(/\s+/));
    const candidateWords = new Set(candidate.split(/\s+/));
    let overlap = 0;
    for (const w of queryWords) {
      if (candidateWords.has(w)) overlap++;
    }
    const union = new Set([...queryWords, ...candidateWords]).size;
    const similarity = union > 0 ? overlap / union : 0;

    return Math.round(40 + similarity * 45);
  }
}
