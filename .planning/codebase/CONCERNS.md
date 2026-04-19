# Codebase Concerns

**Analysis Date:** 2026-04-19

## Tech Debt

### src/ ↔ .railway-deploy/src/ Dual Maintenance (CRITICAL)

**Issue:** Every JavaScript file in `src/` must be manually copied to `.railway-deploy/src/`. Files are deployed from `.railway-deploy/src/`, not from `src/`. Out-of-sync files cause silent production failures.

**Files affected:** All 26 files in `src/services/`, `src/storage/`, `src/utils/` and `public/app.js`

**Historical incidents:**
- Session 15.04.2026: `attachment-content.js` and `project3-runner.js` were desynchronized, causing production bugs (commit 83e04b9 sync)
- Memory note: "ВСЕГДА копировать изменённый файл в оба места + public/app.js тоже в оба места"

**Impact:** High — any code change that forgets to sync becomes dead code in production on Railway. Users see old behavior, developers see new code.

**Fix approach:**
1. **Immediate:** Add pre-commit hook to validate sync status or refuse commits with only one-side changes
2. **Medium term:** Restructure .railway-deploy/ to symlink to src/ or refactor deploy config to read from src/
3. **Long term:** Migrate to unified deployment pipeline (e.g., GitHub Actions building from src/)

---

### Article/Brand Extraction Regex Fragility

**Issue:** `src/services/email-analyzer.js` (6223 lines) contains 30+ regex patterns for extracting articles and brands. Each customer email pattern that fails triggers a new regex or post-processor filter. No systematic corpus or generative approach — all hand-crafted rules.

**Key patterns (line numbers approximate):**
- `ARTICLE_PATTERN` (line 44) — labeled articles like "Артикул X-Y-Z"
- `STANDALONE_CODE_PATTERN` (line 45) — uppercase codes
- `NUMERIC_ARTICLE_PATTERN` (line 47) — codes like "509-1720"
- `EXTENDED_CODE_PATTERN` (line 53) — mixed Cyrillic/Latin
- `CYRILLIC_MIXED_CODE_PATTERN` (line 57) — АИР100S4 style
- `DIGITS_CYRILLIC_CODE_PATTERN` (line 59) — 100А13/1.5Т220
- `SERIES_MODEL_PATTERN` (line 62) — CR 10-3, WDU 2.5
- 10+ more patterns for edge cases

**Post-processors (filters added after detection):**
- `isObviousArticleNoise()` — 20+ noise patterns (UUID, CSS, PDF metadata, OCR garbage)
- `stripImageAltTextChain()` — removes [Brand][Brand] chains from HTML alt-text (commit 70e4722)
- `stripBrandCapabilityListText()` — removes "Бренды по которым мы..." signature blocks (commit 5ea1dfa)
- `signature-cluster filter` — removes unmarked comma-chain brands from signatures (commit 29f5456)
- `mixed-script filter` — removes Cyrillic+Latin mixed tokens as OCR noise (commit fcbdd98)

**Recent bug classes fixed (last 50 commits):**
- Ghost brands from generic words (commit 8473567 + batches A-H)
- UUID/hash prefixes counted as articles (commits 80baef1, b96b6a1)
- Mixed-script OCR noise (commit fcbdd98)
- Image alt-text chains (commit 70e4722)
- Capability list false brands (commit 5ea1dfa)
- Signature cluster junk (commit 29f5456)
- Semantic single-token matches (commit 42fc86b)
- Voltage/dimension specs (commit fa60f95)
- Form-field labels (commit 783bc32)

**Impact:** Medium — accuracy at 95.92% (commit 80baef1 Batch I), but each new customer type risks regression. New email pattern = new regex rule = manual testing.

**Test coverage:** 91 tests, all passing (except 3 pre-existing Windows failures unrelated to logic). But tests are reactive — they capture known cases, not prospective edge cases.

**Fix approach:**
1. **Immediate:** Maintain regression test suite (currently done well)
2. **Medium term:** Introduce Machine Learning classifier for article/brand detection instead of regex cascade
3. **Short term:** Document regex patterns with examples and risk zones in code comments
4. **Monitor:** Establish production audit pipeline to detect new false-positive patterns before they accumulate

---

### SQLite Knowledge Base Brittleness

**Issue:** `src/services/detection-kb.js` (2195 lines) manages SQLite database with 15,454 brand aliases, 20 product categories, 88 request signals, and corpus FTS index. Growth without systematic deduplication or conflict resolution.

