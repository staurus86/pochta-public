import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import sanitizeHtml from 'sanitize-html';
import { Classifier, ClassificationResult } from './classifier.js';
import { EntityExtractor, ExtractedEntities } from './entity-extractor.js';
import { CrmMatcher, CrmMatchResult } from './crm-matcher.js';
import { AssignmentService, AssignmentResult } from './assignment.js';
import { AttachmentProcessor } from './attachment-processor.js';
import { AuditService } from './audit.js';

export interface PipelineContext {
  emailId: string;
  prisma: PrismaClient;
  log: Logger;
}

export interface PipelineResult {
  emailId: string;
  classification: ClassificationResult;
  entities: ExtractedEntities;
  crmMatch: CrmMatchResult | null;
  assignment: AssignmentResult | null;
  status: string;
  errors: string[];
}

export class EmailPipeline {
  private classifier: Classifier;
  private entityExtractor: EntityExtractor;
  private crmMatcher: CrmMatcher;
  private assignmentService: AssignmentService;
  private attachmentProcessor: AttachmentProcessor;
  private audit: AuditService;

  constructor(private prisma: PrismaClient, private log: Logger) {
    this.classifier = new Classifier(prisma, log);
    this.entityExtractor = new EntityExtractor(prisma, log);
    this.crmMatcher = new CrmMatcher(prisma, log);
    this.assignmentService = new AssignmentService(prisma, log);
    this.attachmentProcessor = new AttachmentProcessor(log);
    this.audit = new AuditService(prisma);
  }

