# Phase 10: Audit Baseline — Research

**Researched:** 2026-05-25
**Domain:** Automated detection audit, n8n feedback integration, per-field accuracy measurement
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUDIT-01 | Agents run manual audit of 50 real production emails, producing structured bug report with errors per field (ФИО, ИНН, телефон, артикул, бренд, кол-во, название товара) | `_audit_100.py` pattern: auth→fetch→sample→score per field. 50 emails = half the existing 100-letter audit script |
| AUDIT-02 | Automated audit script measures % of correct values per field — baseline before fixes and after each | `audit_prod_json.py` + `audit_entity_extraction.py` patterns combined; per-field % needs NEW script targeting the 7 fields explicitly |
| AUDIT-03 | n8n manager feedback loaded via GET endpoint and displayed in audit report as additional signal | `validation-feedback-sync.js` + `GET /api/admin/validation-feedback` already exist; script must READ this endpoint and correlate with audited emails |
</phase_requirements>

---

## Summary

Phase 10 establishes a measurable quality baseline across 7 detection fields. The project already has rich audit infrastructure (19 Python audit scripts, 1 Node.js audit script) but none of them produce the exact per-field percentage table that phases 11-14 will need to compute deltas against.

The core deliverable is a new `scripts/audit_baseline.py` that: (1) fetches a deterministic sample of ~300 client emails from production, (2) runs heuristic correctness checks on each of the 7 fields, (3) fetches n8n validation feedback via the existing GET endpoint and correlates it by `message_key`, and (4) writes `data/baseline_v1.json` that future runs can diff against.

For AUDIT-01 (manual audit of 50 emails), the closest existing pattern is `scripts/_audit_100.py` which fetches and prints letter-by-letter detail. A new `scripts/audit_sample_50.py` or adaptation of `_audit_100.py` produces the human-readable structured bug report.

**Primary recommendation:** Write one new Python script `scripts/audit_baseline.py` that does automated per-field measurement + n8n signal, and adapt `_audit_100.py` to output structured JSON for the 50-email manual report. Save `data/baseline_v1.json` as the persistent baseline file.

---

## Project Constraints (from CLAUDE.md)

- Use `python` (not `python3`) on this Windows PC
- Node.js >= 25, ESM modules, `node:sqlite` DatabaseSync — but audit scripts are Python
- Deploy: ALWAYS copy changes to BOTH `src/` AND `.railway-deploy/src/` (not relevant to audit scripts only)
- No frameworks — `node:http`, `node:fs`, `node:crypto` only in server code
- 4 spaces for indentation
- Tests are plain Node.js with `node:assert` and `node:test`, no test frameworks
- Production: `https://pochta-production.up.railway.app/` — admin / LgxaZ@ZDgNBXgSpnmTHEW6MC
- `NEVER` call `/crm-resend` or sending endpoints without explicit user command
- `NEVER` run multiple unrelated changes simultaneously

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib: `json`, `urllib.request`, `urllib.parse`, `re`, `sqlite3` | Python 3.14 (stdlib) | HTTP requests to prod API, JSON parsing, SQLite KB queries | Already used in all 19 existing audit scripts |
| `io`, `sys`, `collections.Counter` | Python 3.14 (stdlib) | UTF-8 output, argument parsing, frequency counts | Pattern established in all scripts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `openpyxl` | Latest (already in requirements.txt) | XLSX export of baseline report | When human-readable spreadsheet is also needed |
| `random` (stdlib) | Python 3.14 | Deterministic sampling with fixed seed | `random.seed(42)` used in `_audit_100.py` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Python script | Node.js `.mjs` script | Node.js is used for `_select_and_send_10.mjs` but ALL existing audit scripts are Python; keep consistency |
| Fetching live from API | Reading from local JSON snapshot | Local snapshot (`data/prod-messages-*.json`) avoids network but goes stale; live fetch is canonical for baseline |

**Installation:** No new dependencies needed. All required libraries are Python stdlib or already in `requirements.txt`.

