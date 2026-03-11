import pino from 'pino';
import { config } from '../config.js';

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '***@***.***' },
  { pattern: /\b\d{10,12}\b/g, replacement: '**INN/PHONE**' },
  { pattern: /\b\d{9}\b/g, replacement: '**KPP**' },
  { pattern: /\b\d{13,15}\b/g, replacement: '**OGRN**' },
  { pattern: /password[\"']?\s*[:=]\s*[\"']?[^\s,\"']+/gi, replacement: 'password=***' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/g, replacement: 'Bearer ***' },
];

function maskPii(value: unknown): unknown {
  if (typeof value === 'string') {
    let masked = value;
    for (const { pattern, replacement } of PII_PATTERNS) {
      masked = masked.replace(pattern, replacement);
    }
    return masked;
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map(maskPii);
    }
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lowerKey = k.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('apikey')
      ) {
        masked[k] = '***';
      } else {
        masked[k] = maskPii(v);
      }
    }
    return masked;
  }
  return value;
}

const transport = config.log.pretty
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined;

export const logger = pino({
  level: config.log.level,
  transport,
  hooks: {
    logMethod(inputArgs, method) {
      const masked = inputArgs.map(maskPii);
      return method.apply(this, masked as Parameters<typeof method>);
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
