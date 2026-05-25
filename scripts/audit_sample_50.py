"""Phase 10 — Structured 50-email manual audit report (AUDIT-01).

Samples 50 Клиент-class emails deterministically (seed=42) from live prod or
a local snapshot, runs the same 7-field correctness heuristics as
audit_baseline.py, and writes one JSON file with one row per email containing
the raw extracted values + auto-flagged noise reasons. A human reviewer (or
Claude in a session) then opens the JSON and fills in `reviewer_notes`.

Usage:
    python scripts/audit_sample_50.py                          # live fetch
    python scripts/audit_sample_50.py --local                  # newest data/prod-messages-*.json
    python scripts/audit_sample_50.py --snapshot PATH          # explicit snapshot
    python scripts/audit_sample_50.py --out PATH               # default data/audit_sample_50_report.json
    python scripts/audit_sample_50.py --limit 10               # smaller for smoke
"""
import argparse
import datetime
import glob
import io
import json
import os
import random
import re
import sqlite3
import sys
import urllib.parse
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ─── Constants ────────────────────────────────────────────────────────────────
BASE = "https://pochta-production.up.railway.app"
PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"]
ADMIN_USER = "admin"
ADMIN_PASS = "LgxaZ@ZDgNBXgSpnmTHEW6MC"
DEFAULT_SAMPLE = 50
DEFAULT_SEED = 42
DEFAULT_OUT = "data/audit_sample_50_report.json"
KB_PATH = "data/detection-kb.sqlite"

# ─── Regex patterns ───────────────────────────────────────────────────────────
ORG_RE = re.compile(r'\b(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|ФГУП|МУП|ГУП|НКО|АНО|LLC|Ltd\.?|GmbH|JSC|Inc\.?|S\.A\.|B\.V\.)\b', re.U)
TITLE_RE = re.compile(
    r'\b(?:менеджер|директор|руководитель|специалист|начальник|главный|инженер|бухгалтер|'
    r'отдел\s+продаж|отдел\s+закупок|отдел\s+снабжения|генеральный|коммерческий|'
    r'manager|director|sales|purchasing|engineer)\b', re.I | re.U)
OWN_DOMAIN_RE = re.compile(r'siderus\.ru|kolovrat\.ru', re.I)
NUMBERED_LIST_RE = re.compile(r'^\s*\d+\s*[\.\)]\s+.+(?:\s+—\s+\d+\s*шт)', re.U)

# ─── Article noise patterns ────────────────────────────────────────────────────
bad_arts_exact = {
    'кол-ве', 'Конический', 'Диафрагменный', 'Зажимной', 'Метчики', 'Счетчик',
    'Эластичная', 'Шаровые', 'Инкрементальный', 'Ручки-барашки', 'ОЛ-БРУ-СПБиПК',
    'Россия', 'Москва', 'Санкт',
}
year_pat = re.compile(r'^(19|20)\d{2}$')
uuid_pat = re.compile(r'^(uuid:|[a-f0-9]{8}-[a-f0-9]{4}-)', re.I)
desc_pat = re.compile(r'^DESC:', re.I)
cyr_only_pat = re.compile(r'^[А-Яа-яЁё\s\-\.]+$')
short_num_pat = re.compile(r'^\d{1,3}$')


# ─── CLI ──────────────────────────────────────────────────────────────────────
def make_parser():
    p = argparse.ArgumentParser(
        description="Phase 10 — Structured 50-email manual audit report (AUDIT-01)"
    )
    p.add_argument("--local", action="store_true",
                   help="Use newest data/prod-messages-*.json instead of live fetch")
    p.add_argument("--snapshot", type=str, default=None,
                   help="Explicit path to a snapshot JSON file")
    p.add_argument("--out", type=str, default=DEFAULT_OUT,
                   help="Output path for JSON report")
    p.add_argument("--token", type=str, default=None,
                   help="Pre-existing auth token (skips login)")
    p.add_argument("--limit", type=int, default=DEFAULT_SAMPLE,
                   help="Number of emails to sample (default 50)")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED,
                   help="Random seed for deterministic sampling (default 42)")
    return p


