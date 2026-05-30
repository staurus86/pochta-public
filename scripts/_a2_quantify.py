"""A2 quantification: how much does the text-stripped live payload understate brand
noise_free vs full-text grounding? Measured on postH (has attachment text for ~780 msgs)
over the SAME Клиент message set, comparing stripped-sim vs full-text grounding."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import audit_baseline as ab

DUMP = "data/prod-messages-2026-04-19-postH.json"
raw = json.load(open(DUMP, encoding="utf-8"))
msgs = raw["messages"] if isinstance(raw, dict) else raw
client = ab.filter_client(msgs)
kb_a, kb_s, aliases = ab.load_kb()

# Full-text ground map from the dump itself.
full_gm = ab.load_ground_map(DUMP)
# Stripped simulation: body=bodyPreview only, attachment text blanked.
strip_gm = {}
for m in client:
    k = m.get("messageKey") or m.get("id")
    if k:
        strip_gm[k] = {"body": (m.get("bodyPreview") or "")[:600], "att": ""}

ghost_strip = ghost_full = present = 0
resolved = 0
for m in client:
    rs = ab.check_brand(m, kb_a, kb_s, aliases, strip_gm)
    rf = ab.check_brand(m, kb_a, kb_s, aliases, full_gm)
    if rs["present"]:
        present += 1
    if rs["present"] and rs["noise"]:
        ghost_strip += 1
    if rf["present"] and rf["noise"]:
        ghost_full += 1
    if rs["present"] and rs["noise"] and not rf["noise"]:
        resolved += 1

n = len(client)
print(f"dump: {DUMP}")
print(f"Клиент messages: {n}")
print(f"with attachment text in dump: {sum(1 for v in full_gm.values() if v['att'])}")
print()
print(f"brand present:                {present}")
print(f"ghost on STRIPPED text:       {ghost_strip}  -> noise_free = {(present-ghost_strip)/n*100:.1f}%")
print(f"ghost on FULL text:           {ghost_full}  -> noise_free = {(present-ghost_full)/n*100:.1f}%")
print(f"ghosts RESOLVED by full text: {resolved}  ({resolved/max(ghost_strip,1)*100:.0f}% of stripped-ghosts were artifacts)")
print(f"measurement understatement:   {(ghost_strip-ghost_full)/n*100:.1f}pp of brand.noise_free")
