export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function resolveJsonBodyLimit(rawValue, fallback = 64 * 1024) {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return Math.floor(numericValue);
}

export function isJsonContentType(contentType) {
  if (!contentType) {
    return true;
  }

  return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}

export function parseJsonBuffer(buffer, options = {}) {
  const maxBytes = resolveJsonBodyLimit(options.maxBytes);
  const contentType = options.contentType;

  if (!isJsonContentType(contentType)) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (body.length > maxBytes) {
    throw new HttpError(413, `JSON body exceeds limit of ${maxBytes} bytes.`);
  }

  const raw = body.toString("utf-8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export async function parseJsonBody(req, options = {}) {
  const maxBytes = resolveJsonBodyLimit(options.maxBytes);
  const contentType = req?.headers?.["content-type"];

  if (!isJsonContentType(contentType)) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }

  let totalBytes = 0;
  const chunks = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new HttpError(413, `JSON body exceeds limit of ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return parseJsonBuffer(Buffer.concat(chunks), { maxBytes, contentType });
}
