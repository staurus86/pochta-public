# Coding Conventions

**Analysis Date:** 2026-04-19

## Naming Patterns

**Files:**
- `kebab-case` for all JavaScript files (e.g., `email-analyzer.js`, `detection-kb.js`, `project-scheduler.js`, `http-json.js`, `crm-matcher.js`)
- Tests use `.test.js` suffix (e.g., `email-analyzer.test.js`, `batch-j-fixes.test.js`)
- Batch fixes organized chronologically: `batch-c-fixes.test.js` through `batch-j-fixes.test.js`

**Functions:**
- `camelCase` for all function names (e.g., `analyzeEmail`, `normalizePhoneNumber`, `detectBrands`, `extractLead`, `matchCompanyInCrm`, `stripQuotedReply`)
- Prefix patterns: `is*` for boolean predicates (e.g., `isObviousArticleNoise`, `isAiEnabled`), `get*` for accessors (e.g., `getAuthToken`, `getAiConfig`), `normalize*` for transformations
- Utility functions grouped by domain: `normalizeText`, `normalizeDomain`, `normalizeArticle`, `normalizePhoneNumber`

**Variables:**
- `camelCase` for all variable and parameter names
- Constants using `SCREAMING_SNAKE_CASE` (e.g., `PHONE_PATTERN`, `INN_PATTERN`, `AUTO_REPLY_SUBJECT_PATTERNS`, `RATE_LIMIT_WINDOW_MS`, `BRAND_FALSE_POSITIVE_ALIASES`)
- Regex patterns suffixed with `_PATTERN` or `_RE` (e.g., `URL_PATTERN`, `PHONE_PATTERN`, `EXTENDED_BRAND_WORD_RE`)
- Internal state prefixed with underscore (e.g., `_authToken`, `_origFetch`)

**Types & Classes:**
- `PascalCase` for class names (e.g., `HttpError`, `ProjectsStore`, `ManagerAuth`, `ProjectScheduler`, `LegacyWebhookDispatcher`)
- Explicit function exports via `export function` or `export class`
- No barrel files except where explicitly needed; imports reference full file paths with `.js` extension

## Code Style

**Formatting:**
- 4 spaces for indentation (never tabs)
- Lines typically 80-100 chars; regex patterns and long string constants may exceed this
- No semicolons at end of statements (let parser handle ASI)
- Blank lines used to separate logical sections within functions

**Linting:**
- No formal linter configured (project uses vanilla Node.js)
- Manual style consistency via git commits mentioning convention adherence
- Pre-existing style variations tolerated (e.g., some functions use 2-space, others 4-space — maintain whatever exists in file)

## Import Organization

**Order:**
1. Built-in Node.js modules (`node:fs`, `node:http`, `node:crypto`, etc.)
2. External packages (if any; currently minimal)
3. Local relative imports from same project (e.g., `./email-analyzer.js`, `../storage/projects-store.js`)

**Path Aliases:**
- No path aliases configured
- All imports use relative or absolute paths with full `.js` extension: `import { analyzeEmail } from "../src/services/email-analyzer.js"`
- `fileURLToPath` + `import.meta.url` pattern used in entry points to establish `__filename` and `__dirname`

**Example from `src/server.js`:**
```javascript
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectsStore } from "./storage/projects-store.js";
import { analyzeEmail } from "./services/email-analyzer.js";
```

## Error Handling

**Pattern:**
- Try-catch blocks with `console.error()` for logging failures
- Custom `HttpError` class for HTTP-specific errors with `statusCode` property (`src/services/http-json.js`)
- Minimal re-throwing; errors propagate to `catch` handler at HTTP handler level
- Promise `.catch()` used for background jobs (e.g., scheduler, webhook dispatcher)

**Example from `http-json.js`:**
```javascript
try {
    return JSON.parse(raw);
} catch {
    throw new HttpError(400, "Request body must be valid JSON.");
}
```

**Example from `server.js` HTTP handler:**
```javascript
catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    // ...error handling
}
```

## Logging

**Framework:** Vanilla `console` (no logger library)

**Patterns:**
- `console.log()` for info-level events (test results, startup messages, processing telemetry)
- `console.error()` for errors and exceptions
- `console.warn()` for non-critical failures (e.g., scheduler/background job issues)
- No structured logging; plain text messages

**Example from tests:**
```javascript
console.log(`PASS ${name}`);
console.error(`FAIL ${name}`);
console.error(error);
```

