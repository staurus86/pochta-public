"""Unit tests for the audit metric fixes (Track A).
Run: python scripts/test_audit_metrics.py
Covers check_positions v2 (A1) and check_brand grounding source (A2)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import audit_baseline as ab

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name}")

def msg_with_lead(lead):
    return {"analysis": {"lead": lead}}

print("== A1: check_positions v2 ==")
# Known-good: article-only B2B request — positions present, no quantity total.
# OLD metric flagged this as noise; v2 must NOT.
m = msg_with_lead({"articles": ["1092-1/PN", "S235JRG2"], "positions": 4,
                   "totalQty": 0, "totalQuantity": None})
r = ab.check_positions(m)
check("article-only positions present", r["present"] is True)
check("article-only NOT noise (v2)", r["noise"] is False)

# Known-bad: implausible position count (contamination) -> noise.
m = msg_with_lead({"articles": ["X"], "positions": ab.POSITIONS_OUTLIER + 1, "totalQty": 0})
check("outlier positions = noise", ab.check_positions(m)["noise"] is True)

# Boundary: exactly at threshold is not noise.
m = msg_with_lead({"articles": ["X"], "positions": ab.POSITIONS_OUTLIER, "totalQty": 0})
check("threshold positions NOT noise", ab.check_positions(m)["noise"] is False)

# No articles -> not present, not noise.
m = msg_with_lead({"articles": [], "positions": 5})
r = ab.check_positions(m)
check("no articles -> not present", r["present"] is False and r["noise"] is False)

# Positions zero with articles -> present False.
m = msg_with_lead({"articles": ["X"], "positions": 0})
check("zero positions -> not present", ab.check_positions(m)["present"] is False)

print("== A2: check_brand grounding ==")
kb_a, kb_s, aliases = {}, {}, {}
# Brand detected but text stripped (no body/att) -> ghost (noise) without grounding.
ghost_msg = {
    "messageKey": "k1",
    "subject": "Запрос",
    "bodyPreview": "Добрый день, прошу КП.",  # brand NOT in visible text
    "analysis": {"detectedBrands": ["Schaeffler"], "lead": {"articles": []}},
}
r = ab.check_brand(ghost_msg, kb_a, kb_s, aliases, None)
check("stripped text -> brand looks like ghost", r["present"] is True and r["noise"] is True)

# Same brand, but a full-text ground_map provides the source text -> grounded (not noise).
ground_map = {"k1": {"body": "Нужны подшипники Schaeffler по заявке", "att": ""}}
r = ab.check_brand(ghost_msg, kb_a, kb_s, aliases, ground_map)
check("grounded via dump -> not ghost", r["noise"] is False)

# Grounding via attachment text only.
ground_map = {"k1": {"body": "", "att": "Spec sheet: Schaeffler 6204-2RS"}}
r = ab.check_brand(ghost_msg, kb_a, kb_s, aliases, ground_map)
check("grounded via attachment text -> not ghost", r["noise"] is False)

# No brands -> not present.
r = ab.check_brand({"analysis": {"detectedBrands": [], "lead": {}}}, kb_a, kb_s, aliases, None)
check("no brands -> not present", r["present"] is False)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