---

## Architecture Patterns

### Recommended Project Structure

```
scripts/
├── audit_baseline.py          # NEW: per-field % baseline + n8n signal (AUDIT-02, AUDIT-03)
├── audit_sample_50.py         # NEW: structured 50-email manual audit report (AUDIT-01)
data/
├── baseline_v1.json           # NEW: persisted baseline for delta comparisons
├── audit_sample_50_report.json  # NEW: structured bug report from manual 50-email audit
```

### Pattern 1: Live API Fetch + Field Scoring

The canonical pattern from `_audit_100.py` and `fetch_prod_and_audit.py`:

```python
# Source: scripts/_audit_100.py + scripts/fetch_prod_and_audit.py
BASE = "https://pochta-production.up.railway.app"
PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"]

def login():
    body = json.dumps({"login": "admin", "password": "LgxaZ@ZDgNBXgSpnmTHEW6MC"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["token"]

def api(path, token):
    req = urllib.request.Request(BASE + path,
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())
```

### Pattern 2: Per-Field Heuristic Correctness

Fields in the analysis output JSON (verified by live inspection of `prod-messages-p4-fresh.json`):

```
message fields:       id, messageKey, subject, from, bodyPreview, pipelineStatus
analysis.sender:      fullName, companyName, inn, mobilePhone, cityPhone, position, sources
analysis.lead:        articles, lineItems, detectedBrands, productNames, totalPositions
analysis.classification: label, confidence
analysis.lead.detectedBrands  (also at analysis.detectedBrands — both exist)
```

**7-field correctness heuristics** (what "correct" means without ground truth):

| Field | "Present" check | "Noise" check |
|-------|----------------|--------------|
| ФИО (`sender.fullName`) | Non-empty, not "Не Определено", not "Не определено" | Contains org keyword (ООО/АО/LLC), contains job title, is multiline |
| ИНН (`sender.inn`) | Non-empty, 10 or 12 digits after stripping `.0` | Ends with `.0` (float artifact); length not 10/12 |
| Телефон (`sender.mobilePhone` or `sender.cityPhone`) | Non-empty | Contains own-domain fragments (siderus.ru); length not 10-11 digits |
| Артикул (`lead.articles`) | Non-empty array for Клиент emails | Cyr-only without digits; UUID pattern; year 19xx/20xx; email local-part; single/double digit |
| Бренд (`analysis.detectedBrands` or `lead.detectedBrands`) | Non-empty array for Клиент emails | Not grounded in body/subject/attachment (ghost-brand check from `audit_prod_json.py`) |
| Кол-во (`lead.lineItems[].quantity` or `lead.totalPositions`) | At least one lineItem with quantity for emails that have articles | qty=0 when articles exist |
| Название товара (`lead.productNames`) | Non-empty for emails with articles | Raw numbered list format `"1. Название — N шт."` |

### Pattern 3: n8n Feedback Correlation

The GET endpoint and its schema are already implemented in `src/services/validation-feedback-sync.js`:

```python
# Source: reference_n8n_validation_webhook.md + validation-feedback-sync.js
N8N_FEEDBACK_URL = "https://test-n8n.siderus.online/webhook/b0bc08e6-178b-4b7b-a989-b07acd19f90b"
# Auth: same Bearer token as POST webhook — SIDERUS_CRM_AUTH_TOKEN env var
# Response: {"comments": "...", "verification": "...", "message_key": "...", "project_id": "..."}
# verification="" means not yet reviewed; "есть замечания" = needs_rework; "принято"/"ok" = approved

# Alternative: use existing server endpoint to avoid direct n8n call
# GET /api/admin/validation-feedback?limit=500 (requires admin Bearer token)
# Returns: {data: [{project_id, message_key, manager_validation: {verdict, comments}}], meta}
```

