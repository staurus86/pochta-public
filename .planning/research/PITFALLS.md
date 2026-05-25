# Pitfalls Research

**Domain:** Rule-based email extraction quality improvements — Russian B2B email parser (pochta-platform)
**Researched:** 2026-05-25
**Confidence:** HIGH (based on project history, actual code, and production incidents documented in MEMORY.md and CONCERNS.md)

---

## Critical Pitfalls

### Pitfall 1: Over-Tightening Reject Filters Silently Kills Valid SKUs

**What goes wrong:**
A new reject rule added to `isObviousArticleNoise()` or `rejectArticleCandidate()` eliminates a class of noise — but the regex also matches legitimate article codes that share the pattern. The false-negative rate rises invisibly because there is no "articles that should have been extracted" baseline test.

**Why it happens:**
Noise and valid codes overlap in structure. For example, `isInnLike()` checks numeric length (10–12 digits), but some vendor article codes are 10-digit pure numeric strings. The `isPhoneFragment()` check catches phone fragments, but short standalone numeric codes (e.g., `509-1720`) can match phone-like patterns. Adding a new filter for one noisy email pattern can silently break extraction on 5–10 other email types that no one has tested.

**How to avoid:**
For every new reject rule, write two test cases before adding the code:
1. An affirmative case: the noisy token that MUST be rejected.
2. A borderline case: a real article code that superficially resembles the noise and MUST NOT be rejected.

Use the existing `tests/p0-regression.test.js` pattern — each BUG-Axx entry has both assertion types. Add to `tests/article-filters.test.js` or `tests/p0-regression.test.js` when creating a new filter.

**Warning signs:**
- Article detection rate (currently ~43%) drops after a commit without any brand/article changes in test emails.
- A field that previously extracted a value now returns empty on a known-good email.
- `rejectArticleCandidate()` returns `rejected: true` for a manually confirmed article during debug logging.

**Phase to address:**
Every phase that adds or modifies article extraction filters (REQ-K-ARTICLES-01, REQ-PRODNAMES-01). Gating criterion: run `npm test` and additionally spot-check 5 known-good article-containing emails before merging.

---

### Pitfall 2: src/ vs .railway-deploy/src/ Drift — Changes Don't Land in Production

**What goes wrong:**
Code is edited in `src/`, tests pass locally, the commit goes to Railway — but production still shows old behavior. The deployed code is in `.railway-deploy/src/`, not `src/`. The copy step is manual and easy to forget.

**Why it happens:**
The dual-directory layout exists for historical deploy reasons (Railway reads from `.railway-deploy/`). There is no automated sync, no pre-commit hook, and no CI check that flags when `src/foo.js` and `.railway-deploy/src/foo.js` differ. All engineering discipline relies on the developer remembering a post-edit copy step.

**How to avoid:**
After every file edit:
```
copy src\services\<changed-file>.js .railway-deploy\src\services\<changed-file>.js
```
Also covers `public/app.js` → `.railway-deploy/public/app.js`. Before any `git push`, run a diff check:
```bash
diff -rq src/ .railway-deploy/src/ --exclude="*.md"
```
Long-term fix: resolve `REQ-SYNC-01` by making `.railway-deploy/src/` a symlink to `src/` or switching the Railway build config to read from `src/` directly.

**Warning signs:**
- Production behavior doesn't match local behavior after deploy.
- `git diff HEAD~1` shows a changed `src/` file but the corresponding `.railway-deploy/src/` file was not changed in the same commit.
- Memory note from session 15.04.2026: `attachment-content.js` and `project3-runner.js` were desynchronized and caused production bugs.

**Phase to address:**
Every phase that modifies any `src/services/` file. This is not optional — treat it as the final step of every coding task, before the commit.

---

### Pitfall 3: Pipeline Stage Ordering — Post-Processors Applied Before Data Is Ready