# ─── API helpers ──────────────────────────────────────────────────────────────
def login():
    body = json.dumps({"login": ADMIN_USER, "password": ADMIN_PASS}).encode()
    req = urllib.request.Request(
        BASE + "/api/auth/login", data=body,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["token"]


def api_get(path, token=None):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


# ─── Message loading ──────────────────────────────────────────────────────────
def _parse_snapshot(data):
    """Handle both list and {messages:[...]} shapes."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("messages") or []
    return []


def load_messages(args):
    """Load messages from snapshot, local file, or live API.

    Returns (list[message], source_label, token_or_None).
    """
    if args.snapshot:
        with open(args.snapshot, "r", encoding="utf-8") as f:
            data = json.load(f)
        msgs = _parse_snapshot(data)
        return msgs, f"snapshot:{args.snapshot}", None

    if args.local:
        pattern = os.path.join("data", "prod-messages-*.json")
        files = sorted(glob.glob(pattern))
        if not files:
            print("ERROR: No data/prod-messages-*.json found. Run without --local to fetch live.", flush=True)
            sys.exit(1)
        newest = files[-1]
        with open(newest, "r", encoding="utf-8") as f:
            data = json.load(f)
        msgs = _parse_snapshot(data)
        return msgs, f"local:{newest}", None

    # Live fetch
    print("Auth...", flush=True)
    token = args.token or login()
    print("Loading messages from production...", flush=True)
    all_msgs = []
    for pid in PROJECTS:
        d = api_get(f"/api/projects/{pid}/messages", token)
        project_msgs = d.get("messages") or []
        for m in project_msgs:
            m["_project_id"] = pid
        all_msgs.extend(project_msgs)
        print(f"  {pid}: {len(project_msgs)} messages", flush=True)
    return all_msgs, f"live:{BASE}", token


# ─── Sampling ─────────────────────────────────────────────────────────────────
def filter_client(msgs):
    return [m for m in msgs
            if ((m.get('analysis') or {}).get('classification') or {}).get('label') == 'Клиент']


def sample_messages(msgs, seed, limit):
    random.seed(seed)
    n = min(limit, len(msgs))
    return random.sample(msgs, n) if msgs else []


# ─── KB loading ───────────────────────────────────────────────────────────────
def load_kb():
    """Load brand KB from SQLite. Returns (kb_article_norm, kb_article_str, brand_aliases)."""
    if not os.path.exists(KB_PATH):
        print(f"WARNING: KB not found at {KB_PATH} — ghost-brand check disabled", flush=True)
        return {}, {}, {}

    c = sqlite3.connect(KB_PATH)
    kb_a = {}
    for art_norm, brand in c.execute(
        "SELECT article_normalized, brand FROM nomenclature_dictionary WHERE brand != ''"
    ).fetchall():
        kb_a.setdefault(art_norm.lower(), set()).add(brand)

    kb_s = {}
    for art, brand in c.execute(
        "SELECT article, brand FROM nomenclature_dictionary WHERE brand != ''"
    ).fetchall():
        kb_s.setdefault(art.lower(), set()).add(brand)

    aliases = {}
    for canonical, alias in c.execute(
        "SELECT canonical_brand, alias FROM brand_aliases WHERE is_active=1"
    ).fetchall():
        aliases.setdefault(canonical, set()).add(alias.lower())

    c.close()
    return kb_a, kb_s, aliases


# ─── Heuristics (copied verbatim from audit_prod_json.py lines 21-71) ────────
def normalize_article(a):
    return re.sub(r'[\s\-\.\/]', '', a).lower()


def is_brand_grounded(brand, body, subject, attachment_text, articles, kb_a, kb_s, aliases):
    """Return True if brand is plausibly grounded in content or KB."""
    full = body + '\n' + attachment_text
    full_low = full.lower()
    subj_low = subject.lower()
    brand_low = brand.lower()

    if brand_low in full_low:
        return True

    brand_aliases_set = aliases.get(brand, set()) | {brand_low}
    for al in brand_aliases_set:
        if len(al) >= 3 and al in full_low:
            return True
    for al in brand_aliases_set:
        parts = [p for p in re.split(r'[\s\-_]+', al) if len(p) >= 4]
        if parts and all(p in full_low for p in parts):
            return True

    canon_toks = [t for t in re.split(r'[\s\-]+', brand_low) if len(t) >= 5]
    for t in canon_toks:
        if t in full_low:
            return True

    for al in brand_aliases_set | {brand_low}:
        if len(al) >= 5 and al in subj_low:
            return True

    for art in articles:
        if not art or len(art) < 3:
            continue
        art_low = art.lower()
        art_norm = normalize_article(art)
        bs = kb_a.get(art_norm, set()) | kb_s.get(art_low, set())
        if brand in bs:
            return True
        for t in canon_toks:
            if t in art_low:
                return True

    return False


def bad_articles(lst, from_email):
    """Return list of (reason, value) for each noisy article."""
    locals_ = set()
    m = re.search(r'([a-z0-9._+-]+)@', str(from_email).lower())
    if m:
        locals_.add(m.group(1))
    bad = []
    for a in lst:
        a_clean = str(a).strip()
        if a_clean in bad_arts_exact:
            bad.append(('exact', a_clean))
            continue
        if year_pat.match(a_clean):
            bad.append(('year', a_clean))
            continue
        if uuid_pat.match(a_clean):
            bad.append(('uuid', a_clean))
            continue
        if desc_pat.match(a_clean):
            bad.append(('desc', a_clean))
            continue
        if cyr_only_pat.match(a_clean) and not re.search(r'\d', a_clean):
            bad.append(('cyr-only', a_clean))
            continue
        if short_num_pat.match(a_clean) and len(a_clean) <= 3:
            bad.append(('short-num', a_clean))
            continue
        if a_clean.lower() in locals_:
            bad.append(('localpart', a_clean))
            continue
    return bad


# ─── Value extractors ─────────────────────────────────────────────────────────
def brand_names(lst):
    out = []
    for b in (lst or []):
        if isinstance(b, dict):
            out.append(b.get("name") or b.get("brand") or "")
        elif b:
            out.append(str(b))
    return [x for x in out if x]


def article_codes(lst):
    out = []
    for a in (lst or []):
        if isinstance(a, dict):
            out.append(a.get("code") or "")
        elif a:
            out.append(str(a))
    return [x for x in out if x]


def inn_digits(inn):
    if inn is None:
        return ""
    return re.sub(r'\D', '', str(inn).split('.')[0])


# ─── Per-field row builders ───────────────────────────────────────────────────
def row_fio(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    fio = (s.get("fullName") or "").strip()
    reasons = []
    if not fio or fio.lower() == "не определено":
        return {"value": fio, "present": False, "noise": False, "noise_reasons": []}
    if ORG_RE.search(fio):
        reasons.append("contains-org-keyword")
    if TITLE_RE.search(fio):
        reasons.append("contains-title")
    if "\n" in fio:
        reasons.append("multiline")
    return {"value": fio, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


def row_inn(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    raw = s.get("inn")
    d = inn_digits(raw)
    reasons = []
    if not d:
        return {"value": raw, "present": False, "noise": False, "noise_reasons": []}
    if str(raw).endswith(".0"):
        reasons.append("float-artifact")
    if len(d) not in (10, 12):
        reasons.append(f"bad-length:{len(d)}")
    return {"value": d, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


def row_phone(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    ph = (s.get("mobilePhone") or s.get("cityPhone") or "").strip()
    reasons = []
    if not ph:
        return {"value": ph, "present": False, "noise": False, "noise_reasons": []}
    digits = re.sub(r'\D', '', ph)
    if OWN_DOMAIN_RE.search(ph):
        reasons.append("own-domain-fragment")
    if not (10 <= len(digits) <= 15):
        reasons.append(f"bad-digit-count:{len(digits)}")
    return {"value": ph, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


def row_article(msg, from_email):
    l = (msg.get("analysis") or {}).get("lead") or {}
    arts = article_codes(l.get("articles"))
    if not arts:
        return {"value": [], "present": False, "noise": False, "noise_reasons": []}
    bads = bad_articles(arts, from_email)
    reasons = [f"{reason}:{val}" for reason, val in bads]
    return {"value": arts, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


def row_brand(msg, kb_a, kb_s, aliases):
    a = msg.get("analysis") or {}
    l = a.get("lead") or {}
    brands = brand_names(a.get("detectedBrands") or l.get("detectedBrands") or [])
    if not brands:
        return {"value": [], "present": False, "noise": False, "noise_reasons": []}
    body = msg.get("bodyPreview") or ""
    subj = msg.get("subject") or ""
    att = ((a.get("attachmentAnalysis") or {}).get("combinedText") or "")
    arts = article_codes(l.get("articles"))
    ghosts = [b for b in brands
              if not is_brand_grounded(b, body, subj, att, arts, kb_a, kb_s, aliases)]
    reasons = [f"ghost:{g}" for g in ghosts]
    return {"value": brands, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


def row_qty(msg):
    l = (msg.get("analysis") or {}).get("lead") or {}
    arts = article_codes(l.get("articles"))
    # Live prod stores qty in totalQuantity / quantitiesClean, not lineItems
    total_qty = l.get("totalQuantity") or 0
    quantities_clean = l.get("quantitiesClean") or []
    total = total_qty or sum(
        (q.get("value") or 0) for q in quantities_clean if isinstance(q, dict)
    )
    if not arts:
        return {"value": total, "present": False, "noise": False, "noise_reasons": []}
    reasons = []
    if total <= 0:
        reasons.append("zero-qty-with-articles")
    return {"value": total, "present": total > 0, "noise": bool(reasons), "noise_reasons": reasons}


def row_product_name(msg):
    l = (msg.get("analysis") or {}).get("lead") or {}
    names = [str(n) for n in (l.get("productNames") or []) if n]
    arts = article_codes(l.get("articles"))
    if not arts:
        return {"value": names, "present": False, "noise": False, "noise_reasons": []}
    if not names:
        return {"value": [], "present": False, "noise": False, "noise_reasons": []}
    reasons = []
    if any(NUMBERED_LIST_RE.match(n) for n in names):
        reasons.append("raw-numbered-list-format")
    return {"value": names, "present": True, "noise": bool(reasons), "noise_reasons": reasons}


# ─── Row assembler ────────────────────────────────────────────────────────────
def build_row(msg, kb_a, kb_s, aliases):
    a = msg.get("analysis") or {}
    from_email = msg.get("from") or ""
    return {
        "project_id":  msg.get("_project_id"),
        "message_key": msg.get("messageKey") or msg.get("id"),
        "subject":     msg.get("subject") or "",
        "from":        from_email,
        "classification_confidence": (a.get("classification") or {}).get("confidence"),
        "fields": {
            "fio":          row_fio(msg),
            "inn":          row_inn(msg),
            "phone":        row_phone(msg),
            "article":      row_article(msg, from_email),
            "brand":        row_brand(msg, kb_a, kb_s, aliases),
            "qty":          row_qty(msg),
            "product_name": row_product_name(msg),
        },
        "reviewer_notes": "",
    }


# ─── Report writer ────────────────────────────────────────────────────────────
def write_report(out_path, rows, source_label, args):
    report = {
        "version": 1,
        "created_at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sample_size": len(rows),
        "sample_seed": args.seed,
        "source": source_label,
        "rows": rows,
        "reviewer_notes": "",
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    os.replace(tmp, out_path)
    return report


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = make_parser()
    args = parser.parse_args()

    # 1. Load messages
    msgs, source_label, _token = load_messages(args)
    print(f"Loaded {len(msgs)} from {source_label}", flush=True)

    # 2. Filter Клиент
    clients = filter_client(msgs)
    print(f"{len(clients)} Клиент-class", flush=True)

    # 3. Sample
    sample = sample_messages(clients, args.seed, args.limit)
    print(f"Sampled {len(sample)} (seed={args.seed})", flush=True)

    if not sample:
        print("ERROR: empty sample — no Клиент messages found in source.", flush=True)
        sys.exit(1)

    # 4. Load KB
    kb_a, kb_s, aliases = load_kb()

    # 5. Build rows
    rows = [build_row(m, kb_a, kb_s, aliases) for m in sample]

    # 6. Print per-field noise summary
    field_names = ["fio", "inn", "phone", "article", "brand", "qty", "product_name"]
    print("\nNoise summary (rows where noise=True):", flush=True)
    for fn in field_names:
        noisy = sum(1 for r in rows if r["fields"][fn]["noise"])
        absent = sum(1 for r in rows if not r["fields"][fn]["present"])
        print(f"  {fn:15s}: noisy={noisy:3d}  absent={absent:3d}", flush=True)

    # 7. Write report
    write_report(args.out, rows, source_label, args)
    print(f"\nWrote report: {args.out}", flush=True)


if __name__ == "__main__":
    main()
