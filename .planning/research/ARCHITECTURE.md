# Architecture Research

**Domain:** Rule-based email field extraction pipeline (Node.js, single-tenant)
**Researched:** 2026-05-25
**Confidence:** HIGH — based on direct codebase analysis (email-analyzer.js 6908 lines, all extractor modules read)

---

## Standard Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                         HTTP Entry Point                            │
│   server.js  POST /api/projects/:id/analyze                        │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│                      email-analyzer.js  (6908 lines)                │
│                                                                     │
│  Phase 1: Normalization                                             │
│  ├─ stripHtml()  separateQuotedText()  extractSignature()           │
│  ├─ parseSenderHeader()  detectAutoReply()                          │
│  └─ parseRobotFormBody() / parseTildaFormBody()                     │
│                                                                     │
│  Phase 2: Classification                                            │
│  └─ classifyMessage() → detection-kb.classifyEmail()               │
│                                                                     │
│  Phase 3: Entity Extraction  [zone input NOT passed to all]        │
│  ├─ extractSender()  ← uses extractPersonName / extractCompany /   │
│  │   extractPositionV2 / extractPhoneV2 / extractEmailV2           │
│  │   (all zone-aware internally via their own facade)              │
│  └─ extractLead()   ← INLINE regex cascade, no zone-aware facade   │
│                                                                     │
│  Phase 4: Post-Processing                                           │
│  ├─ mergeAttachmentRequisites()                                     │
│  ├─ enrichLeadFromKnowledgeBase()                                   │
│  ├─ validateSenderFields()                  ← order matters        │
│  ├─ hydrateRecognitionSummary/Diagnostics/Decision()               │
│  └─ annotateQualityGate()  (via applyPostProcessing)               │
│                                                                     │
│  Phase 5: CRM Match                                                 │
│  └─ matchCompanyInCrm()                                             │
└───────────────────────────────┬────────────────────────────────────┘
                                │
          ┌─────────────────────┼────────────────────┐
          ▼                     ▼                     ▼
  detection-kb.sqlite    projects.json          crm-matcher.js
  (brand aliases,        (message store)        (cascade lookup)
   rules, FTS5)
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `email-analyzer.js` | Monolithic orchestrator: normalize → classify → extract → post-process | MODIFY (incrementally) |
| `email-zoning.js` | Splits body into subject / currentMessage / signature / quotedThread / attachment | EXISTS, used by article-extractor.js only |
| `article-extractor.js` | Zone-aware article facade with scoring + filter pipeline | EXISTS but NOT IMPORTED |
| `{field}-extractor.js` (fio, company, position, phone, email) | Per-field zone-aware extraction cascade | EXISTS, imported via extractSender() |
| `{field}-filters.js` | Rejection predicates for each field | EXISTS |
| `{field}-normalizer.js` | Normalization helpers | EXISTS |
| `detection-kb.js` | SQLite brand/alias classification, FTS5 semantic search | EXISTS |
| `quality-gate.js` | Ready-for-CRM validation rules | EXISTS, called in applyPostProcessing() |
| `field-enums.js` | Missing-enum reconciliation | EXISTS, called in applyPostProcessing() |
| `request-type-rules.js` | requestType fallback rules | EXISTS, called in applyPostProcessing() |
| `crm-matcher.js` | Company → CRM cascade match | EXISTS |

---

## Current Pipeline vs Recommended Pipeline

### Current Stage Order (actual, from code)

```
1. stripHtml + separateQuotedText + extractSignature   [normalization]
2. parseSenderHeader / robot-form / tilda-form parse   [source detection]
3. detectAutoReply                                      [early spam filter]
4. classifyMessage → detection-kb                      [classification]
5. attachmentAnalysis (async path)                     [attachment text]
6. extractSender()                                     [contact fields]
   ├─ extractPersonName  (zone-aware facade)
   ├─ extractCompany     (zone-aware facade)
   ├─ extractPositionV2  (zone-aware facade)
   ├─ extractPhoneV2     (zone-aware facade)
   └─ extractEmailV2     (zone-aware facade)
7. extractLead()                                       [article/brand/product extraction]
   └─ INLINE cascade (30+ regex patterns in email-analyzer.js body)
      NOT using article-extractor.js zone-aware facade
8. applySenderProfileHints / applyCompanyDirectoryHints
9. mergeAttachmentRequisites / enrichLeadFromKnowledgeBase
10. brand dedup + body-grounding gate + zone filter
11. article noise filters (post-hoc, inline)
12. validateSenderFields                               [post-processing]
13. hydrateRecognition* (summary / diagnostics / decision)
14. annotateQualityGate (via applyPostProcessing)
15. matchCompanyInCrm
```