**Example from `server.js`:**
```javascript
console.log(`Server listening on http://${host}:${port}`);
console.error("Error:", err.message);
console.warn("LLM backlog error:", err.message);
```

## Comments

**When to Comment:**
- Explain WHY, not WHAT (code structure is usually self-explanatory)
- Domain logic: when regex patterns or business rules are non-obvious
- Batch fixes: reference issue numbers and context (e.g., `// Batch F / P20: residual generic noise`)
- Cross-cutting concerns: when linking related functions or files

**JSDoc/TSDoc:**
- Not enforced; minimal usage across codebase
- Some functions have inline doc comments for pattern explanation

**Language:**
- Russian comments for domain logic (e.g., `// ФИО с юрлицом`) in `email-analyzer.js`
- English comments for technical patterns
- Separator lines use `// ──` for section headers (e.g., `// ── Auth ──`)

**Example from `detection-kb.js`:**
```javascript
// ── Transliteration table for DESC: synthetic article codes ──

// Marker for "brand capability list" in signatures:
// "Бренды, по которым мы работаем" — Siderus employees include a 70+ brand catalog
// in their email signature. This gets re-quoted in every reply and pollutes brand
// detection. Cut from the marker line to end-of-text before matching aliases.
const BRAND_CAPABILITY_MARKER = /(?:Бренды[,\s]*...)/i;
```

## Data Validation

**Pattern:**
- Explicit guards for null/undefined/empty before processing
- String normalization: `.toLowerCase()`, `.trim()`, `.replace()` chained for consistency
- Type coercion for configuration values: `String()`, `Number()` with fallbacks
- Set-based lookups for fast membership testing (e.g., `FREE_EMAIL_DOMAINS.has(domain)`)

**Example from `crm-matcher.js`:**
```javascript
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

## HTTP Handler Pattern

**Request routing in `src/server.js`:**
1. Parse URL pathname and HTTP method
2. Match against route patterns (e.g., `/api/projects/:id/analyze`)
3. Call `parseJsonBody()` for POST/PUT (throws `HttpError` on invalid JSON)
4. Call service function with parsed body and project context
5. Return JSON response via `sendJson(res, statusCode, data)`
6. Catch and convert errors to HTTP responses

**Example pattern:**
```javascript
if (req.method === "POST" && url.pathname.match(PATTERN)) {
  const body = await parseJsonBody(req, { maxBytes: jsonBodyLimitBytes });
  const result = await serviceFunction(context, body);
  sendJson(res, 200, result);
  return;
}
```

## Regex-Heavy Patterns

**In `email-analyzer.js` and `detection-kb.js`:**
- Email parsing uses 15+ regex patterns for articles, phones, INN/KPP, brands, URLs
- Patterns named descriptively with `_PATTERN` suffix
- Regex flags: `/i` for case-insensitive (Cyrillic handling), `/g` for global matches
- Complex patterns include inline explanations for non-obvious syntax

**Example:**
```javascript
// Numbered list item: "1. Description ARTICLE" or "1) Description ARTICLE"
const NUMBERED_ITEM_PATTERN = /^\s*\d{1,3}[.)]\s+/;

// Product line with quantity: "Description - N шт" or "Description - N.NN шт"
const PRODUCT_QTY_PATTERN = /[—–-]\s*(\d+(?:[.,]\d+)?)\s*(шт|штук[аи]?|единиц[аы]?|...)/i;
```

## Async/Await

**Pattern:**
- `async function` for all functions that use `await`
- Promise chains avoided in favor of await syntax
- No Promise wrapper anti-pattern; exceptions thrown directly
- Background jobs use `.catch()` on promises without awaiting

**Example from `server.js` HTTP handler:**
```javascript
const server = createServer(async (req, res) => {
  try {
    // await calls here
    await handleApi(req, res, url);
  } catch (error) {
    // error handling
  }
});
```

## Module Exports

**Pattern:**
- Named exports for public functions/classes: `export function`, `export class`
- Singleton instances exported directly: `export const detectionKb = ...`
- No default exports
- Each module responsible for its own initialization (file I/O, database setup)

**Example from `detection-kb.js`:**
```javascript
export function stripBrandCapabilityListText(text) { ... }
export function filterSignatureBrandCluster(detectedBrands, ...) { ... }
export class DetectionKb { ... }
export const detectionKb = new DetectionKb(...);
```

## Batch Commit Conventions

**Commit messages follow pattern:**
- `fix(component): description` for bug fixes
- Reference batch letter/phase: `fix(j3): ...` means Batch J, phase 3
- Example: `fix(j3): ФИО с юрлицом — Unicode-aware ORG_LEGAL_FORM_RE + segment/strip fallback`

---

*Convention analysis: 2026-04-19*