**What goes wrong:**
A field enrichment or recognition function (like `hydrateRecognition*`) is called before the post-processing step that normalizes or validates its inputs. The recognition picks up stale or un-normalized data, and the resulting field diverges from what the post-processor would produce. This creates desync cases that are hard to trace.

**Why it happens:**
`email-analyzer.js` is 6200+ lines with a deeply sequential pipeline. When adding a new call, it is inserted where it "seems logical" rather than where the data contract is satisfied. The commit `375978f` fixed exactly this: `hydrateRecognition*` was called before `validateSenderFields` and `applyPostProcessing`, causing 150 desync cases across two projects.

**How to avoid:**
Before inserting any new function call into the pipeline, draw (or re-read) the data flow:

```
parse → normalize HTML → classify → extract entities (regex) → post-process filters
→ validateSenderFields → hydrateRecognition → quality-gate → CRM match
```

New calls belong AFTER the stage that provides their input. Never call enrichment before normalization. Add a comment above each pipeline stage block indicating what contract it assumes.

**Warning signs:**
- A field shows the correct value in isolation (unit test) but wrong value in a full-pipeline integration test.
- Desync errors visible when comparing `prod_before_*.json` vs `prod_after_*.json` audit snapshots.
- A field is populated then cleared (or overwritten with a worse value) somewhere downstream.

**Phase to address:**
Any phase that adds a new pipeline stage or enrichment call (REQ-K-ARTICLES-01 positions/totalQty, REQ-COMPANY-01, REQ-PERSON-01). Verification: run full reanalysis after the change and compare recognition desync count to 0.

---

### Pitfall 4: Reanalysis Does Not Re-Apply New Post-Processors to LLM-Cached Emails

**What goes wrong:**
A new filter (e.g., `stripBrandCapabilityListText`, `signature-cluster filter`) is deployed. The `/reanalyze` endpoint is triggered to apply it to the corpus. But some emails were previously analyzed with LLM enabled and have cached LLM results in `data/llm-cache.json`. These emails skip the full pipeline and restore from cache — bypassing the new filter. Production metrics look improved on the new subset but unchanged on the cached subset.

**Why it happens:**
LLM caching is a performance optimization that short-circuits the pipeline. Post-processors were added later and were not part of the original cache contract. Commit `30e1c0c` added an explicit `applyPostProcessing()` call after cache restore, but the pattern can break again if a new code path restores from cache without also calling post-processing.

**How to avoid:**
Every cache-restore code path must call `applyPostProcessing()` before returning. Add a test that:
1. Creates a synthetic LLM cache entry for an email with a capability-list-style body.
2. Calls the reanalysis path.
3. Asserts the capability list brands are stripped in the output.

**Warning signs:**
- After deploying a new filter and triggering reanalysis, some emails still show the old (unfiltered) data.
- A percentage of emails in the production audit shows stale patterns that the filter was supposed to eliminate.
- The affected emails all happen to be ones that were analyzed when LLM was enabled.

**Phase to address:**
Any phase that adds a new post-processor AND expects it to apply retroactively via reanalysis. Explicitly test the reanalysis path, not just the fresh-analysis path.

---

### Pitfall 5: Regex False Positives in Russian-Language Context — Phone/INN/Quantity Fragments as Articles

**What goes wrong:**
Article extraction patterns (`NUMERIC_ARTICLE_PATTERN`, `STANDALONE_CODE_PATTERN`, etc.) match fragments of phone numbers, INN codes, or Russian quantity expressions. Examples from production: `R407C`/`R404A` (refrigerant codes) extracted as articles, INN `194000145952` accepted as a labeled article, quantity ranges `0-600` extracted as an article code.

**Why it happens:**
Russian B2B emails contain dense numeric data in close proximity: INN codes, phone numbers, postal codes, product quantities, article numbers, and technical specs (voltages, pressures, thread sizes) all appear in similar formats. A pattern designed to catch `509-1720` (a real article) also matches `7-926-xxx-xx-xx` (a partial phone number). The English-language article patterns were designed for Latin-character catalogs and do not account for Russian postal/identification number formats.