  /**
   * Run the full email processing pipeline.
   */
  async process(emailId: string): Promise<PipelineResult> {
    const errors: string[] = [];

    const email = await this.fetchAndStoreEmail(emailId);
    if (!email) {
      throw new Error(`Email ${emailId} not found`);
    }

    this.log.info({ emailId }, 'Starting email pipeline');

    // Step 1: Normalize
    const normalized = await this.normalizeEmail(email);

    // Step 2: Process attachments
    try {
      await this.processAttachments(emailId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attachment processing failed';
      this.log.error({ err, emailId }, msg);
      errors.push(msg);
    }

    // Step 3: Classify
    const classification = await this.classifyEmail(emailId, normalized);

    // Step 4: Extract entities
    const entities = await this.extractEntities(emailId, normalized);

    // Step 5: CRM match (only for client-classified emails)
    let crmMatch: CrmMatchResult | null = null;
    if (classification.label === 'client') {
      crmMatch = await this.matchCrm(emailId, entities);
    }

    // Step 6: Decide next action and assignment
    const assignment = await this.decideNextAction(emailId, classification, crmMatch, entities);

    // Determine final status
    const status = this.determineStatus(classification, crmMatch);

    await this.prisma.email.update({
      where: { id: emailId },
      data: { status },
    });

    await this.audit.log({
      emailId,
      action: 'pipeline_completed',
      details: {
        classification: classification.label,
        confidence: classification.confidence,
        crmMatched: !!crmMatch?.clientId,
        assignment: assignment?.assigneeId,
        errors,
      },
    });

    this.log.info(
      { emailId, classification: classification.label, status, errorCount: errors.length },
      'Pipeline completed'
    );

    return {
      emailId,
      classification,
      entities,
      crmMatch,
      assignment,
      status,
      errors,
    };
  }

  /**
   * Fetch email record from DB, ensuring it exists.
   */
  async fetchAndStoreEmail(emailId: string) {
    return this.prisma.email.findUnique({
      where: { id: emailId },
      include: {
        attachments: true,
        inboxAccount: true,
      },
    });
  }

  /**
   * Normalize email content: sanitize HTML, extract plain text.
   */
  async normalizeEmail(email: {
    id: string;
    subject: string | null;
    bodyHtml: string | null;
    bodyText: string | null;
  }) {
    const cleanHtml = email.bodyHtml
      ? sanitizeHtml(email.bodyHtml, {
          allowedTags: [],
          allowedAttributes: {},
        })
      : '';

    const bodyText = email.bodyText || cleanHtml;
    const subject = email.subject || '';

    // Update email with normalized content
    await this.prisma.email.update({
      where: { id: email.id },
      data: { bodyTextNormalized: bodyText.slice(0, 50000) },
    });

    return { subject, bodyText, bodyHtml: email.bodyHtml || '' };
  }

  /**
   * Classify email using hybrid rule + LLM approach.
   */
  async classifyEmail(
    emailId: string,
    content: { subject: string; bodyText: string }
  ): Promise<ClassificationResult> {
    const result = await this.classifier.classify(emailId, content);

    await this.prisma.email.update({
      where: { id: emailId },
      data: {
        classification: result.label,
        classificationConfidence: result.confidence,
        classificationSource: result.source,
      },
    });

    // Store detailed classification result
    await this.prisma.classificationResult.upsert({
      where: { emailId },
      update: {
        label: result.label,
        confidence: result.confidence,
        source: result.source,
        scores: result.scores,
        matchedRules: result.matchedRules,
      },
      create: {
        emailId,
        label: result.label,
        confidence: result.confidence,
        source: result.source,
        scores: result.scores,
        matchedRules: result.matchedRules,
      },
    });

    return result;
  }

  /**
   * Extract structured entities from email content.
   */
  async extractEntities(
    emailId: string,
    content: { subject: string; bodyText: string }
  ): Promise<ExtractedEntities> {
    const entities = await this.entityExtractor.extract(emailId, content);

    // Persist each extracted entity
    const entityRecords = Object.entries(entities)
      .filter(([, value]) => value !== null && value !== undefined)
      .flatMap(([fieldName, value]) => {
        if (Array.isArray(value)) {
          return value.map((v, i) => ({
            emailId,
            fieldName: `${fieldName}[${i}]`,
            fieldValue: typeof v === 'object' ? JSON.stringify(v) : String(v),
            confidence: entities.confidence ?? 0,
          }));
        }
        return [{
          emailId,
          fieldName,
          fieldValue: typeof value === 'object' ? JSON.stringify(value) : String(value),
          confidence: entities.confidence ?? 0,
        }];
      });

    if (entityRecords.length > 0) {
      await this.prisma.extractedEntity.deleteMany({ where: { emailId } });
      await this.prisma.extractedEntity.createMany({ data: entityRecords });
    }

    return entities;
  }

  /**
   * Attempt to match against CRM client database.
   */
  async matchCrm(
    emailId: string,
    entities: ExtractedEntities
  ): Promise<CrmMatchResult> {
    const result = await this.crmMatcher.match(entities);

    await this.prisma.crmMatch.upsert({
      where: { emailId },
      update: {
        clientId: result.clientId,
        matchMethod: result.matchMethod,
        matchConfidence: result.confidence,
        isNewClient: result.isNewClient,
      },
      create: {
        emailId,
        clientId: result.clientId,
        matchMethod: result.matchMethod,
        matchConfidence: result.confidence,
        isNewClient: result.isNewClient,
      },
    });

    return result;
  }

  /**
   * Decide next actions: assign MOP/MOZ, determine workflow step.
   */
  async decideNextAction(
    emailId: string,
    classification: ClassificationResult,
    crmMatch: CrmMatchResult | null,
    entities: ExtractedEntities
  ): Promise<AssignmentResult | null> {
    // Spam emails need no assignment
    if (classification.label === 'spam') {
      await this.prisma.email.update({
        where: { id: emailId },
        data: { status: 'ignored_spam' },
      });
      return null;
    }

    // Low confidence requires human review
    if (classification.confidence < 0.6) {
      await this.prisma.email.update({
        where: { id: emailId },
        data: { status: 'needs_review' },
      });
      return null;
    }

    const assignment = await this.assignmentService.assign({
      emailId,
      classification,
      crmMatch,
      entities,
    });

    return assignment;
  }

  /**
   * Process all attachments for an email.
   */
  private async processAttachments(emailId: string): Promise<void> {
    const attachments = await this.prisma.attachment.findMany({
      where: { emailId },
    });

    for (const attachment of attachments) {
      try {
        const result = await this.attachmentProcessor.process(attachment);

        await this.prisma.attachment.update({
          where: { id: attachment.id },
          data: {
            category: result.category,
            extractedText: result.extractedText?.slice(0, 50000),
            isQuarantined: result.isQuarantined,
          },
        });
      } catch (err) {
        this.log.error(
          { err, attachmentId: attachment.id, emailId },
          'Failed to process attachment'
        );
      }
    }
  }

  /**
   * Determine email status based on pipeline results.
   */
  private determineStatus(
    classification: ClassificationResult,
    crmMatch: CrmMatchResult | null
  ): string {
    if (classification.label === 'spam') return 'ignored_spam';
    if (classification.confidence < 0.6) return 'needs_review';
    if (classification.label === 'client' && crmMatch?.clientId) return 'matched';
    if (classification.label === 'client') return 'needs_review';
    return 'classified';
  }
}
