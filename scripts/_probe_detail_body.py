"""Check whether the detail endpoint returns the full up-to-4000-char bodyPreview,
and whether brand grounding on that text resolves the 42 'ghost' brands."""
import sys, os, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
import audit_baseline as ab

token = ab.login()
allm = []
for pid in ab.PROJECTS:
    d = ab.api_get(f"/api/projects/{pid}/messages", token)
    for m in (d.get("messages") or []):
        m["_project_id"] = pid; allm.append(m)
sample = ab.sample_messages(ab.filter_client(allm), 42, 300)
kb_a, kb_s, aliases = ab.load_kb()

ghosts = [m for m in sample if (r := ab.check_brand(m, kb_a, kb_s, aliases))["present"] and r["noise"]]
print(f"ghost messages: {len(ghosts)}")

list_lens = []; detail_lens = []; resolved = 0; still = 0
for m in ghosts:
    pid = m["_project_id"]; key = m.get("messageKey") or m.get("id")
    list_bp = m.get("bodyPreview") or ""
    u = f"/api/projects/{pid}/messages/{urllib.parse.quote(key, safe='')}"
    try:
        det = (ab.api_get(u, token).get("message") or {})
    except Exception as e:
        det = {}
    det_bp = det.get("bodyPreview") or ""
    list_lens.append(len(list_bp)); detail_lens.append(len(det_bp))
    # ground brands using detail bodyPreview
    gm = {key: {"body": det_bp, "att": ((det.get("analysis") or {}).get("attachmentAnalysis") or {}).get("combinedText") or ""}}
    r2 = ab.check_brand({**m, "messageKey": key}, kb_a, kb_s, aliases, gm)
    if not r2["noise"]:
        resolved += 1
    else:
        still += 1

import statistics
print(f"list bodyPreview len:   max={max(list_lens)} median={int(statistics.median(list_lens))}")
print(f"detail bodyPreview len: max={max(detail_lens)} median={int(statistics.median(detail_lens))}")
print(f"detail longer than list: {sum(1 for a,b in zip(detail_lens,list_lens) if a>b)}/{len(ghosts)}")
print(f"ghosts RESOLVED by detail body: {resolved}/{len(ghosts)}")
print(f"still ghost after detail body:  {still}/{len(ghosts)}")