**How to avoid:**
For every new article pattern, test against the following anti-patterns before adding:
- 10-digit INNs (юрлицо): `7701234567`
- 12-digit INNs (ИП): `194000145952`
- Russian phone formats: `+7-926-123-45-67`, `8(495)123-45-67`
- Postal codes: `123456`
- Refrigerant codes: `R407C`, `R404A`, `R134a`
- Technical specs: `IP54`, `M20x2`, `50Hz`, `230/400`, `0-600`
- Russian date formats: `15.04.2026`, `15/04/26`

The `isInnLike()`, `isPhoneFragment()`, `isRefrigerantCode()`, `isDateTime()` functions in `article-filters.js` exist precisely for this. Use them in `rejectArticleCandidate()` before accepting any new numeric pattern.

**Warning signs:**
- Articles list contains pure 10–12 digit numeric strings.
- Articles list contains phone-like patterns (`+7-xxx` or `8-xxx`).
- Articles list contains values that appear verbatim in the email's requisites block or signature.
- Refrigerant codes (`Rxxxxx`) appear in articles.

**Phase to address:**
REQ-K-ARTICLES-01. The explicit requirement to reach 0 refrigerant-codes-as-articles and 0 UUID/hash-as-articles is a direct result of this pitfall. Each article filter added must have a paired anti-pattern test.

---

### Pitfall 6: Signature Cluster Filter Removes Legitimate Brands from Request Body

**What goes wrong:**
The signature-cluster filter (commit `29f5456`) removes comma-chain brand sequences that appear in signatures. If a customer happens to write a request like "Нужны бренды: FESTO, SIEMENS, ABB, Phoenix Contact" as a comma-separated list in the request body, the filter may classify it as a signature cluster and remove all brands.

**Why it happens:**
The filter uses positional heuristics (position in the email, surrounding lines) to decide if a brand sequence is in a signature. Position detection is approximate because quoted threads and multi-paragraph replies make "end of email" ambiguous. Commit `29f5456` noted this risk: "Легитимные бренды запроса сохраняются (вне cluster)" but the boundary detection can fail on unusual email layouts.

**How to avoid:**
The signature-cluster filter must check that the candidate cluster occurs AFTER a recognized signature marker (from `SIGNATURE_PATTERNS`) or beyond a `QUOTE_PATTERNS` marker. It must NOT fire on the first N lines of the email body (before any signature marker has been seen). Add a test case: a brand comma-list in the first paragraph of the email body must not be removed.

**Warning signs:**
- Brand detection drops to 0 on an email that clearly lists multiple brands in the request.
- An email with a high number of brands in the body shows 0 or 1 brand detected.
- The affected email has no "С уважением" or other signature marker but the cluster filter still fired.

