"""Step 1: separate REAL extractor misses from genuine field-absence for qty/article/inn,
using the detail endpoint's up-to-4000-char body. Plus an n8n manager-feedback probe.
Read-only. seed 42, n=300 (same sample as baseline)."""
import sys, os, re, urllib.parse, json
sys.path.insert(0, os.path.dirname(__file__))
import audit_baseline as ab

token = ab.login()
allm = []
for pid in ab.PROJECTS:
    d = ab.api_get(f"/api/projects/{pid}/messages", token)
    for m in (d.get("messages") or []):
        m["_project_id"] = pid; allm.append(m)
sample = ab.sample_messages(ab.filter_client(allm), 42, 300)
print(f"sample={len(sample)}", flush=True)

# ── n8n manager feedback probe ──
print("\n===== N8N MANAGER FEEDBACK =====", flush=True)
try:
    fb = ab.api_get("/api/admin/validation-feedback?limit=500", token)
    data = fb.get("data") or []
    verdicts = {}
    for it in data:
        v = ((it.get("manager_validation") or {}).get("verdict") or "none").lower()
        verdicts[v] = verdicts.get(v, 0) + 1
    print(f"total feedback records: {len(data)}")
    print(f"verdict breakdown: {verdicts}")
    # correlate with our sample
    keys = {(m.get('_project_id'), m.get('messageKey') or m.get('id')) for m in sample}
    in_sample = sum(1 for it in data
                    if (it.get('project_id'), it.get('message_key') or it.get('messageKey')) in keys)
    print(f"feedback overlapping our 300-sample: {in_sample}")
except Exception as e:
    print(f"validation-feedback endpoint: {e}")

# ── detail fetch + recall classification ──
INN_LABEL = re.compile(r'ИНН[\s:№/]*([0-9][0-9\s]{8,13}[0-9])', re.I)
QTY_PAT = re.compile(r'\b(\d{1,5})\s*(?:шт|штук|штуки|pcs|pieces|ед\.?|едениц|единиц|компл|комплект|kpl|set)\b', re.I)
QTY_X = re.compile(r'(?:^|\s)[-–—]?\s*(\d{1,5})\s*(?:х|x|\*)\s*\d', re.I)
# article-like: token with BOTH a latin letter and a digit, len>=5, not a phone/year
ART_TOKEN = re.compile(r'\b(?=[A-Za-z0-9\-./]*[A-Za-z])(?=[A-Za-z0-9\-./]*\d)[A-Za-z0-9][A-Za-z0-9\-./]{4,}\b')

def has_valid_inn(text):
    for m in INN_LABEL.finditer(text):
        digits = re.sub(r'\D', '', m.group(1))
        if len(digits) in (10, 12) and ab.validate_inn_checksum(digits):
            return digits
    # bare 10/12-digit with checksum
    for m in re.finditer(r'\b(\d{10}|\d{12})\b', text):
        if ab.validate_inn_checksum(m.group(1)):
            return m.group(1)
    return None

stat = {f: {"absent_present": 0, "real_miss": 0, "examples": []} for f in ("inn", "qty", "article")}
fetched = 0
for i, m in enumerate(sample):
    pid = m["_project_id"]; key = m.get("messageKey") or m.get("id")
    try:
        det = (ab.api_get(f"/api/projects/{pid}/messages/{urllib.parse.quote(key, safe='')}", token).get("message") or {})
    except Exception:
        continue
    fetched += 1
    body = det.get("bodyPreview") or ""
    subj = det.get("subject") or ""
    text = subj + "\n" + body
    a = det.get("analysis") or {}; l = a.get("lead") or {}; s = a.get("sender") or {}
    arts = ab.article_codes(l.get("articles"))

    # INN: extractor missed but body has a valid INN
    if not ab.inn_digits(s.get("inn")):
        found = has_valid_inn(text)
        if found:
            stat["inn"]["real_miss"] += 1
            if len(stat["inn"]["examples"]) < 8:
                stat["inn"]["examples"].append({"key": key[:10], "inn_in_body": found})
        else:
            stat["inn"]["absent_present"] += 1

    # QTY: has articles, extractor found no qty, but body has qty patterns
    if arts:
        tq = l.get("totalQuantity") or 0
        qc = l.get("quantitiesClean") or []
        has_qty = (tq > 0) or any((q.get("value") or 0) > 0 for q in qc if isinstance(q, dict))
        if not has_qty:
            qm = QTY_PAT.search(body) or QTY_X.search(body)
            if qm:
                stat["qty"]["real_miss"] += 1
                if len(stat["qty"]["examples"]) < 8:
                    stat["qty"]["examples"].append({"key": key[:10], "qty_hint": qm.group(0).strip()[:30]})
            else:
                stat["qty"]["absent_present"] += 1

    # ARTICLE: extractor found none, but body has article-like tokens
    if not arts:
        toks = [t for t in ART_TOKEN.findall(body)
                if not re.match(r'^(19|20)\d{2}$', t) and not re.match(r'^\d{10,}$', re.sub(r'\D','',t))]
        toks = [t for t in toks if not (t.lower().startswith(('http','www','mailto')))]
        if toks:
            stat["article"]["real_miss"] += 1
            if len(stat["article"]["examples"]) < 8:
                stat["article"]["examples"].append({"key": key[:10], "tokens": toks[:4]})
        else:
            stat["article"]["absent_present"] += 1
    if (i + 1) % 60 == 0:
        print(f"  fetched {i+1}/{len(sample)}", flush=True)

print(f"\nfetched detail for {fetched}/{len(sample)}")
print("\n===== RECALL DIAGNOSIS (missing field -> real miss vs genuinely absent) =====")
for f in ("inn", "qty", "article"):
    st = stat[f]
    total_missing = st["real_miss"] + st["absent_present"]
    print(f"\n[{f.upper()}] missing in {total_missing} msgs:")
    print(f"   REAL MISS (field is in body, extractor skipped): {st['real_miss']}")
    print(f"   genuinely absent (no such field in text):         {st['absent_present']}")
    for ex in st["examples"]:
        print(f"     e.g. {json.dumps(ex, ensure_ascii=False)}")
