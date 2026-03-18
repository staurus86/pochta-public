import assert from "node:assert/strict";
import { HttpError, parseJsonBody, parseJsonBuffer, resolveJsonBodyLimit } from "../src/services/http-json.js";

function runTest(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function createRequest(chunks, headers = {}) {
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    }
  };
}

runTest("parses valid JSON buffers", () => {
  const parsed = parseJsonBuffer(Buffer.from('{ "ok": true }'), {
    contentType: "application/json; charset=utf-8",
    maxBytes: 1024
  });

  assert.deepEqual(parsed, { ok: true });
});

runTest("rejects invalid content types", async () => {
  await assert.rejects(
    () => parseJsonBody(createRequest(['{ "ok": true }'], { "content-type": "text/plain" }), { maxBytes: 1024 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 415);
      return true;
    }
  );
});

runTest("rejects malformed JSON bodies", async () => {
  await assert.rejects(
    () => parseJsonBody(createRequest(['{ "ok": '], { "content-type": "application/json" }), { maxBytes: 1024 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

runTest("rejects oversized JSON bodies", async () => {
  await assert.rejects(
    () => parseJsonBody(createRequest(['{ "value": "0123456789" }'], { "content-type": "application/json" }), { maxBytes: 8 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 413);
      return true;
    }
  );
});

runTest("uses fallback body size limit for invalid env values", () => {
  assert.equal(resolveJsonBodyLimit("not-a-number", 2048), 2048);
  assert.equal(resolveJsonBodyLimit("-1", 2048), 2048);
  assert.equal(resolveJsonBodyLimit("4096", 2048), 4096);
});
