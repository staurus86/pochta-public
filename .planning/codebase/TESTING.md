# Testing Patterns

**Analysis Date:** 2026-04-19

## Test Framework

**Runner:**
- `node:test` (native Node.js test module)
- No test framework dependency; plain Node.js `test()` and `assert/strict`
- Executed directly via `node tests/*.test.js`

**Assertion Library:**
- `node:assert/strict` for all assertions

**Run Commands:**
```bash
npm test                              # Run all 31 test files sequentially
npm test 2>&1 | head -100             # View first batch of output
node tests/email-analyzer.test.js     # Run single test file
node tests/batch-j-fixes.test.js      # Run specific batch fixes
```

**Current Test Status:**
- Total test files: 31
- Individual test assertions: 144 (139 PASS, 5 FAIL)
- 4 pre-existing FAIL on Windows (tar archive extraction, docx/xlsx, company-directory lookup)
- 1 FAIL in email-analyzer.test.js: brand alias with punctuation detection

## Test File Organization

**Location:**
- All tests in `tests/` directory at project root
- Co-located with source (not in separate `__tests__` folder)

**Naming:**
- Per-service tests: `tests/{service-name}.test.js`
  - `email-analyzer.test.js` — core email analysis
  - `detection-kb.test.js` — knowledge base classification
  - `http-json.test.js` — JSON parsing, HTTP errors
  - `crm-adapters.test.js` — CRM matching
  - `project-schedule.test.js` — scheduling logic
  - `mailbox-config-parser.test.js` — TSV config parsing
  - etc.
- Batch fixes: `tests/batch-{letter}-fixes.test.js`
  - `batch-c-fixes.test.js` through `batch-j-fixes.test.js`
  - Numbered chronologically by implementation phase
  - Each batch tests regression for specific domain fixes

**File count:** 31 test files

## Test Structure

**Suite Organization:**
```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeEmail } from "../src/services/email-analyzer.js";

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

runTest("analyzes client email and matches known company", () => {
  const analysis = analyzeEmail(project, { ... });
  assert.equal(analysis.classification.label, "Клиент");
});
```

**Two test styles used:**

1. **Custom `runTest()` wrapper** (email-analyzer.test.js, detection-kb.test.js):
```javascript
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

runTest("descriptive test name", () => {
  // assertions here
});
```

2. **Native `node:test` API** (batch-j-fixes.test.js):
```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

test("article-noise J2: page: / WordSection / 553E-mail / digit+mail", () => {
  assert.equal(isObviousArticleNoise("page:WordSection1"), true);
});
```

**Patterns:**
- Setup phase: Create project/analysis context via inline objects
- Execution: Call service function with test data
- Assertion: Use `assert.equal()`, `assert.ok()`, `assert.match()`, `assert.deepEqual()`
- No teardown needed (tests are isolated, no persistent state)

## Mocking

**Framework:** Manual mocking via test fixtures and temporary directories

**Approach:**
- No mock library (sinon, jest); mocks hand-written
- Temporary file I/O: `withStoredAttachment()`, `withArchiveAttachment()` helpers
- In-memory test data: project objects, email payloads defined as literals

**Example from `email-analyzer.test.js`:**
```javascript
function withStoredAttachment(messageKey, filename, contents, fn) {
  const dir = path.resolve(process.cwd(), "data", "attachments", messageKey);
  mkdirSync(dir, { recursive: true });
  const safeName = filename.replace(/[<>:"/\\|?*]/g, "_");
  const filePath = path.join(dir, safeName);
  writeFileSync(filePath, contents);
  try {
    return fn({ safeName, size: Buffer.byteLength(contents) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runTest("extracts requisites from stored txt attachment", () => {
  const result = withStoredAttachment("test-msg-001", "invoice.txt", "...", ({ safeName }) => {
    const analysis = analyzeEmail(project, { attachments: [{ filename: safeName }] });
    return analysis;
  });
  assert.ok(result.sender.inn);
});
```

**What to Mock:**
- File I/O: Create temp directories and clean up after test
- External services: Not mocked; integration tests use real service calls where feasible
- Database: Tests use real SQLite KB; mutated state cleaned up or isolated per test

**What NOT to Mock:**
- `analyzeEmail()` service — always called with real logic
- `detectionKb` singleton — shared across tests; each test must handle side effects
- Core business logic — never stubbed; test actual behavior

## Fixtures and Factories

**Test Data:**
```javascript
// Minimal test project
const project = {
  id: "test-proj",
  mailbox: "inbox@example.com",
  brands: ["ABB", "Schneider Electric"],
  managerPool: {
    defaultMop: "Ольга Демидова",
    defaultMoz: "Андрей Назаров",
    brandOwners: [...]
  },
  knownCompanies: [
    {
      id: "client-1001",
      legalName: "ООО ПромСнаб",
      inn: "7701234567",
      website: "https://promsnab.ru",
      contacts: [...]
    }
  ]
};

// Email payload
const email = {
  fromName: "Павел Ильин",
  fromEmail: "p.ilin@promsnab.ru",
  subject: "Заявка ABB по артикулу",
  body: "Добрый день...",
  attachments: "rekvizity.pdf"
};
```

**Location:**
- Inline in test file (no separate fixtures directory)
- Reused across multiple test cases within same file
- Factory function for variants: `const mkProject = () => ({ ... })`

**Example from `batch-j-fixes.test.js`:**
```javascript
const mkProject = () => ({ id: "test-j", name: "Test", type: "email-parser", settings: {} });

test("company-sanitizer J2: HTML angle brackets stripped", async () => {
  const result = await analyzeEmail(mkProject(), {
    subject: "Запрос цены",
    body: "...",
    from: "test@example.ru",
  });
});
```