**Recommendation:** Use `GET /api/admin/validation-feedback` (the local server endpoint) rather than calling n8n directly. This is safer — it reads from `projects.json` (already synced) rather than hitting n8n's server. Only use `POST /api/admin/sync-validation-feedback` when an explicit sync is needed.

### Pattern 4: Baseline Persistence Schema

```json
{
  "version": 1,
  "created_at": "2026-05-25T...",
  "sample_size": 300,
  "sample_seed": 42,
  "projects": ["project-3-mailbox-file", "project-4-klvrt-mail"],
  "fields": {
    "fio":     {"present": 0.72, "noise_free": 0.65, "n": 300},
    "inn":     {"present": 0.45, "noise_free": 0.44, "n": 300},
    "phone":   {"present": 0.51, "noise_free": 0.50, "n": 300},
    "article": {"present": 0.58, "noise_free": 0.43, "n": 300},
    "brand":   {"present": 0.58, "noise_free": 0.48, "n": 300},
    "qty":     {"present": 0.40, "noise_free": 0.38, "n": 300},
    "product_name": {"present": 0.35, "noise_free": 0.30, "n": 300}
  },
  "n8n_signal": {
    "total_with_feedback": 0,
    "approved": 0,
    "needs_rework": 0,
    "not_reviewed": 0
  },
  "raw_message_ids": ["..."]
}
```

### Anti-Patterns to Avoid

- **Hardcoded message sample in baseline** — must use deterministic seed (`random.seed(42)`) so future runs get the same sample when computing deltas
- **Saving baseline to `data/` with a date in filename** — previous scripts use date-stamped JSON files (`prod-messages-2026-04-19-*.json`); baseline must be a stable filename `baseline_v1.json` so delta scripts can find it automatically
- **Calling `POST /api/admin/sync-validation-feedback`** during audit — that sends data TO n8n; just READ with GET
- **Mixing manual audit output with automated metric** — AUDIT-01 (50-email bug report) and AUDIT-02 (statistical %) are separate deliverables; keep them in separate scripts
- **Using `python3`** on this machine — the shell alias `python3` is broken; always use `python`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ghost brand detection | Custom text-matching logic | Copy `is_brand_grounded()` from `audit_prod_json.py` | Already battle-tested against KB, handles aliases, attachments, articles |
| Bad article detection | New heuristic list | Copy `bad_articles()` from `audit_prod_json.py` | Covers year/UUID/desc/cyr-only/short-num/localpart categories |
| Fetching messages from API | New HTTP client | Copy `api()` + `login()` pattern from `_audit_100.py` | Handles auth, timeout, project looping |
| n8n feedback reading | Direct n8n call | Use `GET /api/admin/validation-feedback` with admin token | Server already normalizes and persists records from n8n |
| Baseline file management | Custom versioning | Single `data/baseline_v1.json`, increment version manually | Simplest approach that works; no infra overhead |

**Key insight:** 90% of the logic already exists in audit scripts. The main work is composing existing patterns into one script that: (a) covers all 7 fields, (b) saves a structured JSON baseline, and (c) includes n8n signal.

---

## Common Pitfalls

### Pitfall 1: pipelineStatus filter — counting wrong population
**What goes wrong:** Counting ALL messages including spam gives misleadingly high "no ФИО" rates, since spam messages legitimately have no sender fields.
**Why it happens:** Scripts loop over all messages without filtering by `classification.label == 'Клиент'`.
**How to avoid:** Always filter `[m for m in msgs if classification.label == 'Клиент']` before field checks. Reference: every existing audit script does this.
**Warning signs:** % of missing ФИО > 40% — that's a signal spam is included.

### Pitfall 2: detectedBrands location — two places in JSON
**What goes wrong:** Brand count is 0 even though brands were detected.
**Why it happens:** Brands live in BOTH `analysis.detectedBrands` AND `analysis.lead.detectedBrands`. The correct authoritative location varies.
**How to avoid:** Use `a.get('detectedBrands') or l.get('detectedBrands') or []` — pattern taken directly from `audit_cycle_snapshot.py` line 105.
**Warning signs:** Brand present % significantly lower than expected 58%.