### Recommended Stage Order (after incremental refactor)

```
1. Normalization      strip HTML, detect quoted zones, extract signature
2. Zone detection     splitZones() → { subject, currentMessage, signature, quotedThread, attachmentText }
3. Source detection   robot-form / tilda-form parse → override fromEmail/fromName
4. Early spam filter  detectAutoReply → SPAM short-circuit
5. Classification     detection-kb.classifyEmail()
6. Extraction         ALL fields via zone-aware facades:
   ├─ articles        article-extractor.js (already zone-aware, not wired up)
   ├─ brands          brand-extractor.js
   ├─ person          fio-extractor.js  (already wired)
   ├─ company         company-extractor.js  (already wired)
   ├─ position        position-extractor.js  (already wired)
   ├─ phone           phone-extractor.js  (already wired)
   └─ email           email-extractor.js  (already wired)
7. Cross-field validation   validateSenderFields + phone-vs-INN disambiguation
8. Merge              mergeAttachmentRequisites + enrichLeadFromKnowledgeBase
9. Post-processing    applyPostProcessing (requestType + enum + quality gate)
10. Recognition       hydrateRecognition*
11. CRM match         matchCompanyInCrm
```

**Key difference:** In the current code, steps 11–12 (cross-field validation, recognition hydration) happen AFTER the post-processing filters but the hydration step was previously misplaced BEFORE validateSenderFields (bug fixed in commit 375978f). The recommended order formalizes this as a rule, not an accident.

---

## Recommended Project Structure

No new directories needed. The per-field module pattern already works.

```
src/services/
├── email-analyzer.js          # Orchestrator — REDUCE to ~1000 lines by delegating
├── email-zoning.js            # Zone splitter — KEEP AS-IS
├── article-extractor.js       # Zone-aware article facade — WIRE UP (currently orphaned)
├── article-filters.js         # Article rejection predicates — KEEP AS-IS
├── article-normalizer.js      # Article normalization — KEEP AS-IS
├── brand-extractor.js         # Brand facade — KEEP AS-IS
├── brand-normalizer.js        # Brand normalization — KEEP AS-IS
├── brand-negative-filters.js  # Brand rejection — KEEP AS-IS
├── {fio,company,position,phone,email}-extractor.js  # Per-field facades (already wired)
├── {fio,company,position,phone,email}-filters.js    # Per-field rejection predicates
├── {fio,company,position,phone,email}-normalizer.js # Per-field normalization
├── detection-kb.js            # SQLite KB — KEEP AS-IS
├── quality-gate.js            # Ready-for-CRM gate — KEEP AS-IS
├── field-enums.js             # Enum reconciliation — KEEP AS-IS
├── request-type-rules.js      # requestType fallback — KEEP AS-IS
└── crm-matcher.js             # CRM cascade match — KEEP AS-IS
```

---

## Architectural Patterns

### Pattern 1: Zone-Aware Extraction (Already Exists for Contact Fields)

**What:** Before extracting a field, split the email body into semantic zones (currentMessage / signature / quotedThread / attachment). Score candidates by zone priority. Reject candidates from wrong zones (e.g., do not extract articles from the signature zone).

**When to use:** Every field extraction. Currently used for fio / company / position / phone / email. NOT yet used for articles.

**Zone priority (from email-zoning.js):**
```
subject: 4        (most trusted — explicit request)
currentMessage: 3 (fresh body)
attachment: 2
signature: 1      (low — contact info lives here, not products)
quotedThread: 1   (low — historical context, not new request)
```

**Key rule:** Articles should only be extracted with high confidence from `subject` and `currentMessage`. Candidates from `signature` zone require a stronger label ("Артикул:", "p/n:") to accept.

