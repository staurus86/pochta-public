"""Diagnose the manager-flagged product/positions/qty cluster on detail bodies.
Read-only. Pulls each flagged message, shows manager complaint vs current extraction."""
import sys, os, urllib.parse, json
sys.path.insert(0, os.path.dirname(__file__))
import audit_baseline as ab

token = ab.login()
# manager-flagged cluster: (project, key-prefix, complaint)
cases = [
    ("project-3-mailbox-file", "d03b6a7179", "задваивает позиции"),
    ("project-3-mailbox-file", "25a983a03f", "5 позиций, указал одну"),
    ("project-3-mailbox-file", "687e91cf1c", "откуда 2 позиция, наименование некорректное"),
    ("project-3-mailbox-file", "c3d4d18268", "кол-во 1 шт, а не 11; Астрон не указал"),
    ("project-3-mailbox-file", "443970c357", "АО Волжский Оргсинтез не определил; кол-во не определил"),
    ("project-4-klvrt-mail",   "1ab382c362", "артикул не тот, вместо артикула название модели"),
    ("project-4-klvrt-mail",   "d9f75c5b69", "товары заполнены некорректно"),
]

# build prefix->fullkey maps per project
maps = {}
for pid in ab.PROJECTS:
    d = ab.api_get(f"/api/projects/{pid}/messages", token)
    maps[pid] = {}
    for m in (d.get("messages") or []):
        k = m.get("messageKey") or m.get("id") or ""
        maps[pid][k[:10]] = k

for pid, pref, complaint in cases:
    key = maps.get(pid, {}).get(pref)
    print("\n" + "="*70)
    print(f"[{pref}] {pid}")
    print(f"MANAGER: {complaint}")
    if not key:
        print("  (not found in current list)"); continue
    det = (ab.api_get(f"/api/projects/{pid}/messages/{urllib.parse.quote(key, safe='')}", token).get("message") or {})
    a = det.get("analysis") or {}; l = a.get("lead") or {}
    body = (det.get("bodyPreview") or "")
    print(f"SUBJECT: {det.get('subject','')[:90]}")
    print(f"BODY (first 700): {body[:700]!r}")
    print(f"  positions={l.get('positions')} totalPositions={l.get('totalPositions')} totalQty={l.get('totalQty')} totalQuantity={l.get('totalQuantity')}")
    print(f"  articles={ab.article_codes(l.get('articles'))[:8]}")
    pn = [(n.get('name') if isinstance(n,dict) else n) for n in (l.get('productNames') or [])]
    print(f"  productNames={pn[:6]}")
    li = l.get('lineItems') or []
    print(f"  lineItems({len(li)}):")
    for it in li[:8]:
        if isinstance(it, dict):
            print(f"     - art={it.get('article')!r} name={str(it.get('name') or it.get('productName') or '')[:40]!r} qty={it.get('quantity') or it.get('qty')}")
    qc = l.get('quantitiesClean') or []
    print(f"  quantitiesClean={[ (q.get('value'), q.get('source')) for q in qc if isinstance(q,dict)][:8]}")