**Files:** `data/detection-kb.sqlite` (SQLite DB)

**Key tables:**
- `brand_catalog` — 15,454 aliases (was 662 before manual import), no dedup logic
- `product_types` — hardcoded JSON load, no migration mechanism
- `message_corpus` — FTS5 virtual table for semantic search
- `detection_rules`, `sender_profiles` — manually seeded

**Known issues:**
- No schema versioning or migration system — structural changes require manual DB edits
- FTS5 semantic search had single-token match bug (commit 42fc86b) — now requires ≥3 overlapping non-stopword tokens
- New brands must be manually added or imported via bulk JSON
- Corpus deduplication logic incomplete — duplicate messages cause ranking issues

**Impact:** Medium — platform depends on KB being correct, but no automated validation of consistency. Aliases may conflict (e.g., "PULS" matches both pump brand and electrical unit).

**Fix approach:**
1. **Immediate:** Add schema version check at startup, fail loudly if incompatible
2. **Medium term:** Build admin UI for KB management (brand add/edit/deduplicate, rule testing)
3. **Long term:** Implement automated dedup and conflict detection before corpus is indexed

---

## Known Bugs

### Entity Extraction Multi-Issue Sprint (J-Sprint, ongoing)

**Summary:** 12-point TZ from business (2026-04-19) with P0/P1/P2 priorities. 8 commits delivered, targets partially met.

**Files:** `src/services/email-analyzer.js`, `src/services/field-enums.js`, `src/services/quality-gate.js`, `src/services/request-type-rules.js`, plus test suite

**Known open issues:**

1. **#4 Phone extraction gap:** 256 → 131 → 106 → ~81 cases (target <30)
   - Root: international fallback (+375, +86, +994) not yet implemented for non-Russian phones
   - Status: Identified, next in sprint

2. **#5a ФИО (full name) with legal entity:** ~154 cases
   - Root: Parser extracts company name and person name together (e.g., "ООО Петров Иван" → both treated as name)
   - Fix: Unicode-aware ORG_LEGAL_FORM_RE regex added (commit 24d0aa2), segment/strip fallback in progress
   - Status: In progress

3. **INN normalization (.0 suffix):** Resolved in commit dbb5eef
   - 0-prefix catalog codes filtered in commit 4730841

4. **Missing enum types:** resolved via `reconcileMissingForProcessing()` in field-enums.js

5. **Quality gate:** implemented via `annotateQualityGate()` in quality-gate.js

**Impact:** High for CRM sync — entries with wrong entity data will cause match failures or duplicate contacts

**Fix approach:** Follow sprint plan (commit 24d0aa2 shows pattern), add unit tests for each entity type, validate via reanalysis before release

---

### LLM Cache Staleness Risk

**Issue:** LLM classification/extraction results cached to `data/llm-cache.json`. When `/reanalyze` endpoint is called, old cache is restored, but post-processors may not be re-run.

**Files:** `src/services/llm-extractor.js`, `src/services/llm-cache.js`, `src/services/email-analyzer.js`

**Incident:** Commit 30e1c0c (Batch J4) added explicit `applyPostProcessing()` call to sync path because post-processors were skipped when LLM cache was restored. Without this, signature-cluster filter, alt-text strip, capability-list strip would not re-apply to cached LLM results.

**Current code (src/services/email-analyzer.js, analyzeEmail):**
```javascript
// If LLM cache exists and is used, post-processors must be re-applied
const withPostProcessing = llmCached ? applyPostProcessing(llmResult, ...) : llmResult;
```

**Impact:** Medium — reanalysis could silently produce stale results if post-processor logic changes but cache isn't invalidated

**Fix approach:**
1. **Immediate:** Ensure all LLM cache usage paths call `applyPostProcessing()` — audit code for cache load points
2. **Medium term:** Add cache invalidation logic (versioning or TTL) so old cache entries don't haunt reanalysis
3. **Test:** Unit test reanalysis flow with cache present + new post-processor logic

---

## Security Considerations

### Base64-Encoded Secrets in Environment Variables (MEDIUM RISK)

**Issue:** Railway deployment passes credentials as base64-encoded environment variables. This shifts the security boundary to Railway environment management, but introduces risk if env vars are leaked via logs or process inspection.