**Example (how article-extractor.js already implements this):**
```javascript
// article-extractor.js — NOT yet used in email-analyzer.js (orphaned module)
import { splitZones, ZONES, ZONE_PRIORITY } from "./email-zoning.js";

export function extractArticles(email = {}) {
    const zones = splitZones(email);
    const candidates = [];
    for (const [zoneName, zoneText] of Object.entries(zones)) {
        const zonePriority = ZONE_PRIORITY[zoneName] ?? 1;
        for (const c of generateCandidates(zoneName, zoneText)) {
            candidates.push({ ...c, zonePriority });
        }
    }
    // Reject, normalize, deduplicate...
}
```

**Integration point:** Replace `extractLead()`'s inline article cascade with `extractArticles(email)` from article-extractor.js. The email object to pass is `{ subject, body: primaryBody, signature, attachmentText }`.

---

### Pattern 2: Source-Priority Cascade (Already Used for Contact Fields)

**What:** Each field has multiple possible sources. Try them in priority order, stop at first confident result. Record the source for diagnostics.

**Priority order (general):**
```
form fields (robot@/tilda)  → highest confidence
signature block              → high confidence
current message body         → medium confidence
email header (from name)     → lower confidence
email domain inference       → weakest (fallback only)
```

**Why it matters:** A phone number in the signature is almost certainly the sender's phone. A phone number in the quoted thread is probably the original correspondent's phone — don't use it.

**Current state:** Already implemented for fio / company / position / phone / email via facade modules. Each facade calls `{field}-extractor.js` with zone-prioritized inputs.

**What is missing:** Articles and brands do not use source-priority cascade. They use flat regex scanning over the entire body. This causes articles from requisites blocks (company card attachments) and email footers to pollute the product list.

---

### Pattern 3: Cross-Field Disambiguation

**What:** Before finalizing a field value, check whether it conflicts with values already extracted for other fields. The canonical conflict is a number that could be INN, phone, or article.

**Known disambiguation rules (already implemented inline in email-analyzer.js):**
- INN: 10-digit number with INN context → INN, NOT article
- Phone: PHONE_LIKE_PATTERN match → reject as article candidate via `hasArticleNoiseContext(line)`
- Phone vs article: `forbiddenDigits` set built from phones found in body; digits in that set never become articles
- Requisites context: REQUISITES_CONTEXT_PATTERN on same line → reject numeric code as article

**Problem:** These rules are scattered across 200+ lines of `extractLead()`. They work, but adding a new disambiguation rule requires careful placement in the inline cascade.

**Recommended approach:** Extract disambiguation into a shared `crossFieldValidate(candidates, { phones, inns, urls })` function called once after all field extractions run, before final assignment.

---

### Pattern 4: Post-Processing as a Separate Idempotent Phase

**What:** Post-processing steps (requestType inference, enum reconciliation, quality gate) run AFTER all extraction is complete. They are idempotent — safe to call multiple times.

**Why it matters:** The reanalysis path (commit `30e1c0c`) and the LLM merge path both need to re-run post-processors after new data arrives. Making post-processing a clean, separate function prevents the recognition desync bug class.

**Current implementation:** `applyPostProcessing(analysis)` in email-analyzer.js (line 1846) — correctly separated. The hydration functions (`hydrateRecognitionSummary`, etc.) also correctly run after `validateSenderFields` (since commit 375978f).

**Rule to preserve:** The order within applyPostProcessing must remain:
```
validateSenderFields()   ← mutates sender fields
hydrateRecognition*()    ← reads final sender/lead state
applyRequestTypeFallback()
reconcileMissingForProcessing()
annotateQualityGate()
```
Any future addition to this phase must be inserted AFTER validateSenderFields and BEFORE quality gate.

---

### Pattern 5: Incremental Refactor via Facade Swap

**What:** Replace one extraction call at a time inside `extractLead()` with a call to the corresponding zone-aware facade. Test after each swap. Don't touch the facade module itself.

**Safest swap order (lowest risk first):**
1. Articles (most acute accuracy problem, facade already exists and is tested)
2. Brands (brand-extractor.js already used, swap body-zone filtering)
3. Product names (product-name-extractor.js exists, check if zone-aware)

