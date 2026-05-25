"""Phase 10 — Automated per-field detection baseline.

Covers requirements:
  - AUDIT-02 — per-field % across 7 detection fields (ФИО, ИНН, телефон,
               артикул, бренд, кол-во, название товара) on Клиент-class emails.
  - AUDIT-03 — n8n manager feedback signal correlated by (project_id, message_key).

Output: scripts/baselines/baseline_v1.json (committed to git).

Usage:
    python scripts/audit_baseline.py                          # live fetch from prod
    python scripts/audit_baseline.py --local                  # use newest data/prod-messages-*.json
    python scripts/audit_baseline.py --local --out PATH       # custom output path
    python scripts/audit_baseline.py --token <bearer>         # supply admin token instead of password login
    python scripts/audit_baseline.py --limit 50               # smaller sample for smoke runs
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
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ─── Constants ────────────────────────────────────────────────────────────────
BASE = "https://pochta-production.up.railway.app"
PROJECTS = ["project-3-mailbox-file", "project-4-klvrt-mail"]
ADMIN_USER = "admin"
ADMIN_PASS = "LgxaZ@ZDgNBXgSpnmTHEW6MC"
DEFAULT_SAMPLE = 300
DEFAULT_SEED = 42
DEFAULT_OUT = "scripts/baselines/baseline_v1.json"
KB_PATH = "data/detection-kb.sqlite"

# ─── CLI parser ───────────────────────────────────────────────────────────────
def build_parser():
    p = argparse.ArgumentParser(
        description="Per-field detection baseline for pochta-platform (AUDIT-02 + AUDIT-03)."
    )
    p.add_argument("--local", action="store_true",
                   help="Load from newest data/prod-messages-*.json instead of live API.")
    p.add_argument("--snapshot", type=str, default=None,
                   help="Explicit local snapshot path (overrides --local auto-pick).")
    p.add_argument("--out", type=str, default=DEFAULT_OUT,
                   help=f"Output JSON path (default: {DEFAULT_OUT}).")
    p.add_argument("--token", type=str, default=None,
                   help="Admin Bearer token; if absent and not --local, login() is called.")
    p.add_argument("--limit", type=int, default=DEFAULT_SAMPLE,
                   help=f"Sample size after Клиент filter (default: {DEFAULT_SAMPLE}).")
    p.add_argument("--seed", type=int, default=DEFAULT_SEED,
                   help=f"Random seed for deterministic sampling (default: {DEFAULT_SEED}).")
    p.add_argument("--skip-n8n", action="store_true",
                   help="Skip the AUDIT-03 n8n feedback fetch.")
    return p

# ─── API helpers ──────────────────────────────────────────────────────────────
def login():
    body = json.dumps({"login": ADMIN_USER, "password": ADMIN_PASS}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=body,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())["token"]

def api_get(path, token):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

# ─── Message loader ───────────────────────────────────────────────────────────
def load_messages(args):
    """Load messages from local snapshot or live API.

    Returns (list[message], token_or_None).
    """
    token = args.token

    if args.snapshot:
        snapshot_path = args.snapshot
        print(f"Loading snapshot: {snapshot_path}")
        with open(snapshot_path, encoding="utf-8") as f:
            raw = json.load(f)
        msgs = raw["messages"] if isinstance(raw, dict) else raw
        print(f"Loaded {len(msgs)} total messages from {snapshot_path}")
        return msgs, token

    if args.local:
        candidates = sorted(
            glob.glob("data/prod-messages-*.json"),
            key=os.path.getmtime,
            reverse=True,
        )
        if not candidates:
            print("ERROR: No data/prod-messages-*.json files found.", file=sys.stderr)
            sys.exit(1)
        snapshot_path = candidates[0]
        print(f"Selected snapshot: {snapshot_path}")
        with open(snapshot_path, encoding="utf-8") as f:
            raw = json.load(f)
        msgs = raw["messages"] if isinstance(raw, dict) else raw
        print(f"Loaded {len(msgs)} total messages from {snapshot_path}")
        return msgs, token

    # Live fetch
    if not token:
        print("Auth...", flush=True)
        token = login()
        print("Authenticated.", flush=True)

    all_msgs = []
    for pid in PROJECTS:
        print(f"Loading {pid}...", flush=True)
        d = api_get(f"/api/projects/{pid}/messages", token)
        for m in (d.get("messages") or []):
            m["_project_id"] = pid
            all_msgs.append(m)
        print(f"  {pid}: {len(d.get('messages') or [])} messages", flush=True)

    print(f"Loaded {len(all_msgs)} total messages from live prod")
    return all_msgs, token

# ─── Filter + sampler ─────────────────────────────────────────────────────────
def filter_client(msgs):
    return [m for m in msgs
            if ((m.get("analysis") or {}).get("classification") or {}).get("label") == "Клиент"]

def sample_messages(msgs, seed, limit):
    random.seed(seed)
    n = min(limit, len(msgs))
    return random.sample(msgs, n) if msgs else []

# ─── KB loader ────────────────────────────────────────────────────────────────
def load_kb():
    """Load brand_aliases + nomenclature_dictionary from SQLite KB.
    Returns (kb_article_to_brand:dict, kb_article_to_brand_str:dict, brand_aliases:dict)."""
    if not os.path.exists(KB_PATH):
        print(f"WARN: {KB_PATH} not found — ghost-brand check disabled", file=sys.stderr)
        return {}, {}, {}
    c = sqlite3.connect(KB_PATH)
    kb_article_to_brand = {}
    for art_norm, brand in c.execute(
        "SELECT article_normalized, brand FROM nomenclature_dictionary WHERE brand != ''"
    ).fetchall():
        kb_article_to_brand.setdefault(art_norm.lower(), set()).add(brand)
    kb_article_to_brand_str = {}
    for art, brand in c.execute(
        "SELECT article, brand FROM nomenclature_dictionary WHERE brand != ''"
    ).fetchall():
        kb_article_to_brand_str.setdefault(art.lower(), set()).add(brand)
    brand_aliases = {}
    for canonical, alias in c.execute(
        "SELECT canonical_brand, alias FROM brand_aliases WHERE is_active=1"
    ).fetchall():
        brand_aliases.setdefault(canonical, set()).add(alias.lower())
    c.close()
    return kb_article_to_brand, kb_article_to_brand_str, brand_aliases

# ─── Lifted verbatim from audit_prod_json.py ─────────────────────────────────
def normalize_article(a):
    return re.sub(r'[\s\-\.\/]', '', a).lower()

def is_brand_grounded(brand, body, subject, attachment_text, articles,
                      kb_article_to_brand, kb_article_to_brand_str, brand_aliases):
    full = body + '\n' + attachment_text
    full_low = full.lower()
    subj_low = subject.lower()
    brand_low = brand.lower()
    if brand_low in full_low:
        return True
    aliases = brand_aliases.get(brand, set()) | {brand_low}
    for al in aliases:
        if len(al) >= 3 and al in full_low:
            return True
    for al in aliases:
        parts = [p for p in re.split(r'[\s\-_]+', al) if len(p) >= 4]
        if parts and all(p in full_low for p in parts):
            return True
    canon_toks = [t for t in re.split(r'[\s\-]+', brand_low) if len(t) >= 5]
    for t in canon_toks:
        if t in full_low:
            return True
    for al in aliases | {brand_low}:
        if len(al) >= 5 and al in subj_low:
            return True
    for art in articles:
        if not art or len(art) < 3:
            continue
        art_low = art.lower()
        art_norm = normalize_article(art)
        bs = kb_article_to_brand.get(art_norm, set()) | kb_article_to_brand_str.get(art_low, set())
        if brand in bs:
            return True
        for t in canon_toks:
            if t in art_low:
                return True
    return False

bad_arts_exact = {
    'кол-ве', 'Конический', 'Диафрагменный', 'Зажимной', 'Метчики', 'Счетчик',
    'Эластичная', 'Шаровые', 'Инкрементальный', 'Ручки-барашки',
    'ОЛ-БРУ-СПБиПК', 'Россия', 'Москва', 'Санкт'
}
year_pat = re.compile(r'^(19|20)\d{2}$')
uuid_pat = re.compile(r'^(uuid:|[a-f0-9]{8}-[a-f0-9]{4}-)', re.I)
desc_pat = re.compile(r'^DESC:', re.I)
cyr_only_pat = re.compile(r'^[А-Яа-яЁё\s\-\.]+$')
short_num_pat = re.compile(r'^\d{1,3}$')

def bad_articles(lst, from_email):
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

# ─── Field regex patterns (from audit_entity_extraction.py) ──────────────────
ORG_RE = re.compile(
    r'\b(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|ФГУП|МУП|ГУП|НКО|АНО|LLC|Ltd\.?|GmbH|JSC|Inc\.?|S\.A\.|B\.V\.)\b',
    re.U
)
TITLE_RE = re.compile(
    r'\b(?:менеджер|директор|руководитель|специалист|начальник|главный|инженер|бухгалтер|'
    r'отдел\s+продаж|отдел\s+закупок|отдел\s+снабжения|генеральный|коммерческий|'
    r'manager|director|sales|purchasing|engineer)\b',
    re.I | re.U
)
OWN_DOMAIN_RE = re.compile(r'siderus\.ru|kolovrat\.ru', re.I)

# ─── Helper extractors ────────────────────────────────────────────────────────
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
    """Strip .0 float artifact + non-digits."""
    if inn is None:
        return ""
    return re.sub(r'\D', '', str(inn).split('.')[0])

# ─── Per-field scorers ────────────────────────────────────────────────────────
def check_fio(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    fio = (s.get("fullName") or "").strip()
    if not fio or fio.lower() in ("не определено",):
        return {"present": False, "noise": False}
    is_noise = bool(ORG_RE.search(fio) or TITLE_RE.search(fio) or "\n" in fio)
    return {"present": True, "noise": is_noise}

def check_inn(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    d = inn_digits(s.get("inn"))
    if not d:
        return {"present": False, "noise": False}
    ok_len = len(d) in (10, 12)
    return {"present": True, "noise": not ok_len}

def check_phone(msg):
    s = (msg.get("analysis") or {}).get("sender") or {}
    ph = (s.get("mobilePhone") or s.get("cityPhone") or "").strip()
    if not ph:
        return {"present": False, "noise": False}
    digits = re.sub(r'\D', '', ph)
    is_noise = bool(OWN_DOMAIN_RE.search(ph)) or not (10 <= len(digits) <= 15)
    return {"present": True, "noise": is_noise}

def check_article(msg, from_email):
    l = (msg.get("analysis") or {}).get("lead") or {}
    arts = article_codes(l.get("articles"))
    if not arts:
        return {"present": False, "noise": False}
    bad = bad_articles(arts, from_email)
    return {"present": True, "noise": len(bad) > 0}

def check_brand(msg, kb_a, kb_s, aliases):
    a = msg.get("analysis") or {}
    l = a.get("lead") or {}
    brands = brand_names(a.get("detectedBrands") or l.get("detectedBrands") or [])
    if not brands:
        return {"present": False, "noise": False}
    body = msg.get("bodyPreview") or ""
    subj = msg.get("subject") or ""
    att = ((a.get("attachmentAnalysis") or {}).get("combinedText") or "")
    arts = article_codes(l.get("articles"))
    any_ghost = any(
        not is_brand_grounded(b, body, subj, att, arts, kb_a, kb_s, aliases)
        for b in brands
    )
    return {"present": True, "noise": any_ghost}

def check_qty(msg):
    l = (msg.get("analysis") or {}).get("lead") or {}
    arts = article_codes(l.get("articles"))
    line_items = l.get("lineItems") or []
    has_any_qty = any(
        (it.get("quantity") or 0) > 0
        for it in line_items
        if isinstance(it, dict)
    )
    if not arts:
        # No articles → qty not expected; present=False is correct, no noise
        return {"present": False, "noise": False}
    return {"present": has_any_qty, "noise": not has_any_qty}

NUMBERED_LIST_RE = re.compile(r'^\s*\d+\s*[\.\)]\s+.+(?:\s+—\s+\d+\s*шт)', re.U)

def check_product_name(msg):
    l = (msg.get("analysis") or {}).get("lead") or {}
    names = l.get("productNames") or []
    names = [str(n) for n in names if n]
    arts = article_codes(l.get("articles"))
    if not arts:
        return {"present": False, "noise": False}
    if not names:
        return {"present": False, "noise": False}
    has_raw_numbered = any(NUMBERED_LIST_RE.match(n) for n in names)
    return {"present": True, "noise": has_raw_numbered}

# ─── Aggregator ───────────────────────────────────────────────────────────────
FIELDS = ("fio", "inn", "phone", "article", "brand", "qty", "product_name")

def score_sample(sample, kb_a, kb_s, aliases):
    counts = {f: {"present": 0, "noise": 0} for f in FIELDS}
    for m in sample:
        from_email = m.get("from") or ""
        results = {
            "fio":          check_fio(m),
            "inn":          check_inn(m),
            "phone":        check_phone(m),
            "article":      check_article(m, from_email),
            "brand":        check_brand(m, kb_a, kb_s, aliases),
            "qty":          check_qty(m),
            "product_name": check_product_name(m),
        }
        for f, r in results.items():
            if r["present"]:
                counts[f]["present"] += 1
            if r["noise"]:
                counts[f]["noise"] += 1
    n = len(sample)
    return {
        f: {
            "present":    round(counts[f]["present"] / n, 4) if n else 0,
            "noise_free": round((counts[f]["present"] - counts[f]["noise"]) / n, 4) if n else 0,
            "n":          n,
        }
        for f in FIELDS
    }

# ─── n8n feedback ─────────────────────────────────────────────────────────────
def fetch_n8n_feedback(token, limit=500):
    """Read manager validation feedback synced from n8n.
    Returns (by_key:dict[(pid,mk)->record], summary:dict)."""
    if not token:
        return {}, {"total_with_feedback": 0, "note": "no token — skipped"}
    try:
        d = api_get(f"/api/admin/validation-feedback?limit={limit}", token)
    except Exception as e:
        return {}, {"total_with_feedback": 0, "note": f"endpoint error: {e}"}
    by_key = {}
    approved = needs_rework = not_reviewed = 0
    for item in (d.get("data") or []):
        mk = item.get("message_key") or item.get("messageKey")
        pid = item.get("project_id")
        mv = item.get("manager_validation") or {}
        verdict = (mv.get("verdict") or "").lower()
        if mk:
            by_key[(pid, mk)] = {
                "verdict": verdict or None,
                "comments": mv.get("comments") or "",
            }
        if verdict == "approved":
            approved += 1
        elif verdict in ("needs_rework", "needs rework"):
            needs_rework += 1
        else:
            not_reviewed += 1
    summary = {
        "total_with_feedback": len(by_key),
        "approved": approved,
        "needs_rework": needs_rework,
        "not_reviewed": not_reviewed,
    }
    return by_key, summary

def correlate_feedback(sample, by_key):
    in_sample_with_feedback = 0
    for m in sample:
        pid = m.get("_project_id")
        mk = m.get("messageKey") or m.get("id")
        if (pid, mk) in by_key:
            in_sample_with_feedback += 1
    return in_sample_with_feedback

# ─── Baseline writer ──────────────────────────────────────────────────────────
def write_baseline(out_path, sample, field_scores, n8n_signal, args, source_label):
    baseline = {
        "version": 1,
        "created_at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "sample_size": len(sample),
        "sample_seed": args.seed,
        "projects": PROJECTS,
        "source": source_label,
        "fields": field_scores,
        "n8n_signal": n8n_signal,
        "raw_message_ids": [m.get("messageKey") or m.get("id") for m in sample],
    }
    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)
    os.replace(tmp, out_path)
    return baseline

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = build_parser()
    args = parser.parse_args()

    # Determine source label for baseline JSON
    if args.snapshot:
        source_label = f"local:{args.snapshot}"
    elif args.local:
        # Will be updated after we know which file was picked
        source_label = "local:auto"
    else:
        source_label = "live-prod"

    # Load messages
    msgs, token = load_messages(args)

    # Update source label if local auto-pick
    if args.local and not args.snapshot:
        candidates = sorted(
            glob.glob("data/prod-messages-*.json"),
            key=os.path.getmtime,
            reverse=True,
        )
        if candidates:
            source_label = f"local:{candidates[0]}"

    # Filter to Клиент only
    client_msgs = filter_client(msgs)
    print(f"Filtered to {len(client_msgs)} Клиент-class")

    if not client_msgs:
        print("ERROR: No Клиент messages found. Check snapshot/filter.", file=sys.stderr)
        sys.exit(1)

    # Sample
    sample = sample_messages(client_msgs, args.seed, args.limit)
    print(f"Sampled {len(sample)} (seed={args.seed})")

    # Load KB
    print("Loading KB...", flush=True)
    kb_a, kb_s, aliases = load_kb()

    # Score 7 fields
    print("Scoring fields...", flush=True)
    field_scores = score_sample(sample, kb_a, kb_s, aliases)

    # Print table
    print()
    print(f"{'Field':<15} | {'present%':>9} | {'noise_free%':>11} | {'n':>5}")
    print("-" * 50)
    for f in FIELDS:
        fs = field_scores[f]
        print(f"{f:<15} | {fs['present']*100:>8.1f}% | {fs['noise_free']*100:>10.1f}% | {fs['n']:>5}")
    print()

    # n8n feedback
    skip_n8n = args.skip_n8n or (args.local and not args.token)
    if skip_n8n:
        n8n_signal = {"total_with_feedback": 0, "note": "skipped"}
        in_sample_with_feedback = 0
    else:
        print("Fetching n8n feedback...", flush=True)
        by_key, n8n_summary = fetch_n8n_feedback(token)
        in_sample_with_feedback = correlate_feedback(sample, by_key)
        n8n_signal = {
            **n8n_summary,
            "in_sample_with_feedback": in_sample_with_feedback,
        }

    # Write baseline
    baseline = write_baseline(args.out, sample, field_scores, n8n_signal, args, source_label)
    print(f"Wrote baseline: {args.out}")
    print(f"n8n feedback in sample: {in_sample_with_feedback}/{len(sample)}")
    return baseline


if __name__ == "__main__":
    main()