### Pitfall 3: INN .0 float artifact
**What goes wrong:** INN `7701234567.0` counts as non-zero but is malformed.
**Why it happens:** JSON float serialization from older analysis runs.
**How to avoid:** Always strip `.0` suffix before length check: `inn_digits = re.sub(r'\D', '', str(inn).split('.')[0])`.
**Warning signs:** Suspiciously high INN count with audits showing errors in INN formatting.

### Pitfall 4: Sample size for delta measurements
**What goes wrong:** A 50-email sample has ±14% statistical noise at 95% CI — a "fix" improving accuracy by 10% will be invisible in the noise.
**Why it happens:** Too small sample.
**How to avoid:** Use 200-300 emails for automated baseline (AUDIT-02). The manual 50-email audit (AUDIT-01) is for qualitative bug description, not statistical measurement.
**Warning signs:** Deltas after Phase 11/12 fixes look smaller than expected.

### Pitfall 5: n8n feedback endpoint SSL
**What goes wrong:** `urllib.request.urlopen` fails with SSL cert error on `test-n8n.siderus.online`.
**Why it happens:** The n8n server uses a cert not in standard bundles — documented in `siderus-crm-sender.js` comment: "n8n test server uses a cert not in Node's bundle".
**How to avoid:** Use `ssl.create_default_context()` with `check_hostname=False` and `verify_mode=ssl.CERT_NONE`, OR use the platform's `GET /api/admin/validation-feedback` which avoids direct n8n SSL.
**Warning signs:** `ssl.SSLCertVerificationError` when calling n8n URL directly.

### Pitfall 6: baseline_v1.json sample must be reproducible
**What goes wrong:** Running the delta script after Phase 11 uses a DIFFERENT sample than the original baseline, so delta numbers are meaningless.
**Why it happens:** Random sampling without persisting which message IDs were in the sample.
**How to avoid:** Persist `raw_message_ids` in `baseline_v1.json`. Delta scripts must check: if the same IDs are available, use them; if not, warn and use a fallback.

---

## Code Examples

### Fetching all Клиент messages from both projects

```python
# Source: scripts/_audit_100.py, scripts/fetch_prod_and_audit.py
import json, urllib.request, urllib.parse, random, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE = "https://pochta-production.up.railway.app"
PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"]
ADMIN_USER = "admin"
ADMIN_PASS = "LgxaZ@ZDgNBXgSpnmTHEW6MC"

def login():
    body = json.dumps({"login": ADMIN_USER, "password": ADMIN_PASS}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["token"]

def api_get(path, token):
    req = urllib.request.Request(BASE + path,
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

token = login()
all_msgs = []
for pid in PROJECTS:
    d = api_get(f"/api/projects/{pid}/messages", token)
    for m in (d.get("messages") or []):
        m["_project_id"] = pid
        all_msgs.append(m)

client_msgs = [m for m in all_msgs
               if ((m.get("analysis") or {}).get("classification") or {}).get("label") == "Клиент"]
print(f"Total Клиент: {len(client_msgs)}")

# Deterministic sample of 300
random.seed(42)
sample = random.sample(client_msgs, min(300, len(client_msgs)))
```

### Per-field correctness check (ФИО example)

```python
# Source: combined from audit_entity_extraction.py + _audit_100.py
import re
ORG_RE = re.compile(r'\b(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|LLC|Ltd\.?|GmbH|JSC)\b', re.U)
TITLE_RE = re.compile(r'\b(?:менеджер|директор|руководитель|специалист|инженер|'
                      r'manager|director|engineer)\b', re.I | re.U)

def check_fio(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    fio = (s.get("fullName") or "").strip()
    if not fio or fio.lower() in ("не определено",):
        return {"present": False, "noise": False}
    is_noise = bool(ORG_RE.search(fio) or TITLE_RE.search(fio) or "\n" in fio)
    return {"present": True, "noise": is_noise}
```