**Phase to address:**
REQ-BRAND-01 (residual false positives). Any phase that tightens the brand cluster filter. Verification: confirm brand detection rate does not drop below the pre-commit baseline on the 100-letter audit sample.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Add a new `isObviousArticleNoise()` check without a corresponding positive test | Quick noise elimination | Silently kills valid SKUs in future; no coverage to detect it | Never — always add the paired positive test |
| Hardcode a specific email sender or subject pattern as a noise trigger | Fixes one sender immediately | Breaks when that sender changes their template; untestable | Only as temporary hotfix with a TODO referencing the underlying pattern |
| Apply a filter to ALL emails to fix a bug found in ONE email type | Broad coverage appears complete | Other email types regress; fix appears done but is over-broad | Never without testing on a representative cross-section of email types |
| Manually edit `.railway-deploy/src/` directly instead of syncing from `src/` | Faster one-time fix | Creates permanent drift; the "canonical" location becomes ambiguous | Never |
| Trust `npm test` alone as pre-deploy gate | Fast feedback | Unit tests don't catch integration-level pipeline ordering bugs or corpus-level regressions | Acceptable only for infrastructure/non-extraction changes |
| Skip the `applyPostProcessing()` call in a new cache-restore path | Less code to write | Post-processors silently skipped for cached emails; stale data persists | Never — post-processing is mandatory after any cache restore |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LLM cache restore path | Restoring cached LLM result without re-applying post-processors | Always call `applyPostProcessing()` after any LLM cache load, before returning the result |
| `hydrateRecognition*` in pipeline | Calling recognition hydration before `validateSenderFields` | Call all hydration calls AFTER post-processing and field validation; see commit `375978f` |
| Python subprocess JSON output | Assuming `PROJECT3_JSON=` always appears in stdout | Wrap `JSON.parse()` in try-catch; validate schema shape before consuming; log stderr separately |
| SQLite `DatabaseSync` and concurrency | Assuming WAL mode prevents all blocking | Write-heavy reanalysis runs can still hit busy_timeout under concurrent requests; don't run reanalysis during peak IMAP fetch window |
| n8n webhook payload with attachment URLs | Using relative `/api/attachments/...` URLs | Always use absolute URLs with the token: `https://.../api/attachments/...?token=...` — see commit `571a3e1` and feedback note |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `analyzeEmail()` called in a tight loop with no size cap | Large forwarded threads (>10MB) cause OOM or >30s analysis | Truncate email body to first 500KB before regex cascade; already partially addressed with heap 512MB in recent commits | At ~100+ large emails per batch run |
| Full corpus reanalysis during an active project3 IMAP fetch | SQLite busy_timeout errors; analysis results lost | Trigger reanalysis only when scheduler is idle; add a guard in the `/reanalyze` endpoint | When project3 batch processes 100+ emails simultaneously |
| `data/projects.json` grow unbounded | `persist()` slows as file size grows; OOM on serialize | Strip heavy attachment fields from persisted message objects (commit `89804ea`); consider rotating old messages to archive | At ~5000+ messages in one project |
| FTS5 semantic search without token overlap guard | Matches generic Russian words ("доставки", "опция") as brands — see commit `42fc86b` | Require ≥3 non-stopword overlapping tokens; never push single-token matches to results | With any email containing common Russian vocabulary |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging full email body or env vars in Railway console | IMAP credentials or customer PII leaked in log stream | Sanitize logs — truncate email bodies to first 100 chars, never log env var values |
| Returning full analysis JSON (including attachment content) via public API without auth | Customer email content exposed | All `/api/manager/*` and `/api/projects/*` endpoints require session auth; verify every new endpoint added has auth check |
| Committing `ADMIN_PASSWORD` or any token in plain text | Credential leak in git history | Always use Railway env vars for secrets; never hardcode; verify before every commit |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Manager sees "articles detected" but list contains phone fragments and INN numbers | Operator wastes time manually correcting false positives; loses trust in the system | Run `rejectArticleCandidate()` audit before adding any new extraction pattern; ensure 0 phone/INN false positives |
| "Ready for CRM" count drops to 0 after a quality-gate change | Operator thinks the system is broken; escalates | Test quality-gate changes on a 100-email sample before deploy; confirm ready_for_crm count stays within ±10% of baseline |
| Product names contain raw list lines ("1. Товар — 5 шт.") | CRM receives malformed data; Directus sync may fail on field length or encoding | Add `isBadProductName()` check to filter numbered-list fragments; test with emails that have ordered product lists |
| reanalysis triggered but result looks identical to before | Operator doesn't know if filter was applied; no audit trail | Log before/after counts per field when reanalysis completes (e.g., "brands: 1254 → 1240 after capability-list strip") |

---

## "Looks Done But Isn't" Checklist

