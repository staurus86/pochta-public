import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ClassificationResult } from './classifier.js';
import type { CrmMatchResult } from './crm-matcher.js';
import type { ExtractedEntities } from './entity-extractor.js';

export interface AssignmentResult {
  assigneeId: string | null;
  assigneeRole: 'mop' | 'moz' | null;
  assigneeName: string | null;
  method: string;
  reason: string;
}

interface AssignmentInput {
  emailId: string;
  classification: ClassificationResult;
  crmMatch: CrmMatchResult | null;
  entities: ExtractedEntities;
}

/**
 * MOP (sales manager) / MOZ (purchase manager) assignment service.
 * Cascade:
 * 1. Brand-based rules (specific brands -> specific managers)
 * 2. Region-based assignment
 * 3. Round-robin among available managers
 * 4. Fallback to default manager
 */
export class AssignmentService {
  constructor(
    private prisma: PrismaClient,
    private log: Logger,
  ) {}

  async assign(input: AssignmentInput): Promise<AssignmentResult> {
    // If email already matched to a CRM client with assigned curator, use that
    if (input.crmMatch?.clientId) {
      const clientAssignment = await this.assignFromClient(input.crmMatch.clientId);
      if (clientAssignment) return clientAssignment;
    }

    // Step 1: Try brand-based assignment
    const brandAssignment = await this.assignByBrandRules(input);
    if (brandAssignment) return brandAssignment;

    // Step 2: Try region-based assignment
    const regionAssignment = await this.assignByRegion(input);
    if (regionAssignment) return regionAssignment;

    // Step 3: Round-robin
    const rrAssignment = await this.roundRobin(input);
    if (rrAssignment) return rrAssignment;

    // Step 4: Fallback
    return this.fallbackAssignment();
  }

  /**
   * Use existing client's curator assignments.
   */
  private async assignFromClient(clientId: string): Promise<AssignmentResult | null> {
    const client = await this.prisma.crmClient.findUnique({
      where: { id: clientId },
      select: {
        curatorMopId: true,
        curatorMozId: true,
      },
    });

    if (!client) return null;

    const assigneeId = client.curatorMopId ?? client.curatorMozId;
    if (!assigneeId) return null;

    const role = client.curatorMopId ? 'mop' : 'moz';

    return {
      assigneeId,
      assigneeRole: role,
      assigneeName: null, // Caller can resolve if needed
      method: 'client_curator',
      reason: `Assigned from existing client curator (${role})`,
    };
  }

  /**
   * Assign based on detected brands and brand-owner rules.
   */
  async assignByBrandRules(input: AssignmentInput): Promise<AssignmentResult | null> {
    // Look for detected brands in the classification
    const brands = input.entities.articles
      .map((a) => a.brand)
      .filter((b): b is string => b !== null);

    if (brands.length === 0) return null;

    // Check brand assignment rules in settings
    const brandRules = await this.prisma.systemSetting.findUnique({
      where: { key: 'assignment.brand_owners' },
    });

    if (!brandRules?.value) return null;

    let rules: Array<{ brand: string; mopId: string; mozId?: string }>;
    try {
      rules = JSON.parse(String(brandRules.value));
    } catch {
      this.log.warn('Invalid brand_owners setting format');
      return null;
    }

    for (const brand of brands) {
      const rule = rules.find(
        (r) => r.brand.toLowerCase() === brand.toLowerCase(),
      );
      if (rule) {
        return {
          assigneeId: rule.mopId,
          assigneeRole: 'mop',
          assigneeName: null,
          method: 'brand_rule',
          reason: `Brand "${brand}" assigned to designated MOP`,
        };
      }
    }

    return null;
  }

  /**
   * Assign based on sender region (inferred from phone area code or client address).
   */
  async assignByRegion(input: AssignmentInput): Promise<AssignmentResult | null> {
    const phone = input.entities.contacts.cityPhone ?? input.entities.contacts.mobilePhone;
    if (!phone) return null;

    // Extract area code (Russian format: +7 XXX ...)
    const areaMatch = phone.replace(/[^\d]/g, '').match(/^[78](\d{3})/);
    if (!areaMatch) return null;

    const areaCode = areaMatch[1];

    const regionRules = await this.prisma.systemSetting.findUnique({
      where: { key: 'assignment.region_rules' },
    });

    if (!regionRules?.value) return null;

    let rules: Array<{ areaCodes: string[]; mopId: string }>;
    try {
      rules = JSON.parse(String(regionRules.value));
    } catch {
      this.log.warn('Invalid region_rules setting format');
      return null;
    }

    const matchedRule = rules.find((r) => r.areaCodes.includes(areaCode));
    if (!matchedRule) return null;

    return {
      assigneeId: matchedRule.mopId,
      assigneeRole: 'mop',
      assigneeName: null,
      method: 'region',
      reason: `Area code ${areaCode} matched to region rule`,
    };
  }

  /**
   * Round-robin assignment among active managers.
   */
  async roundRobin(_input: AssignmentInput): Promise<AssignmentResult | null> {
    // Get the round-robin counter from Redis or settings
    const rrSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'assignment.round_robin_index' },
    });

    const managerListSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'assignment.manager_pool' },
    });

    if (!managerListSetting?.value) return null;

    let managers: Array<{ id: string; name: string; role: 'mop' | 'moz' }>;
    try {
      managers = JSON.parse(String(managerListSetting.value));
    } catch {
      this.log.warn('Invalid manager_pool setting format');
      return null;
    }

    if (managers.length === 0) return null;

    const currentIndex = rrSetting?.value ? Number(rrSetting.value) : 0;
    const nextIndex = (currentIndex + 1) % managers.length;

    // Update round-robin counter
    await this.prisma.systemSetting.upsert({
      where: { key: 'assignment.round_robin_index' },
      update: { value: String(nextIndex) },
      create: { key: 'assignment.round_robin_index', value: String(nextIndex) },
    });

    const chosen = managers[currentIndex];

    return {
      assigneeId: chosen.id,
      assigneeRole: chosen.role,
      assigneeName: chosen.name,
      method: 'round_robin',
      reason: `Round-robin assignment (index ${currentIndex} of ${managers.length})`,
    };
  }

  /**
   * Fallback: assign to the default manager.
   */
  async fallbackAssignment(): Promise<AssignmentResult> {
    const defaultManager = await this.prisma.systemSetting.findUnique({
      where: { key: 'assignment.default_manager' },
    });

    let managerId: string | null = null;
    let managerName: string | null = null;

    if (defaultManager?.value) {
      try {
        const parsed = JSON.parse(String(defaultManager.value));
        managerId = parsed.id ?? null;
        managerName = parsed.name ?? null;
      } catch {
        managerId = String(defaultManager.value);
      }
    }

    return {
      assigneeId: managerId,
      assigneeRole: 'mop',
      assigneeName: managerName,
      method: 'fallback',
      reason: managerId
        ? 'Assigned to default manager (no other rules matched)'
        : 'No assignment rules matched and no default manager configured',
    };
  }
}