**Files affected:** 
- `src/services/project3-runner.js` — decodes `PROJECT3_SEEN_B64`, `PROJECT3_LOG_B64`
- `src/services/tender-runner.js` — decodes `PROJECT2_GOOGLE_CREDENTIALS_B64`, `PROJECT2_SEEN_B64`, `PROJECT2_LOG_B64`
- `.railway-deploy/` — Dockerfile passes env vars to Python scripts

**Current pattern:**
```javascript
const seenB64 = process.env.PROJECT3_SEEN_B64 || "";
const seenJson = JSON.parse(Buffer.from(seenB64, "base64").toString("utf-8"));
```

**Risk:** Base64 is encoding, not encryption. If Railway environment is breached (via GitHub secrets leak, server misconfiguration, or log dump), credentials are trivially recovered.

**Impact:** High for production — IMAP credentials, Google API keys, service credentials are exposed

**Fix approach:**
1. **Immediate:** Audit Railway environment variable access controls; ensure logs don't leak env vars
2. **Medium term:** Implement actual encryption (e.g., libsodium sealed boxes) for sensitive data, not base64
3. **Operational:** Rotate all credentials listed in env vars as part of incident response plan

---

### No Staging Environment

**Issue:** Every deployment goes directly to production (Railway). Only safety is manual testing + regression suite before `npm start`.

**Current flow:** 
1. Code change in `src/`
2. Copy to `.railway-deploy/src/` (manual step!)
3. `git push` to main branch
4. GitHub Actions (if configured) or manual `railway up`
5. **Live on production immediately**

**No A/B testing, no canary, no gradual rollout.** Bugs like the attachment-content.js desync would immediately affect all users.

**Impact:** High — bugs in production affect all 28 mailboxes instantly

**Fix approach:**
1. **Immediate:** Require manual pre-flight testing in `npm test` before any push
2. **Medium term:** Set up staging environment on Railway (separate project) for manual testing
3. **Long term:** Implement blue-green deployment or canary testing on Railway

---

### No Secrets Validation at Startup

**Issue:** Code assumes environment variables are present and valid. Missing or malformed secrets fail silently during initialization or first use.

**Example:** If `PROJECT2_GOOGLE_CREDENTIALS_B64` is missing, `runTenderImporter()` will crash unpredictably during Google Sheets API call, not at startup.

**Impact:** Medium — production outages without clear error message

**Fix approach:** Add validation step at server startup (see `src/server.js` line 48 for pattern: `managerAuth.ensureAdmin()`) to check all required env vars and fail loudly with actionable error message

---

## Performance Bottlenecks

### No Performance Monitoring

**Issue:** No metrics collection for request latency, email analysis time, or database query performance.

**Files:** All services lack timing instrumentation

**Known slow paths (no measured data):**
- Email analysis pipeline (email-analyzer.js) — regex cascade + KB lookup could be slow for large emails
- FTS5 semantic search on message corpus — unbounded result set, no pagination
- SQLite WAL sync on high-write load (project3-runner processes batch emails)

**Impact:** Low until scale increases; currently serving ~30 active mailboxes

**Fix approach:**
1. **Short term:** Add simple timer logs at entry/exit of analyzeEmail, detectBrands, matchCompanyInCrm
2. **Medium term:** Integrate structured logging (pino/winston) with metrics aggregation
3. **Monitor:** Set up alerts if email analysis exceeds threshold (e.g., >5s per email)

---

## Fragile Areas

### Python Subprocess Integration (Project 2 & 3 Runners)

**Files:** `src/services/tender-runner.js`, `src/services/project3-runner.js`

**Issue:** Python processes communicate results via stdout markers (`SUMMARY_JSON=...`, `PROJECT3_JSON=...`). No schema validation, error states leak silently.

**Current parsing logic (project3-runner.js):**
```javascript
const parsePayload = (stdout) => {
  const line = String(stdout || "").split("\n").find((entry) => entry.startsWith("PROJECT3_JSON="));
  return JSON.parse(line.slice("PROJECT3_JSON=".length));
};
```

**Risk scenarios:**
1. Python script crashes mid-run → stdout is incomplete → `JSON.parse()` throws uncaught exception
2. Python outputs wrong schema → leads to undefined field access downstream
3. Python timeout (900s for project3) → process killed, no graceful shutdown signal

**Impact:** High — project 2 (tender imports) and project 3 (mailbox file parsing) silently fail with unhelpful errors