### Ghost brand check (reuse from audit_prod_json.py)

```python
# Source: scripts/audit_prod_json.py (is_brand_grounded function)
# Uses: brand_aliases dict from SQLite, articles list, body+attachment text
# Returns: True if grounded (not a ghost), False if ghost
def is_brand_grounded(brand, body, subject, attachment_text, articles):
    # ... (full implementation in audit_prod_json.py lines 23-47)
```

### Reading n8n feedback via server endpoint

```python
# Source: validation-feedback-sync.js + server.js GET /api/admin/validation-feedback
def fetch_validation_feedback(token, limit=500):
    d = api_get(f"/api/admin/validation-feedback?limit={limit}", token)
    by_key = {}
    for item in (d.get("data") or []):
        mk = item.get("message_key") or item.get("messageKey")
        pid = item.get("project_id")
        mv = item.get("manager_validation") or {}
        if mk:
            by_key[(pid, mk)] = {
                "verdict": mv.get("verdict"),   # "approved", "needs_rework", or None
                "comments": mv.get("comments"),
                "reviewed": bool(mv.get("verdict"))
            }
    return by_key
```

### Saving baseline

```python
import json, datetime

baseline = {
    "version": 1,
    "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    "sample_size": len(sample),
    "sample_seed": 42,
    "projects": PROJECTS,
    "fields": {field: {... metrics ...} for field in FIELDS},
    "n8n_signal": {... n8n counts ...},
    "raw_message_ids": [m.get("messageKey") or m.get("id") for m in sample]
}

with open("data/baseline_v1.json", "w", encoding="utf-8") as f:
    json.dump(baseline, f, ensure_ascii=False, indent=2)
print("Saved: data/baseline_v1.json")
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python (`python`) | All audit scripts | Yes | 3.14.0 | — |
| Node.js | Server, test suite | Yes | 25.2.1 | — |
| Production API (`https://pochta-production.up.railway.app/`) | Fetching live messages | Assumed available | — | Use local `data/prod-messages-p4-fresh.json` as fallback |
| `data/detection-kb.sqlite` | Ghost brand KB lookup | Yes (local) | — | — |
| `data/prod-messages-p4-fresh.json` | Local snapshot fallback | Yes (local) | — | Fall back if API unavailable |
| n8n feedback (`GET /api/admin/validation-feedback`) | AUDIT-03 | Via prod server | — | Skip n8n section if endpoint returns 0 records |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- Production API unavailable: fall back to newest local `data/prod-messages-*.json` snapshot (several exist in `data/`), document in report that baseline is from snapshot not live.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` + `node:assert` (built-in) |
| Config file | None — run directly with `node --test` |
| Quick run command | `node --test tests/batch-j-fixes.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUDIT-01 | Script runs and produces structured bug report JSON | smoke | `python scripts/audit_sample_50.py --dry-run` | ❌ Wave 0 |
| AUDIT-02 | Baseline script runs and produces `data/baseline_v1.json` with 7 per-field % values | smoke | `python scripts/audit_baseline.py --dry-run` | ❌ Wave 0 |
| AUDIT-03 | n8n feedback fetched and recorded in baseline JSON | smoke | included in AUDIT-02 script | ❌ Wave 0 |

Note: These are Python scripts, not Node.js unit tests. The "test" is running them with `--dry-run` (no network) to verify they parse correctly, then running them live to confirm output structure.

### Sampling Rate

- **Per task commit:** Verify script parses without error locally on a small local snapshot
- **Per wave merge:** Full live run against production API, confirm `data/baseline_v1.json` written
- **Phase gate:** Both scripts run successfully; `baseline_v1.json` contains all 7 field metrics with non-zero values

### Wave 0 Gaps

- [ ] `scripts/audit_baseline.py` — covers AUDIT-02 + AUDIT-03 (does not yet exist)
- [ ] `scripts/audit_sample_50.py` — covers AUDIT-01 (does not yet exist)