**Integration point for articles:**
- In `extractLead()` (email-analyzer.js ~line 2758), replace the inline regex cascade with:
  ```javascript
  import { extractArticles } from "./article-extractor.js";
  // ...
  const articleResult = extractArticles({ subject, body: primaryBody, signature, attachmentText });
  const allArticles = articleResult.articles;
  const lineItemsRaw = articleResult.lineItems ?? [];  // if facade exposes line items
  ```
- Verify: `article-extractor.js` exports `extractArticles(email)`. Currently it does not expose `lineItems` — that gap must be bridged first.

---

## Data Flow

### Current Article Extraction Flow (Problem Area)

```
email body (raw, unsplit)
    ↓
bodyNoUrls = body.replace(URLs)
    ↓
[10+ parallel regex patterns on bodyNoUrls]
    ↓ each produces article candidates
deduplicateByAbsorption([all candidates])
    ↓
isObviousArticleNoise() filter  ←── 200+ lines, growing
    ↓
allArticles, lineItemsRaw
```

**Problem zones:**
- `bodyNoUrls` = entire body including signature + quoted thread
- Signature zone contains: company name, address, INN, phone, brand capability lists → all are noise sources for articles
- Quoted thread contains: previous email's articles (potentially from a different supplier/brand) → creates false articles

### Recommended Article Extraction Flow

```
email body
    ↓
splitZones() → { subject, currentMessage, signature, quotedThread, attachmentText }
    ↓
[extract candidates per zone with zone priority score]
    ↓
[reject: wrong-zone articles (signature → require explicit label)]
[reject: cross-field conflict (phone digits, INN digits)]
    ↓
[normalize + deduplicate]
    ↓
allArticles, lineItems
```

### Contact Field Flow (Current, Correct)

```
email body
    ↓
extractSender(fromName, fromEmail, bodyForSender, attachments, signature)
    ├─ extractPersonName({ senderDisplay, signature, body, emailLocal })
    │   → zone-aware cascade inside fio-extractor.js
    ├─ extractCompany({ senderDisplay, signature, body, emailDomain, personHint })
    │   → zone-aware cascade inside company-extractor.js
    ├─ extractPositionV2({ signature, body, senderDisplay, personHint, companyHint })
    │   → zone-aware cascade inside position-extractor.js
    ├─ extractPhoneV2({ signature, body, senderDisplay, personHint, companyHint })
    │   → zone-aware cascade inside phone-extractor.js
    └─ extractEmailV2({ rawFrom, fromEmail, fromName, body, signature })
        → zone-aware cascade inside email-extractor.js
```

This pattern is correct and should be preserved. It is the reference implementation for how article extraction should also work.

---

## Integration Points

### What to Modify

| File | Change | Risk |
|------|--------|------|
| `email-analyzer.js` | Wire `article-extractor.js` into `extractLead()` | MEDIUM — replaces inline cascade, must pass correct zone inputs |
| `email-analyzer.js` | Ensure `splitZones()` result is computed once and passed to all extractors | LOW — additive |
| `article-extractor.js` | Add `lineItems` output to facade (currently only exports `articles`) | LOW — additive |
| `email-analyzer.js` | Move cross-field disambiguation (phone/INN conflict detection) into standalone function | LOW — pure refactor, no logic change |

### What NOT to Modify

| File | Reason |
|------|--------|
| `email-zoning.js` | Correct as-is; used by article-extractor.js |
| `{fio,company,position,phone,email}-extractor.js` | Working zone-aware facades; do not touch |
| `detection-kb.js` | Not related to extraction accuracy |
| `quality-gate.js` | Not related to extraction accuracy |
| `applyPostProcessing()` body | Correct order; only add to end of phase, never reorder |

### New vs Modified

| Item | Status |
|------|--------|
| `article-extractor.js` → wire into email-analyzer.js | MODIFY (add import + replace extractLead inline cascade) |
| `article-extractor.js` → add lineItems output | MODIFY (additive) |
| Cross-field disambiguation function | NEW (extract from existing inline code) |
| splitZones() call at analyzeEmail() top level | NEW (currently called inside article-extractor.js only) |

---

## Anti-Patterns

### Anti-Pattern 1: Extracting Fields from the Full Body Without Zone Splitting

