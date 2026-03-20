import assert from "node:assert/strict";

// Inline rate limiter for unit testing (same logic as server.js)
function createRateLimiter(maxRequests, windowMs) {
  const buckets = new Map();

  return function checkRateLimit(clientId) {
    const now = Date.now();
    if (!buckets.has(clientId)) buckets.set(clientId, []);
    const timestamps = buckets.get(clientId);
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }
    timestamps.push(now);
    return { allowed: true, remaining: maxRequests - timestamps.length, retryAfter: 0 };
  };
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runTest("allows requests within rate limit", () => {
  const check = createRateLimiter(5, 60000);

  for (let i = 0; i < 5; i++) {
    const result = check("client-1");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 5 - i - 1);
  }
});

runTest("blocks requests exceeding rate limit", () => {
  const check = createRateLimiter(3, 60000);

  check("client-2");
  check("client-2");
  check("client-2");
  const result = check("client-2");
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
  assert.ok(result.retryAfter > 0);
});

runTest("isolates rate limits between clients", () => {
  const check = createRateLimiter(2, 60000);

  check("client-a");
  check("client-a");
  const blockedA = check("client-a");
  assert.equal(blockedA.allowed, false);

  const allowedB = check("client-b");
  assert.equal(allowedB.allowed, true);
});
