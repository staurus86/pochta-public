import { z } from 'zod';

const configSchema = z.object({
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
    maxRetriesPerRequest: z.null().default(null),
  }),
  s3: z.object({
    endpoint: z.string().optional(),
    region: z.string().default('us-east-1'),
    bucket: z.string().default('pochta-emails'),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    forcePathStyle: z.boolean().default(true),
  }),
  database: z.object({
    url: z.string(),
  }),
  llm: z.object({
    apiUrl: z.string().default('http://localhost:11434/api'),
    model: z.string().default('llama3'),
    apiKey: z.string().optional(),
    timeoutMs: z.number().default(30_000),
  }),
  workers: z.object({
    concurrency: z.number().default(5),
    emailFetchConcurrency: z.number().default(2),
    emailParseConcurrency: z.number().default(5),
    emailClassifyConcurrency: z.number().default(5),
    emailExtractConcurrency: z.number().default(3),
    emailCrmMatchConcurrency: z.number().default(5),
    emailSyncConcurrency: z.number().default(3),
    attachmentProcessConcurrency: z.number().default(2),
  }),
  classification: z.object({
    confidenceThreshold: z.number().default(0.75),
    spamThreshold: z.number().default(0.9),
  }),
  extraction: z.object({
    confidenceThreshold: z.number().default(0.7),
  }),
  crmMatch: z.object({
    autoSyncConfidenceThreshold: z.number().default(0.85),
    processingMode: z.enum(['auto', 'semi-auto', 'manual']).default('semi-auto'),
  }),
  sync: z.object({
    dryRun: z.boolean().default(false),
  }),
  attachment: z.object({
    maxSizeBytes: z.number().default(50 * 1024 * 1024), // 50MB
    quarantineExtensions: z.array(z.string()).default(['.exe', '.bat', '.cmd', '.scr', '.pif', '.com']),
  }),
  log: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    pretty: z.boolean().default(false),
  }),
});

function loadConfig() {
  const raw = {
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB ?? 0),
      maxRetriesPerRequest: null,
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'pochta-emails',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    },
    database: {
      url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/pochta',
    },
    llm: {
      apiUrl: process.env.LLM_API_URL ?? 'http://localhost:11434/api',
      model: process.env.LLM_MODEL ?? 'llama3',
      apiKey: process.env.LLM_API_KEY || undefined,
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
    },
    workers: {
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
      emailFetchConcurrency: Number(process.env.EMAIL_FETCH_CONCURRENCY ?? 2),
      emailParseConcurrency: Number(process.env.EMAIL_PARSE_CONCURRENCY ?? 5),
      emailClassifyConcurrency: Number(process.env.EMAIL_CLASSIFY_CONCURRENCY ?? 5),
      emailExtractConcurrency: Number(process.env.EMAIL_EXTRACT_CONCURRENCY ?? 3),
      emailCrmMatchConcurrency: Number(process.env.EMAIL_CRM_MATCH_CONCURRENCY ?? 5),
      emailSyncConcurrency: Number(process.env.EMAIL_SYNC_CONCURRENCY ?? 3),
      attachmentProcessConcurrency: Number(process.env.ATTACHMENT_PROCESS_CONCURRENCY ?? 2),
    },
    classification: {
      confidenceThreshold: Number(process.env.CLASSIFICATION_CONFIDENCE_THRESHOLD ?? 0.75),
      spamThreshold: Number(process.env.SPAM_THRESHOLD ?? 0.9),
    },
    extraction: {
      confidenceThreshold: Number(process.env.EXTRACTION_CONFIDENCE_THRESHOLD ?? 0.7),
    },
    crmMatch: {
      autoSyncConfidenceThreshold: Number(process.env.CRM_MATCH_AUTO_SYNC_THRESHOLD ?? 0.85),
      processingMode: (process.env.PROCESSING_MODE as 'auto' | 'semi-auto' | 'manual') ?? 'semi-auto',
    },
    sync: {
      dryRun: process.env.SYNC_DRY_RUN === 'true',
    },
    attachment: {
      maxSizeBytes: Number(process.env.ATTACHMENT_MAX_SIZE_BYTES ?? 50 * 1024 * 1024),
      quarantineExtensions: process.env.QUARANTINE_EXTENSIONS?.split(',') ?? ['.exe', '.bat', '.cmd', '.scr', '.pif', '.com'],
    },
    log: {
      level: (process.env.LOG_LEVEL as any) ?? 'info',
      pretty: process.env.LOG_PRETTY === 'true',
    },
  };

  return configSchema.parse(raw);
}

export const config = loadConfig();
export type Config = z.infer<typeof configSchema>;