## Coverage

**Requirements:** No enforced coverage target; organic gap identification through audit

**View Coverage:**
- No built-in coverage tool configured
- Manual coverage audit via git memory (e.g., "integration tests for Python runners — none")

**Coverage Status:**
- Unit tests: 139 PASS covering core email analysis, brand detection, article parsing, HTTP routing, CRM matching
- Integration tests for Python (project 2/3) runners: Not present
- E2E tests: Not present; tested manually via Railway deployment
- Coverage gaps:
  - Python subprocess output parsing (tender-importer, mailbox-file-parser)
  - Webhook dispatcher retry logic
  - ProjectScheduler interval-based execution

## Test Types

**Unit Tests:**
- Scope: Single service function (e.g., `analyzeEmail`, `detectBrands`, `classifyMessage`)
- Approach: Call function with test data, assert output properties
- Example: `email-analyzer.test.js` tests article extraction, brand detection, phone normalization

**Integration Tests:**
- Scope: HTTP request → service → response (e.g., `/api/projects/:id/analyze`)
- Approach: None; existing tests call service directly, not HTTP layer
- Gap: No tests for request/response serialization, auth middleware

**E2E Tests:**
- Framework: Not used in codebase
- Deployment tested manually on Railway staging

## Common Patterns

**Async Testing:**
```javascript
// Using node:test + async
test("analyzes async", async () => {
  const result = await analyzeEmail(project, email);
  assert.equal(result.classification.label, "Клиент");
});

// Using custom runTest with async
runTest("enriches sender from company directory", async () => {
  const analysis = await analyzeEmail(project, email);
  assert.ok(analysis.sender.fullName);
});
```

**Error Testing:**
```javascript
// Assert error is thrown
test("rejects invalid JSON", () => {
  assert.throws(
    () => parseJsonBuffer(Buffer.from("invalid"), {}),
    (err) => err.statusCode === 400
  );
});

// Assert no error
test("parses valid JSON", () => {
  const result = parseJsonBuffer(Buffer.from('{"key":"value"}'), {});
  assert.deepEqual(result, { key: "value" });
});
```

**Brand/Article Detection:**
```javascript
// Verify detection
runTest("detects brand aliases from knowledge base", () => {
  const brands = detectionKb.detectBrands("Запрос по endress и hauser на датчики", []);
  assert.ok(brands.includes("Endress & Hauser"));
});

// Verify filtering
runTest("article-noise J2: page: / WordSection / 553E-mail / digit+mail", () => {
  assert.equal(isObviousArticleNoise("page:WordSection1"), true);
  assert.equal(isObviousArticleNoise("6EP1961-3BA21"), false);  // real article passes
});
```

**HTTP Error Handling:**
```javascript
test("returns 413 when JSON exceeds limit", () => {
  const buffer = Buffer.alloc(65536);
  assert.throws(
    () => parseJsonBuffer(buffer, { maxBytes: 1024 }),
    (err) => err.statusCode === 413
  );
});
```

## Test Data Characteristics

**Realistic Russian business domain:**
- Email subjects: "Заявка на коммерческое предложение ABB"
- Company names: "ООО ПромСнаб", "ООО Ромашка"
- Person names: "Павел Ильин", "Соколова Анна"
- INN format: 10-12 digit Russian tax numbers (7701234567)
- Phone format: Russian +7(XXX)XXX-XX-XX or 8(XXX)XXX-XX-XX
- Brands: "ABB", "Schneider Electric", "R. Stahl", "Endress & Hauser"
- Articles: Multi-format codes (S201-C16, 6GK7343-2AH01, IRFD9024)

**Attachment types:**
- Stored files: `.txt`, `.pdf` contents (real text extraction tested)
- Archive files: `.docx`, `.xlsx` as tar archives (Windows tar extraction failures noted)
- Metadata: Filename-based article extraction tested

## Known Issues

**Pre-existing test failures (Windows platform):**
1. `tar` command unavailable for docx/xlsx extraction on Windows
   - File: `tests/email-analyzer.test.js`
   - Error: `tar: Cannot connect to C: resolve failed`
   - Affect: 2 tests (docx, xlsx attachment parsing)

2. Company directory lookup failure (source unclear, not domain-critical)
   - File: `tests/email-analyzer.test.js`
   - Status: Low priority (KB imported separately via management UI)

3. Brand alias with punctuation detection
   - File: `tests/email-analyzer.test.js` (line 321)
   - Error: `assert.ok(analysis.lead.detectedBrands.includes("R. Stahl"))`
   - Cause: Regex pattern doesn't match "R. Stahl" with dot separator
   - Status: Unfixed; part of planned brand detection refinement

## Batch Fix Pattern

**Each batch introduces regression tests:**
- `batch-c-fixes.test.js`: Tests for Batch C improvements (generic brand filtering)
- `batch-d-fixes.test.js`: Tests for Batch D improvements (false positive cleanup)
- ...
- `batch-j-fixes.test.js`: Tests for Batch J improvements (J1 XLSX export, J2 sanitizers, J3 phone/ФИО, J4 request types)

**Example from `batch-j-fixes.test.js`:**
```javascript
test("article-noise J2: page: / WordSection / 553E-mail / digit+mail", () => {
  assert.equal(isObviousArticleNoise("page:WordSection1"), true);
  // Ensures J2 article blacklist doesn't regress
});

test("fullname-sanitizer J2: ФИО с ООО/АО/LLC отбрасывается", async () => {
  const result = await analyzeEmail(mkProject(), { ... });
  assert.ok(!/\b(?:ООО|АО|...)\b/.test(fio));
  // Ensures J2 legal entity name filtering works
});
```

---

*Testing analysis: 2026-04-19*
