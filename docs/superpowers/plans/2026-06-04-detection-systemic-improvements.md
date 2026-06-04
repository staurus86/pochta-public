# Systemic Detection Improvements (n8n manager feedback) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the товарные-позиции detection so that brand, quantity, description and position count come out correct, by making the structured xlsx/csv attachment the source of truth, repairing broken attachment links, and replacing the "broadcast one value to all positions" body logic with per-row rules.

**Architecture:** The pipeline currently treats the email **body** as the primary source for line items and the **xlsx attachment** as a fallback used only when the body yields zero articles (`email-analyzer.js:1128`). When both exist, the worse source wins and the per-row `brand` from the spreadsheet is silently dropped (`mergeAttachmentLeadData:3249-3258`). We invert this: when a processed structured product sheet is present, its rows become the authoritative `lead.lineItems` (article + name + qty + brand per row). For body-only emails we replace single-value broadcast (`email-analyzer.js:1842,1898`, `siderus-crm-sender.js:48`) with conservative per-position rules. Attachment links are repaired so the manager can verify at all.

**Tech Stack:** Node.js ESM (Node ≥25), `node:test` + `node:assert/strict`, no frameworks. 4-space indent, camelCase. Pure-function unit tests preferred; per-message fixtures captured from production for regression cases.

**Deploy rule (CRITICAL):** Every modified `src/services/*.js` and `public/*` file MUST be copied to the matching `.railway-deploy/src/...` path in the same commit. See `project_railway_deploy` memory.

---

## Feedback → Root Cause Map (verified against code)

| Manager complaint | Count | Root cause (file:line) | Phase |
|---|---|---|---|
| Ссылки/вложения не открываются | 14 | download_url / token / file 404 in `buildAttachmentsForPayload` + storage | 1 |
| Бренд из xlsx не подтянут / частично | 21 | `mergeAttachmentLeadData:3251-3257` drops `item.brand`; `buildOrderFromMail` broadcasts single brand (`siderus-crm-sender.js:48,59`) | 2 |
| «В экселе чёткие данные, берёт из текста» | several | `email-analyzer.js:1128` — xlsx used only when `lead.articles` empty | 2 |
| Описание одно на все позиции | 20 | `email-analyzer.js:1898-1903` broadcasts `productNamePrimary` | 3 |
| Qty не проставлено / нет дефолта 1 | 22 | global `primaryQuantity` broadcast `email-analyzer.js:1842`; no default-1 | 3 |
| 1 товар разбит на 2-3 / задваивание | 17 | body tokenization + `articles_synth` (`email-analyzer.js:1866`) with no canonical row model | 3 |
| Артикул обрезан (составной через пробел) | 10 | `ARTICLE_PATTERN` splits `XXX YYY` | 4 (optional) |
| ИНН/ФИО/компания | 4-6 each | sender extractors | 5 |

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/attachment-content.js` | Parse attachments → per-row `lineItems{article,brand,desc,qty,unit}` | Already correct; no change (brand already produced at `:740`) |
| `src/services/email-analyzer.js` | Assemble `lead.lineItems` from body + attachment | **Phase 2:** keep brand in merge; prefer structured sheet. **Phase 3:** conservative broadcast |
| `src/services/siderus-crm-sender.js` | Build `order_from_mail` payload | **Phase 2:** read `item.brand` per row. **Phase 1:** attachment URL audit |
| `tests/feedback-positions.test.js` | New: per-message_key regression suite | Create |
| `tests/xlsx-primary-source.test.js` | New: merge/precedence unit tests | Create |
| `tests/body-broadcast-rules.test.js` | New: conservative broadcast unit tests | Create |
| `scripts/_fetch_feedback_fixtures.mjs` | New: pull real problem messages → fixtures | Create |
| `docs/superpowers/fixtures/` | Captured message fixtures (body + attachmentFiles + current analysis) | Create dir |

---

## Phase 0: Fixtures & Test Harness

Capture the real problem messages from production so later phases can TDD against them.

### Task 0.1: Fixture-fetch script

**Files:**
- Create: `scripts/_fetch_feedback_fixtures.mjs`

- [ ] **Step 1: Write the fetch script**

```javascript
// Pulls each message_key named in n8n feedback to a fixture file:
//   { messageKey, projectId, comment, subject, body, attachmentFiles, currentAnalysis }
// Uses the detail endpoint (full body up to 4000 chars) — see reference_full_body_via_detail_endpoint.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import fs from "node:fs";
import path from "node:path";