- [ ] **New article filter:** Has a paired positive test (a real article code that must NOT be rejected) alongside the negative test (noise that MUST be rejected).
- [ ] **New pipeline stage:** Verified the stage is positioned AFTER all its input dependencies are settled (post-processing, validation, hydration order).
- [ ] **New LLM cache restore path:** Calls `applyPostProcessing()` before returning the cached result.
- [ ] **Any src/ file change:** Corresponding `.railway-deploy/src/` file is updated in the same commit.
- [ ] **Reanalysis triggered after deploy:** Verified production counts (ready_for_crm, brand count, article count) moved in the expected direction.
- [ ] **New reject filter added:** Tested against the full anti-pattern list: INN (10-digit, 12-digit), Russian phone formats, postal codes, refrigerant codes, tech specs, date formats.
- [ ] **Signature cluster filter tightened:** At least one test confirms a comma-brand-list in the first body paragraph is NOT removed.
- [ ] **Quality gate modified:** Verified ready_for_crm count stays within ±10% of baseline after reanalysis.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| src/ vs .railway-deploy/src/ drift discovered post-deploy | LOW | Copy correct files to `.railway-deploy/src/`, commit, redeploy. Takes ~10 min. |
| Over-aggressive reject filter removed valid SKUs | MEDIUM | Revert the filter in both `src/` and `.railway-deploy/src/`; add a positive test for the valid SKU pattern; retighten the filter with the new constraint. Trigger reanalysis. |
| Pipeline ordering desync (like commit 375978f incident) | MEDIUM | Add audit script comparing `recognition` fields before/after reanalysis; identify desync count; move the misplaced call to the correct pipeline position; trigger reanalysis; verify desync count = 0. |
| LLM cache not re-applying post-processors | LOW | Add `applyPostProcessing()` call to the cache-restore path; trigger full reanalysis. The fix is one line; the reanalysis takes minutes. |
| Production ready_for_crm drops to 0 after quality gate change | HIGH | Immediate: revert the quality gate commit, redeploy. Investigate: the condition was likely using `allConflicts` (too strict) instead of `highSeverityConflicts`. See session 11.04.2026 evening history. |
| Signature cluster filter removes legitimate request brands | MEDIUM | Revert cluster filter tightening; add a body-position guard (must be past first signature marker); add test for brand-list-in-first-paragraph; redeploy; trigger reanalysis. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Over-tightening reject filters kills valid SKUs | Every article/brand extraction phase (REQ-K-ARTICLES-01, REQ-BRAND-01) | Run `npm test` and spot-check 5 known-good article emails post-commit |
| src/ vs .railway-deploy/src/ drift | Every phase — any file change | Pre-commit diff check; confirmed after each Railway deploy |
| Pipeline ordering desync | Phases adding new pipeline stages (REQ-COMPANY-01, REQ-PERSON-01) | Run full reanalysis, compare before/after recognition fields, desync count = 0 |
| LLM cache bypass of post-processors | Any phase adding new post-processor | Add reanalysis path unit test with pre-seeded cache entry |
| Phone/INN fragments as articles | REQ-K-ARTICLES-01 | 0 INN/phone-like values in articles on 100-email audit |
| Signature cluster kills request brands | REQ-BRAND-01 | Brand detection rate >= baseline on 100-email audit after filter change |
| Quality gate kills ready_for_crm | Any phase touching quality-gate.js | ready_for_crm count within ±10% of baseline after reanalysis |

---

## Sources

- Project MEMORY.md — documented production incidents (sessions 22.04.2026, 17.04.2026, 11.04.2026 evening, 15.04.2026)
- `.planning/codebase/CONCERNS.md` — tech debt audit 2026-04-19 with known bug classes
- `.planning/codebase/ARCHITECTURE.md` — pipeline data flow and layer dependencies
- `src/services/email-analyzer.js` — actual regex patterns (lines 44–93), pipeline structure (6200+ lines)
- `src/services/article-filters.js` — reject filter implementations and anti-pattern coverage
- `tests/p0-regression.test.js` — regression test pattern with paired positive/negative assertions
- Commit history: `375978f` (hydration ordering), `30e1c0c` (LLM cache post-processing), `29f5456` (signature cluster), `83e04b9` (src/ drift incident)

---
*Pitfalls research for: Rule-based email extraction improvements, pochta-platform (Russian B2B email parser)*
*Researched: 2026-05-25*