**Fix approach:**
1. **Immediate:** Wrap `JSON.parse()` in try-catch, validate parsed schema against expected shape
2. **Medium term:** Implement proper IPC (e.g., JSON-RPC via stdin/stdout) with error channel
3. **Long term:** Migrate Python logic to Node.js (Python dependency is fragile for production)

---

### Requisites File Detection Incomplete

**Issue:** Emails with attached company registration documents (DOCX, DOCX with rekvizity = company card) should ONLY contribute sender-level fields (company name, INN, phone). Should NOT contribute articles or brands from the document body.

**Files:** `src/services/email-analyzer.js` (attachment-content.js integration), `src/services/attachment-content.js`

**Current logic (email-analyzer.js, detectArticles path):**
- Documents detected via REQUISITES_CONTEXT_PATTERN
- Articles/brands filtered via isRequisiteTextBlock()
- **But:** Form-style documents with structured fields (PDF forms, XLSX tables) may still leak data

**Memory note:** "DOC/DOCX с реквизитами/карточкой контрагента: только sender-поля, никаких артикулов/брендов/qty"

**Impact:** Medium — false articles and brands extracted from contact cards inflate product lists

**Fix approach:**
1. **Enhance:** Detect common document templates (DOCX forms, XLSX card layouts) and skip non-sender fields
2. **Test:** Add unit tests for each document type (company card DOCX, order form PDF, etc.)

---

### Windows Test Failures (Pre-existing, Out of Scope)

**Issue:** 3 tests fail on Windows (docx/xlsx tar extraction, company-directory setup). These are environment issues, not logic bugs.

**Files:** `tests/email-analyzer.test.js` (references to docx/xlsx artifacts)

**Root cause:** tar/zip utilities, file encoding on Windows (UTF-8 vs CP1251), binary file handling

**Note:** Memory records these as "3 pre-existing failures (docx/xlsx/company-directory — unrelated)"

**Impact:** Low — affects Windows development experience, not production (Railway = Linux)

**Fix approach:** Refactor tests to mock tar/zip operations instead of using system tools

---

## Scaling Limits

### SQLite Concurrency Limits

**Issue:** `detection-kb.js` uses `DatabaseSync` (synchronous SQLite) with WAL mode and busy_timeout=5000ms. Under high concurrency (multiple project runners + web requests), writes may block.

**Current setup (line ~80 in detection-kb.js):**
```javascript
this.db.exec("PRAGMA journal_mode = WAL;");
this.db.exec("PRAGMA busy_timeout = 5000;");
```

**Scaling risk:** As email volume increases (project3 batch processing is 900s timeout, processes ~100 emails per run), KB updates (sender profile saving, corpus FTS updates) may cause timeouts.

**Impact:** Medium — unlikely until >100 concurrent email analyses, but not tested at scale

**Fix approach:**
1. **Monitor:** Log busy_timeout events and transaction duration
2. **Medium term:** Migrate to PostgreSQL for concurrent workloads (as planned in v2 monorepo)
3. **Short term:** Batch corpus FTS updates instead of per-email writes

---

### Email Body Size Unbounded

**Issue:** `analyzeEmail()` processes email body without size limits. Large emails (>10MB plain text, common for forwarded threads) will cause memory pressure and slow analysis.

**Files:** `src/services/email-analyzer.js` (no maxBodySize check at entry)

**Known large-email problem:** Quoted threads accumulate signatures, reply headers, and image metadata. No truncation logic.

**Impact:** Low currently, but degrades gracefully under load

**Fix approach:**
1. **Immediate:** Truncate body to first 500KB of text for analysis
2. **Monitor:** Log body size distribution to detect growing emails
3. **Test:** Add test case with large email (>5MB)

---

## Missing Critical Features

### OCR and Attachment Scanning (#18 in backlog)

**Issue:** Attachments (PDF, images with text) are not optically scanned. Customers often send photo scans of product lists or order forms. Current system extracts file metadata but not content from images.

**Files:** `src/services/attachment-content.js` — basic PDF text extraction via Python, no OCR

**Current capability:**
- DOCX/XLSX extraction via Python helper — works
- PDF text layer extraction via spawnSync("python", ...) — works for searchable PDFs
- Image OCR — **not implemented**
- Scanned PDF (image-only) — **not implemented**