const PROD = "https://pochta-production.up.railway.app";
const ADMIN_PASSWORD = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const OUT = "docs/superpowers/fixtures";

const feedback = JSON.parse(fs.readFileSync("data/.n8n_feedback.json", "utf8"));
// dedupe by message_key, keep all distinct comments
const byKey = new Map();
for (const f of feedback) {
    if (!byKey.has(f.message_key)) byKey.set(f.message_key, { key: f.message_key, proj: f.project_id, comments: [] });
    if (f.comments && !byKey.get(f.message_key).comments.includes(f.comments.trim()))
        byKey.get(f.message_key).comments.push(f.comments.trim());
}

const login = await fetch(`${PROD}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "admin", password: ADMIN_PASSWORD }),
});
const { token } = await login.json();

fs.mkdirSync(OUT, { recursive: true });
let ok = 0, fail = 0;
for (const { key, proj, comments } of byKey.values()) {
    try {
        const r = await fetch(`${PROD}/api/projects/${proj}/messages/${encodeURIComponent(key)}`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const m = d.message || d;
        const fixture = {
            messageKey: key, projectId: proj, comments,
            subject: m.subject || "",
            body: m.body || m.analysis?.rawInput?.body || m.bodyPreview || "",
            attachmentFiles: m.attachmentFiles || m.attachments || [],
            currentAnalysis: m.analysis || null,
        };
        fs.writeFileSync(path.join(OUT, `${key}.json`), JSON.stringify(fixture, null, 2));
        ok++;
    } catch (e) {
        console.error(`FAIL ${key}: ${e.message}`); fail++;
    }
}
console.log(`Fixtures: ${ok} ok, ${fail} fail → ${OUT}`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/_fetch_feedback_fixtures.mjs`
Expected: `Fixtures: ~52 ok, N fail → docs/superpowers/fixtures`

- [ ] **Step 3: Commit**

```bash
git add scripts/_fetch_feedback_fixtures.mjs docs/superpowers/fixtures/
git commit -m "test(detection): capture n8n feedback message fixtures"
```

### Task 0.2: Baseline test run

- [ ] **Step 1: Confirm current test suite state**

Run: `npm test 2>&1 | tail -20`
Expected: existing PASS count + known pre-existing failures (docx/xlsx tar on Windows, R.Stahl/Heidenhain KB). Record the number so later phases can prove "no new failures".

---

## Phase 1: Repair attachment links (low risk, unblocks verification)

14 messages: "ссылка не открывается", "файл скачать не смог". The manager cannot verify anything without working links.

### Task 1.1: Diagnose the 14 broken-link messages

**Files:**
- Create: `scripts/_diag_attachment_links.mjs`

- [ ] **Step 1: Write the diagnostic**

```javascript
// For each feedback message mentioning links, build its payload and GET each download_url.
// Classify: 200 (ok), 401/403 (token), 404 (missing on disk/volume), other.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import fs from "node:fs";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

const PROD = "https://pochta-production.up.railway.app";
const ADMIN_PASSWORD = "LgxaZ@ZDgNBXgSpnmTHEW6MC";
const ATT_TOKEN = "fd3d37534b3f64147b70e0e7bf6a622852fa720eeafb36410190f95cbb0dd7bf";
const LINK_KEYS = [
    "ec2086b38efe0c74884ea8a836a6cc70c42400f4","1f093672c9c16514f2252f6a0b1312e2228826db",
    "7e6a1862df84becd2dd0a3123ecdf3e2ba1022fb","a58adcbe536a6cf9d117ed07a6650c6886e5ec85",
    "76400796b9428cd5edae658f7177b41740864e57","d2feefb84d40f2d0ca371a27f8443aed3cf64daa",
    "7aeff728e8bc09b945510860675bd5c193ea581e","8f9c8413243af67d635b3dc93a7933c7d2095d51",
    "3957aeead3636ada7f449867d4a59a8ac7ae3ff4","1ab382c362c58036b99df7c45320ad9ee37d2394",
];
const login = await fetch(`${PROD}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: ADMIN_PASSWORD }) });
const { token } = await login.json();
for (const key of LINK_KEYS) {
    for (const proj of ["project-4-klvrt-mail", "project-3-mailbox-file"]) {
        const r = await fetch(`${PROD}/api/projects/${proj}/messages/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) continue;
        const m = (await r.json()).message;
        const payload = buildSiderusCrmPayload({ id: proj, name: proj }, m, PROD, ATT_TOKEN);
        for (const a of payload.attachments) {
            const probe = await fetch(a.download_url, { method: "GET", signal: AbortSignal.timeout(20000) }).catch(e => ({ status: "ERR " + e.message }));
            console.log(`${key.slice(0,8)} ${probe.status}\t${a.filename}\t${a.download_url}`);
        }
        break;
    }
}
```

- [ ] **Step 2: Run and classify**

Run: `node scripts/_diag_attachment_links.mjs`
Expected: a per-file status table. **Branch on result:**
- All `404` → files absent on the Railway volume (storage/ingest issue) → Task 1.2.
- `401/403` → token mismatch → Task 1.3.
- `200` here but manager saw failure → the URL emitted in the original n8n payload was relative or token-less → Task 1.3.

### Task 1.2: (if 404) Confirm whether attachments are stored at all

- [ ] **Step 1:** Check `GET /api/attachments/:messageKey` listing for one 404 key (via authenticated fetch) and inspect server logs for ingest of that messageKey. If files were never persisted (n8n-only ingest path skips download), record this as an ingest gap and surface to user — do NOT fabricate a fix. This is the documented "вложение 404 (НИКИМТ)" case from memory; the fix is in the ingest path, not the payload.

- [ ] **Step 2:** Write findings to `docs/superpowers/fixtures/_attachment_link_diagnosis.md` and STOP this phase for user decision if root cause is missing-storage (out of detection scope).

### Task 1.3: (if token/relative) Fix the emitted URL

**Files:**
- Modify: `src/services/siderus-crm-sender.js:99-120` (`buildAttachmentsForPayload`)
- Test: `tests/xlsx-primary-source.test.js` (reuse file)

- [ ] **Step 1: Write the failing test** (asserts absolute URL with token)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

test("attachment download_url is absolute and carries the token", () => {
    const msg = { messageKey: "abc", attachmentFiles: [{ filename: "req.xlsx", safeName: "req.xlsx" }], analysis: { lead: {}, sender: {} } };
    const p = buildSiderusCrmPayload({ id: "p4", name: "P4" }, msg, "https://pochta-production.up.railway.app", "TKN");
    assert.equal(p.attachments.length, 1);
    assert.match(p.attachments[0].download_url, /^https:\/\/pochta-production\.up\.railway\.app\/api\/attachments\/abc\/req\.xlsx\?token=TKN$/);
});
```

- [ ] **Step 2:** Run: `node --test tests/xlsx-primary-source.test.js` — expect PASS if current code is already correct (memory says commit `571a3e1` fixed token). If PASS, the bug is elsewhere (Task 1.2 path). If FAIL, fix `buildAttachmentsForPayload` to always prefix `baseUrl` and append `tokenSuffix`. Then re-run → PASS.

- [ ] **Step 3: Commit** (copy to `.railway-deploy/` first)

```bash
cp src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js
git add src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js tests/xlsx-primary-source.test.js
git commit -m "fix(attachments): guarantee absolute tokenized download_url"
```

---

## Phase 2: Structured attachment as source of truth

The biggest lever. When a processed product sheet (xlsx/csv/tsv or category product_request/specification) is present, its rows are authoritative for `order_from_mail`, including per-row brand.

### Task 2.1: Keep per-row brand in `mergeAttachmentLeadData`

**Files:**
- Modify: `src/services/email-analyzer.js:3249-3288`
- Test: `tests/xlsx-primary-source.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { __test__ } from "../src/services/email-analyzer.js"; // see Step 3 for export
test("mergeAttachmentLeadData preserves per-row brand from spreadsheet", () => {
    const lead = { lineItems: [], articles: [], productNames: [] };
    const attachmentAnalysis = { files: [{ filename: "order.xlsx", status: "processed", category: "product_request", ext: ".xlsx",
        lineItems: [
            { article: "IFM-AB1", brand: "IFM", descriptionRu: "Датчик", quantity: 5, unit: "шт", source: "attachment:order.xlsx" },
            { article: "RU-100", brand: "Росизделие", descriptionRu: "Клапан", quantity: 10, unit: "шт", source: "attachment:order.xlsx" },
        ] }] };
    const out = __test__.mergeAttachmentLeadData(lead, attachmentAnalysis);
    assert.equal(out.lineItems.find(i => i.article === "IFM-AB1").brand, "IFM");
    assert.equal(out.lineItems.find(i => i.article === "RU-100").brand, "Росизделие");
});
```

- [ ] **Step 2: Run** — Run: `node --test tests/xlsx-primary-source.test.js` — Expected: FAIL (brand is `undefined`; merge drops it).

- [ ] **Step 3: Implement** — at `email-analyzer.js:3251-3257` add `brand` to the mapped object:

```javascript
    const attachmentLineItems = files.flatMap((file) => (file.lineItems || []).map((item) => {
        const article = item.article ? normalizeArticleCode(item.article) : null;
        return {
            article: article && !isObviousArticleNoise(article, item.descriptionRu || "") ? article : null,
            quantity: item.quantity ?? null,
            unit: item.unit || "шт",
            descriptionRu: item.descriptionRu || null,
            brand: item.brand || null,
            source: item.source || `attachment:${file.filename || "file"}`
        };
    }));
```

And in the merge-backfill block at `:3284-3287` add a brand backfill line:

```javascript
        if ((!existing.quantity || existing.quantity === 1) && item.quantity) existing.quantity = item.quantity;
        if ((!existing.descriptionRu || existing.descriptionRu === existing.article) && item.descriptionRu) existing.descriptionRu = item.descriptionRu;
        if (!existing.unit && item.unit) existing.unit = item.unit;
        if (!existing.brand && item.brand) existing.brand = item.brand;
        if (!existing.source && item.source) existing.source = item.source;
```

Add a test-only export near the bottom of `email-analyzer.js` (search for existing `export` block; if none, add):

```javascript
export const __test__ = { mergeAttachmentLeadData, buildOrderFromMailRules };
```

(Define `buildOrderFromMailRules` only if referenced; otherwise export just `mergeAttachmentLeadData`.)

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/xlsx-primary-source.test.js
git commit -m "fix(positions): keep per-row brand from spreadsheet line items"
```

### Task 2.2: `buildOrderFromMail` reads per-row brand

**Files:**
- Modify: `src/services/siderus-crm-sender.js:35-90`
- Test: `tests/xlsx-primary-source.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";
test("order_from_mail uses each item's own brand, not a broadcast brand", () => {
    const lead = { detectedBrands: ["IFM"], lineItems: [
        { article: "IFM-AB1", brand: "IFM", descriptionRu: "Датчик", quantity: 5 },
        { article: "RU-100", brand: "Росизделие", descriptionRu: "Клапан", quantity: 10 },
    ] };
    const p = buildSiderusCrmPayload({ id: "p4", name: "P4" }, { analysis: { lead, sender: {} } }, "https://x", "T");
    const byArt = Object.fromEntries(p.order_from_mail.map(o => [o.item_number, o.brand]));
    assert.equal(byArt["IFM-AB1"], "IFM");
    assert.equal(byArt["RU-100"], "Росизделие"); // NOT broadcast "IFM"
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`RU-100` brand comes back as `IFM` via `brandFallback`).

- [ ] **Step 3: Implement** — in `buildOrderFromMail` change the brand resolution to prefer the line item's own brand:

```javascript
        .map((item) => ({
            brand: item.brand
                || articleBrandMap.get(normalizeArticleCode(item.article).toLowerCase())
                || brandFallback,
            desc: item.descriptionRu || null,
            item_number: item.article,
            quantity: item.quantity != null ? Number(item.quantity) : null
        }));
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js
git add src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js tests/xlsx-primary-source.test.js
git commit -m "fix(positions): order_from_mail honors per-item brand"
```

### Task 2.3: Structured sheet becomes primary (replace, not fallback)

**Files:**
- Modify: `src/services/email-analyzer.js` — add a precedence step AFTER `mergeAttachmentLeadData` (line ~1098) and BEFORE the body-derived synthesis/backfill blocks (~1820).
- Test: `tests/xlsx-primary-source.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
test("when a processed product sheet exists, its rows define positions (not body's split tokens)", () => {
    // Body produced 3 articles (wrongly split); sheet has 1 authoritative row.
    const lead = { articles: ["A 1", "A", "1"], lineItems: [
        { article: "A 1", descriptionRu: null, quantity: null, source: "body" },
        { article: "A", descriptionRu: null, quantity: null, source: "body" },
        { article: "1", descriptionRu: null, quantity: null, source: "body" },
    ] };
    const files = [{ filename: "zayavka.xlsx", status: "processed", category: "product_request", ext: ".xlsx",
        lineItems: [{ article: "A 1", brand: "ABB", descriptionRu: "Контактор A 1", quantity: 2, unit: "шт", source: "attachment:zayavka.xlsx" }] }];
    const out = __test__.applyStructuredSheetPrimacy(lead, { files });
    assert.equal(out.lineItems.length, 1);
    assert.equal(out.lineItems[0].article, "A 1");
    assert.equal(out.lineItems[0].brand, "ABB");
    assert.equal(out.lineItems[0].quantity, 2);
    assert.equal(out.lineItems[0].descriptionRu, "Контактор A 1");
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`applyStructuredSheetPrimacy` not defined).

- [ ] **Step 3: Implement** — add the function and wire it in. Define near `mergeAttachmentLeadData`:

```javascript
// When the email carries a PROCESSED structured product sheet (xlsx/csv/tsv or a
// product_request/specification doc with real rows), that sheet is the ground truth
// for positions — the body's tokenized articles are noisy by comparison. Replace
// body-derived line items with the sheet rows. Requisites/invoice files never qualify.
function applyStructuredSheetPrimacy(lead, attachmentAnalysis = {}) {
    const files = attachmentAnalysis.files || [];
    const STRUCTURED_EXT = new Set([".xlsx", ".csv", ".tsv"]);
    const sheetRows = files
        .filter((f) => f.status === "processed"
            && f.category !== "requisites" && f.category !== "invoice"
            && (STRUCTURED_EXT.has(f.ext) || f.category === "product_request" || f.category === "specification")
            && Array.isArray(f.lineItems)
            && f.lineItems.some((it) => it.article || it.descriptionRu))
        .flatMap((f) => f.lineItems.map((it) => {
            const article = it.article ? normalizeArticleCode(it.article) : null;
            return {
                article: article && !isObviousArticleNoise(article, it.descriptionRu || "") ? article : (article || null),
                brand: it.brand || null,
                descriptionRu: it.descriptionRu || null,
                quantity: it.quantity ?? null,
                unit: it.unit || "шт",
                source: it.source || `attachment:${f.filename || "sheet"}`,
                explicitArticle: Boolean(article)
            };
        }))
        .filter((it) => it.article || it.descriptionRu);
    if (sheetRows.length === 0) return lead;

    lead.lineItems = sheetRows;
    lead.articles = unique(sheetRows.map((r) => r.article).filter(Boolean));
    lead.productNames = sheetRows
        .filter((r) => r.article && r.descriptionRu)
        .map((r) => ({ article: r.article, name: r.descriptionRu, category: null, source: r.source }));
    lead.totalPositions = sheetRows.length;
    lead.positionsSource = "structured_attachment";
    return lead;
}
```

Wire it immediately after the `lead = mergeAttachmentLeadData(...)` assignment block (after line ~1101, before the quoted/body fallbacks at 1108):

```javascript
  lead = applyStructuredSheetPrimacy(lead, attachmentAnalysis);
```

Guard the downstream broadcast/synthesis blocks so they do NOT overwrite a structured-sheet lead. At the top of the backfill region (`email-analyzer.js:~1825`, before the qty backfill) wrap the synthesis/broadcast in:

```javascript
      if (lead.positionsSource !== "structured_attachment") {
          // ... existing qty backfill (1825) + articles_synth (1852) + desc broadcast (1886) blocks ...
      }
```

Add `applyStructuredSheetPrimacy` to the `__test__` export.

- [ ] **Step 4: Run** — Expected: PASS. Then run the full suite: `npm test 2>&1 | tail -20` — Expected: no NEW failures vs Phase 0 baseline. Investigate any new failure before continuing.

- [ ] **Step 5: Per-message fixtures** — write `tests/feedback-positions.test.js` cases for the xlsx-source complaints, loading fixtures and asserting position count matches the manager's stated count:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeEmail } from "../src/services/email-analyzer.js";

function load(key) { return JSON.parse(fs.readFileSync(`docs/superpowers/fixtures/${key}.json`, "utf8")); }
function analyze(fx) {
    return analyzeEmail({ id: fx.projectId, name: fx.projectId, brands: [] }, {
        subject: fx.subject, body: fx.body,
        attachmentFiles: fx.attachmentFiles, messageKey: fx.messageKey,
    });
}

// 7e6a1862: "у клиента в файле 9 позиций ... плохо все определил" → expect 9 positions
test("7e6a1862: positions match the 9-row spreadsheet", () => {
    const fx = load("7e6a1862df84becd2dd0a3123ecdf3e2ba1022fb");
    const r = analyze(fx);
    const pos = (r.lead.lineItems || []).filter(i => i.article && !/^DESC:/i.test(i.article));
    assert.equal(pos.length, 9);
});
```

NOTE: `analyzeEmail` reads attachment bytes from disk via `analyzeStoredAttachments(messageKey, attachmentFiles)`. Fixtures only carry metadata, not bytes. If the fixture's attachment is not present under `ATTACHMENTS_ROOT/<messageKey>/`, this E2E assertion cannot run locally. **Branch:** if attachment bytes are unavailable, downgrade these to `mergeAttachmentLeadData`/`applyStructuredSheetPrimacy` unit tests fed by `fx.currentAnalysis` (which already contains the parsed attachment `files[].lineItems` from production). Prefer the unit path — it is deterministic and needs no disk state.

- [ ] **Step 6: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/xlsx-primary-source.test.js tests/feedback-positions.test.js
git commit -m "feat(positions): structured attachment is source of truth for line items"
```

---

## Phase 3: Conservative body-only position rules (highest regression surface)

For emails with NO structured sheet (`positionsSource !== "structured_attachment"`). Replace "broadcast one value to all" with rules that never invent cross-position data.

### Task 3.1: Never broadcast brand across multiple positions

**Files:**
- Modify: `src/services/siderus-crm-sender.js:48` (`brandFallback`)
- Test: `tests/body-broadcast-rules.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSiderusCrmPayload } from "../src/services/siderus-crm-sender.js";

test("single detected brand is NOT broadcast onto >1 brandless positions", () => {
    const lead = { detectedBrands: ["IFM"], lineItems: [
        { article: "X1", descriptionRu: "a", quantity: 1 },
        { article: "X2", descriptionRu: "b", quantity: 1 },
        { article: "X3", descriptionRu: "c", quantity: 1 },
    ] };
    const p = buildSiderusCrmPayload({ id: "p", name: "p" }, { analysis: { lead, sender: {} } }, "https://x", "T");
    assert.deepEqual(p.order_from_mail.map(o => o.brand), [null, null, null]);
});

test("single detected brand IS applied when there is exactly one position", () => {
    const lead = { detectedBrands: ["IFM"], lineItems: [{ article: "X1", descriptionRu: "a", quantity: 1 }] };
    const p = buildSiderusCrmPayload({ id: "p", name: "p" }, { analysis: { lead, sender: {} } }, "https://x", "T");
    assert.equal(p.order_from_mail[0].brand, "IFM");
});
```

- [ ] **Step 2: Run** — Expected: first test FAILS (all three get "IFM").

- [ ] **Step 3: Implement** — `siderus-crm-sender.js:48`:

```javascript
    // Broadcast a single detected brand ONLY when there is exactly one position.
    // Multiple positions with one detected brand → leave brandless rather than mislabel.
    const brandFallback = (detectedBrands.length === 1 && lineItems.filter((i) => i.article && !i.article.startsWith("DESC:")).length === 1)
        ? mainBrand : null;
```

(Per-item `item.brand` and KB `articleBrandMap` still apply from Phase 2.)

- [ ] **Step 4: Run** — Expected: PASS both.

- [ ] **Step 5: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js
git add src/services/siderus-crm-sender.js .railway-deploy/src/services/siderus-crm-sender.js tests/body-broadcast-rules.test.js
git commit -m "fix(brand): do not broadcast one brand across multiple positions"
```

### Task 3.2: Description broadcast only for a single position

**Files:**
- Modify: `src/services/email-analyzer.js:1891-1908`
- Test: `tests/body-broadcast-rules.test.js`

- [ ] **Step 1: Write the failing test** — feed a lead with 3 brandless/descless body items + one `productNamePrimary`, run the broadcast block via an exported helper `applyDescBroadcast(lead)` (extract the block at 1886-1908 into a named function and export via `__test__`). Assert only-single-position broadcast:

```javascript
import { __test__ } from "../src/services/email-analyzer.js";
test("desc broadcast skipped when multiple positions and multiple names", () => {
    const lead = { productNamePrimary: "Датчик", productNamesClean: ["Датчик", "Клапан"], lineItems: [
        { article: "X1", descriptionRu: null, source: "body" },
        { article: "X2", descriptionRu: null, source: "body" },
    ] };
    __test__.applyDescBroadcast(lead);
    assert.deepEqual(lead.lineItems.map(i => i.descriptionRu), [null, null]);
});
test("desc broadcast applied when exactly one position", () => {
    const lead = { productNamePrimary: "Датчик", productNamesClean: ["Датчик"], lineItems: [
        { article: "X1", descriptionRu: null, source: "body" },
    ] };
    __test__.applyDescBroadcast(lead);
    assert.equal(lead.lineItems[0].descriptionRu, "Датчик");
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`applyDescBroadcast` not exported).

- [ ] **Step 3: Implement** — extract lines 1886-1908 into:

```javascript
function applyDescBroadcast(lead) {
    if (!Array.isArray(lead.lineItems) || !lead.productNamePrimary || !Array.isArray(lead.productNamesClean)) return lead;
    const realItems = lead.lineItems.filter((li) => li && !String(li.article || "").toUpperCase().startsWith("DESC:"));
    const needsDesc = realItems.filter((li) => !li.descriptionRu && (li.source === "body" || li.source === "articles_synth"));
    // Broadcast only when the assignment is unambiguous: exactly one position.
    const shouldBackfill = realItems.length === 1 && needsDesc.length === 1;
    if (shouldBackfill) {
        lead.lineItems = lead.lineItems.map((li) => {
            if (!li || li.descriptionRu || String(li.article || "").toUpperCase().startsWith("DESC:")) return li;
            const src = li.source || "";
            return (src === "body" || src === "articles_synth") ? { ...li, descriptionRu: lead.productNamePrimary } : li;
        });
    }
    return lead;
}
```

Replace the inline block at 1891-1908 with `applyDescBroadcast(lead);` (still inside the `positionsSource !== "structured_attachment"` guard from Phase 2). Add to `__test__` export.

NOTE: this drops the old `cleanCount === 1` branch that broadcast a single product name onto MANY positions — that branch is exactly the "описание одно на все" complaint, so removing it is intended.

- [ ] **Step 4: Run** — Expected: PASS. Then `npm test 2>&1 | tail -20` — no new failures.

- [ ] **Step 5: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/body-broadcast-rules.test.js
git commit -m "fix(desc): broadcast product name only for single-position emails"
```

### Task 3.3: Default qty=1 only for a single position with no qty anywhere

Manager: "кол-во клиент не указал ... по-хорошему должна проставлять по умолчанию 1шт." Apply narrowly to avoid regressions.

**Files:**
- Modify: `src/services/email-analyzer.js` — add after the qty backfill block (~1850), inside the body-only guard.
- Test: `tests/body-broadcast-rules.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { __test__ } from "../src/services/email-analyzer.js";
test("default qty=1 when exactly one position and no qty anywhere", () => {
    const lead = { lineItems: [{ article: "X1", descriptionRu: "a", quantity: null }], quantitiesClean: [], primaryQuantity: null };
    __test__.applyDefaultSingleQty(lead);
    assert.equal(lead.lineItems[0].quantity, 1);
    assert.equal(lead.lineItems[0].unit, "шт");
});
test("no default qty when multiple positions", () => {
    const lead = { lineItems: [
        { article: "X1", descriptionRu: "a", quantity: null },
        { article: "X2", descriptionRu: "b", quantity: null },
    ], quantitiesClean: [], primaryQuantity: null };
    __test__.applyDefaultSingleQty(lead);
    assert.deepEqual(lead.lineItems.map(i => i.quantity), [null, null]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```javascript
function applyDefaultSingleQty(lead) {
    if (!Array.isArray(lead.lineItems)) return lead;
    const real = lead.lineItems.filter((li) => li && li.article && !String(li.article).toUpperCase().startsWith("DESC:"));
    const anyQty = real.some((li) => li.quantity != null) || (lead.primaryQuantity != null) || (Array.isArray(lead.quantitiesClean) && lead.quantitiesClean.length > 0);
    if (real.length === 1 && !anyQty && real[0].quantity == null) {
        real[0].quantity = 1;
        real[0].unit = real[0].unit || "шт";
        real[0].quantityDefaulted = true;
    }
    return lead;
}
```

Wire `applyDefaultSingleQty(lead);` after the qty backfill block (~1850), inside the body-only guard. Add to `__test__`.

- [ ] **Step 4: Run** — Expected: PASS. Then `npm test` — no new failures.

- [ ] **Step 5: Commit** (copy to `.railway-deploy/`)

```bash
cp src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js
git add src/services/email-analyzer.js .railway-deploy/src/services/email-analyzer.js tests/body-broadcast-rules.test.js
git commit -m "feat(qty): default qty=1 for single-position emails with no quantity"
```

---

## Phase 4 (optional, higher risk): Composite article via space

10 emails: "артикулы двусоставные через пробел ... обрезаны/съехали". This touches `ARTICLE_PATTERN` and has a wide regression surface (already attempted once, commit `5803016`). **Do not start without a fresh research pass** confirming the current pattern still truncates on the fixtures. Treat as a separate plan if needed. Out of scope for this plan unless Phase 2 fixtures show it dominates.

---

## Phase 5 (lower priority): sender fields

ИНН not detected though card exists (4), ФИО of contact wrong (6), company name wrong (6). These are independent extractor fixes (fio-extractor, company-extractor, crm-matcher INN backfill). Each is a small TDD task driven by its fixture. Schedule after Phases 1-3 land, since the manager's dominant theme is positions.

---

## Verification & rollout (after Phases 1-3)

- [ ] **Full suite green:** `npm test 2>&1 | tail -20` — only the Phase 0 pre-existing failures remain.
- [ ] **Deploy:** confirm BOTH `src/` and `.railway-deploy/src/` updated for every changed file (grep the diff). Push only on explicit user request (memory: never push without ask).
- [ ] **Smoke after deploy:** `GET /api/health` → 200; reanalyze 3 fixture messages via `POST /api/projects/:id/analyze` and confirm `order_from_mail` matches manager expectations (correct position count, per-row brand, qty present).
- [ ] **DO NOT auto-resend to n8n.** Resending is a sending endpoint — only on explicit user command (memory: `feedback_no_production_api_without_request`).
- [ ] **Report:** changed files + test result + 3 before/after `order_from_mail` examples.

---

## Self-Review notes

- **Coverage:** every feedback category in the map has a phase (links→1, brand→2.1/2.2/3.1, xlsx-source→2.3, desc→3.2, qty→3.3, split-positions→2.3, composite-article→4, sender→5).
- **Type consistency:** new helpers `applyStructuredSheetPrimacy`, `applyDescBroadcast`, `applyDefaultSingleQty`, `mergeAttachmentLeadData` all take/return `lead`; all exported via a single `__test__` object. `order_from_mail` item shape `{brand, desc, item_number, quantity}` is unchanged.
- **Risk gating:** Phases ordered low→high regression surface; each phase ends with full-suite check vs Phase 0 baseline; the structured-sheet guard prevents Phase 3 broadcast from touching sheet-sourced leads.
- **Open dependency:** Phase 2.3 E2E fixtures need attachment bytes on disk; the plan provides a unit-level fallback fed by `fx.currentAnalysis.files[].lineItems` so the work is not blocked.
