export function resolveIdempotencyKey(headers = {}, payload = {}) {
  const headerKey = normalizeIdempotencyKey(headers["idempotency-key"]);
  if (headerKey) {
    return headerKey;
  }

  return normalizeIdempotencyKey(payload.idempotencyKey);
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    return null;
  }

  return key.slice(0, 200);
}
