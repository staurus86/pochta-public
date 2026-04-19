"""Детализация остаточных ошибок для Batch I."""
import json, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('data/prod-messages-2026-04-19-postH.json','r',encoding='utf-8') as f: msgs = json.load(f)
by_id = {m.get('id') or m.get('messageKey',''): m for m in msgs}

with open('data/audit_postH_details.json','r',encoding='utf-8') as f: d = json.load(f)

print('=== UUID ARTICLES ===')
uuid_pat = re.compile(r'^(uuid:|[a-f0-9]{8}-[a-f0-9]{4}-)', re.I)
for mid in d['bad_art_emails'][:10]:
    m = by_id.get(mid) or {}
    a = m.get('analysis') or {}
    arts = (a.get('lead') or {}).get('articles') or []
    bad = [str(x) for x in arts if uuid_pat.match(str(x))]
    if bad:
        print(f"#{mid} arts={arts[:5]}, bad_uuid={bad[:3]}")

print()
print('=== DUP PRODUCT NAMES ===')
for mid, ndup, names in d['dup_rows'][:5]:
    m = by_id.get(mid) or {}
    l = (m.get('analysis') or {}).get('lead') or {}
    pn = l.get('productNames') or []
    li = l.get('lineItems') or []
    print(f"#{mid} dup={ndup} names[0:3]={names} | productNames={pn[:3]} | lineItems={[i.get('name','') for i in li[:3]]}")

print()
print('=== ≥20 articles ===')
for mid, cnt in d['many_arts_rows'][:5]:
    m = by_id.get(mid) or {}
    a = m.get('analysis') or {}
    arts = (a.get('lead') or {}).get('articles') or []
    print(f"#{mid} cnt={cnt}, sample={arts[:10]}")

print()
print('=== ≥10 brands ===')
for mid, cnt, sample in d['many_brands_rows'][:5]:
    print(f"#{mid} cnt={cnt}, sample={sample}")

print()
print('=== GHOST residual ===')
for mid, ghost in d['ghost_brands_top'][:5]:
    pass

for mid in d['ghost_emails'][:5]:
    m = by_id.get(mid) or {}
    a = m.get('analysis') or {}
    brands = a.get('detectedBrands') or []
    subj = m.get('subject','')
    body = (m.get('bodyPreview') or '')[:200]
    print(f"#{mid} brands={brands} subj={subj[:80]}")
    print(f"  body: {body}")