*(Existing audit scripts are abundant but none matches the exact per-field % + baseline-save requirement)*

---

## Open Questions

1. **Is `--dry-run` mode needed for audit scripts?**
   - What we know: All existing audit scripts run live against prod with no dry-run flag
   - What's unclear: Whether the planner wants CI-safe variants that run on local snapshots
   - Recommendation: Add `--local` flag that reads from newest `data/prod-messages-*.json` instead of live API; avoids credentials in CI

2. **Manual audit process for AUDIT-01 — who is "the agent"?**
   - What we know: AUDIT-01 says "agents conducted manual audit of 50 real emails"
   - What's unclear: Whether this means a human operator or Claude reviews the 50 emails in a session
   - Recommendation: Script produces structured JSON + human-readable console output; a human (or Claude in a session) reviews and annotates the JSON. The "structured bug report" is the annotated JSON.

3. **Should baseline_v1.json be committed to git?**
   - What we know: `data/` is gitignored (likely — typical for data files)
   - What's unclear: Whether baseline should be in `data/` or `scripts/baselines/`
   - Recommendation: Put in `scripts/baselines/baseline_v1.json` so it IS committed to git and delta comparisons work across sessions.

4. **n8n feedback volume**
   - What we know: Only 10-20 emails have been sent to n8n (batches of 10 on May 20-21); feedback may be sparse
   - What's unclear: How many have been reviewed by the manager
   - Recommendation: AUDIT-03 should still succeed even if `feedback_count == 0` — report "0 feedback records found, n8n signal unavailable" rather than failing.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single overall accuracy % | Per-field % (7 separate metrics) | Phase 10 goal | Enables targeted fixes for specific fields |
| Ad-hoc snapshot files (date-stamped) | Stable `baseline_v1.json` with ID list | Phase 10 | Reproducible delta computation across phases |
| Brand accuracy only (ghost brands) | All 7 fields including ФИО/ИНН/phone/qty/product name | Phase 10 | Complete picture of extraction quality |

**Existing audit scripts status:**
- `audit_prod_json.py` — measures: ghost brands, noise articles, stop brands, many brands, duplicates. Does NOT measure ФИО/ИНН/phone/qty/product_name %.
- `audit_entity_extraction.py` — measures: INN .0, phone_missing, ФИО with org, company HTML, article noise. Does NOT produce simple per-field %.
- `_audit_100.py` — measures: per-letter presence/absence of each field. CLOSEST to what we need. Returns raw counts, not %.
- None of these persist a baseline file or include n8n feedback.

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `scripts/_audit_100.py`, `scripts/audit_prod_json.py`, `scripts/audit_entity_extraction.py`, `scripts/audit_cycle_snapshot.py`, `scripts/fetch_prod_and_audit.py`
- Direct code inspection: `src/services/validation-feedback-sync.js` — fetchValidationFeedback, normalizeValidationRecord, applyValidationFeedbackToStore
- Direct code inspection: `src/server.js` lines 675-700 — GET/POST `/api/admin/validation-feedback`
- Live JSON inspection: `data/prod-messages-p4-fresh.json` — confirmed message/analysis/sender/lead field structure
- Memory file: `reference_n8n_validation_webhook.md` — n8n GET URL, auth, response schema

### Secondary (MEDIUM confidence)

- Memory file: `project_n8n_feedback_flow.md` — feedback flow description (7 days old, code verified independently)
- Memory file: `session_2026_05_20.md` — brand 58%, article 43% on 100-letter audit (baseline reference point)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are Python stdlib, confirmed used in 19 existing scripts
- Architecture patterns: HIGH — patterns copied directly from verified existing code
- Pitfalls: HIGH — most identified from actual bugs in project history (INN .0, SSL, float/location issues)
- n8n integration: HIGH — `validation-feedback-sync.js` fully implemented and tested against live endpoint

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable domain — only changes if server endpoints are modified)