**Business impact:** High — many customers send scanned documents; current system misses product codes, quantities, and company details in images

**Fix approach:**
1. **Long term:** Integrate Tesseract OCR or cloud vision API (Google/AWS)
2. **Short term:** Log warnings for image-only attachments so team knows coverage gap
3. **Operational:** Train customers to send searchable PDFs or text emails (temporary workaround)

---

### No Batch Test/Audit Infrastructure

**Issue:** Production accuracy is validated by manual inspection of 500-1000 email samples (audit files like `pochta-analysis-500-v3.xlsx`). No automated production test suite.

**Current process:**
- Reanalyze batch of emails
- Export to XLSX
- Manual inspection by Sergey/team
- Mark errors
- Iterate

**Missing:** Automated regression test on production data, baseline expectations, graphing of accuracy over time

**Impact:** Medium — slow feedback loop for detecting regressions in production

**Fix approach:**
1. **Immediate:** Create `scripts/audit_prod_json.py` (already done — see memory) to generate metrics
2. **Medium term:** Set up weekly automated audit run, store metrics in DB, alert on regression
3. **Monitoring:** Dashboard showing accuracy trend (ready_for_crm %, review %, errors %)

---

## Test Coverage Gaps

### Article Extraction Coverage Incomplete

**What's tested:** 30+ unit tests for article edge cases (noise filters, multi-word articles, Cyrillic codes, etc.)

**What's NOT tested:**
- Regex performance with pathological inputs (stress testing)
- Interaction between multiple filters (composition bugs)
- Real-world email corpora beyond 91 test cases

**Files:** `tests/email-analyzer.test.js` (2996 lines, well-organized)

**Impact:** Medium — 95.92% accuracy means 4.08% of emails are mislabeled. Unknown if these are edge cases or systematic patterns.

**Fix approach:**
1. **Immediate:** Maintain regression test suite (doing well)
2. **Medium term:** Build property-based testing (hypothesis/QuickCheck style) to generate pathological articles
3. **Monitor:** Track accuracy per email category (invoices, price lists, generic inquiries) separately

---

### CRM Matcher Logic Untested

**Issue:** `src/services/crm-matcher.js` (308 lines) matches extracted company data against CRM database. No unit tests for matching logic.

**Files:** `src/services/crm-matcher.js`, `src/services/crm-adapters.js`

**Risk:** CRM matching is critical for integration — wrong matches cause duplicate contacts, lost data, or sync failures

**Impact:** High for business logic — no visibility into matching accuracy

**Fix approach:**
1. **Immediate:** Add unit tests for matchCompanyInCrm with mock CRM data
2. **Medium term:** Implement match scoring/confidence mechanism
3. **Monitor:** Log all CRM matches with confidence score, alert on low-confidence matches

---

### Background Job/Scheduler Untested

**Issue:** `src/services/project-scheduler.js` (108 lines) runs setInterval to trigger project runners every hour. No tests for scheduling logic, race conditions, or failure recovery.

**Files:** `src/services/project-scheduler.js`

**Risk:** Silent failures in scheduler mean jobs don't run, mailbox processing stops, no alerting

**Impact:** Medium — affects all 3 project types

**Fix approach:**
1. **Immediate:** Add logging to scheduler ticks (entry/exit, error handling)
2. **Medium term:** Unit test scheduler with mock timers (siesta/jest fake timers)
3. **Monitoring:** Alert if scheduler misses expected tick

---

## Tech Debt Summary (Priority Order)

| Area | Severity | Effort | Impact | Dependencies |
|------|----------|--------|--------|--------------|
| src/ ↔ .railway-deploy/ sync | Critical | Medium | High | Pre-commit hook, CI/CD |
| Regex fragility (articles/brands) | High | Medium | Medium | ML classifier, corpus |
| Python subprocess validation | High | Low | High | Error handling, schema |
| Entity extraction sprint (J) | High | Medium | High | Testing, reanalysis |
| LLM cache staleness | High | Low | Medium | Versioning, cache invalidation |
| Base64 secrets | Medium | Medium | High | Encryption, ops |
| CRM matcher tests | High | Medium | High | Testing infrastructure |
| SQLite concurrency | Medium | High | Medium | PostgreSQL migration |
| Staging environment | Medium | High | High | Railway config, CI/CD |
| Requisites file filtering | Medium | Medium | Medium | Document template library |

---

*Concerns audit: 2026-04-19*
