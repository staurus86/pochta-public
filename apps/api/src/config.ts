import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  IMAP_FETCH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  IMAP_BATCH_SIZE: z.coerce.number().int().positive().default(50),

  LLM_API_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-4o-mini'),

  ATTACHMENT_MAX_SIZE_MB: z.coerce.number().positive().default(25),
  ATTACHMENT_QUARANTINE_DIR: z.string().default('/tmp/pochta-quarantine'),

  SLA_REVIEW_HOURS: z.coerce.number().positive().default(4),
  SLA_RESPONSE_HOURS: z.coerce.number().positive().default(24),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const messages: string[] = [];

    for (const [key, value] of Object.entries(formatted)) {
      if (key === '_errors') continue;
      const errors = (value as { _errors?: string[] })?._errors;
      if (errors?.length) {
        messages.push(`  ${key}: ${errors.join(', ')}`);
      }
    }

    throw new Error(
      `Invalid environment configuration:\n${messages.join('\n')}`
    );
  }

  return result.data;
}

export const config = loadConfig();