**What people do:** Run regex on `body` (entire email including signature + quoted thread).

**Why it's wrong:** The signature contains contact information (INN, phone, company name) that is noise for product extraction. The quoted thread contains historical articles that may not belong to the current request.

**Do this instead:** Run `splitZones()` first, then scope each extractor to the correct zone(s). Articles from signature zone require explicit label to be accepted. Articles from quoted thread are rejected unless no article found in currentMessage.

---

### Anti-Pattern 2: Post-Processing Before Field Extraction Is Complete

**What people do:** Call `hydrateRecognitionSummary()` or `annotateQualityGate()` partway through extraction.

**Why it's wrong:** These functions read the final state of `lead` and `sender`. If called too early, they capture intermediate (incomplete) state. When post-extraction filters later remove noise articles or fix sender fields, the recognition summary is stale.

**Do this instead:** All hydration and quality gate calls happen in `applyPostProcessing()`, after all mutations to `lead` and `sender` are complete. This is already the rule — enforce it explicitly in code comments.

---

### Anti-Pattern 3: Adding Post-Hoc Noise Filters to `isObviousArticleNoise()`

**What people do:** When a new false-positive article class appears, add a new branch to the 200-line `isObviousArticleNoise()` function in email-analyzer.js.

**Why it's wrong:** The function grows unboundedly. It cannot see the zone context where the candidate came from. A UUID that appears in the current message body (might be a genuine order reference) gets rejected the same as a UUID in a PDF attachment (almost always noise).

**Do this instead:** Reject based on zone + candidate properties together. Zone-aware rejection (e.g., "reject this token in signature zone unless explicitly labeled") is more precise than a global blocklist.

---

### Anti-Pattern 4: Shared Mutable State Between Phases

**What people do:** Read from `sender` inside `extractLead()`, or write to `lead` from `extractSender()`.

**Why it's wrong:** Creates hidden coupling. The bug in commit 375978f (hydrateRecognition called before validateSenderFields) happened because the phase boundary was unclear.

**Do this instead:** Each phase function takes its inputs as parameters and returns a result. `validateSenderFields(sender)` mutates sender in place (acceptable). `hydrateRecognitionSummary(lead, sender)` reads both (acceptable). But `extractLead()` should not read `sender` directly — pass relevant hints as parameters.

---

## Scaling Considerations

The system is single-tenant, ~28 mailboxes, ~100 emails/batch run. Scaling is not the concern. Accuracy and maintainability are.

| Concern | Current | After Refactor |
|---------|---------|----------------|
| Adding new article noise filter | Add regex branch to email-analyzer.js | Add rejection predicate to article-filters.js with zone context |
| Debugging article false positive | Grep through 200-line inline cascade | Inspect article-extractor.js output with zone labels |
| Adding new contact field | New facade module + wire in extractSender() | Same pattern |
| Regression risk per change | High (6908-line monolith) | Lower (100-300 line facade per field) |

---

## Sources

- Direct codebase analysis: `src/services/email-analyzer.js` (6908 lines)
- `src/services/email-zoning.js` — zone splitter implementation
- `src/services/article-extractor.js` — zone-aware facade (exists, NOT imported)
- `src/services/{fio,company,position,phone,email}-extractor.js` — reference implementation for zone-aware pattern
- `.planning/codebase/ARCHITECTURE.md` — system overview (2026-04-19)
- `.planning/codebase/CONCERNS.md` — tech debt audit (2026-04-19)
- Memory note: commit `375978f` — hydrateRecognition desync fix (22.04.2026)
- Memory note: commit `30e1c0c` — applyPostProcessing added to LLM cache restore path

---

## Critical Finding

**`article-extractor.js` is a complete, zone-aware article extraction facade that exists in `src/services/` but is imported by zero files.** It implements exactly the recommended zone-priority-based extraction pattern. The highest-value single action to improve article accuracy is to wire it into `extractLead()` inside `email-analyzer.js` as a replacement for the 500-line inline regex cascade that currently extracts articles from the unzoned body.

This is not a rewrite. It is a targeted swap of one function call.

---
*Architecture research for: pochta-platform email extraction pipeline*
*Researched: 2026-05-25*
