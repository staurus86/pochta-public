"""Детально изучить ≥20 артикулов: сколько legit (big tender) vs FP (мусор)."""
import json, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('data/prod-messages-2026-04-19-postH.json','r',encoding='utf-8') as f: msgs = json.load(f)

# Identifies obvious noise from article string alone
NOISE_RE = re.compile(
    r'^(?:'
    r'uuid:|mozilla/|'
    r'(?:RED|GREEN|BLUE|RGB|RGBA|HSL|HSLA)\d+|'
    r'\d{4}$|'  # bare 4-digit year
    r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{2,}|'  # UUID
    r'#[0-9a-f]{3,6};?$|'  # hex color
    r'(?:size|color|font|background|margin|padding|width|height|style)\s*[:=]|'
    r'\d{1,2}(?:-\d+)+$|'  # date-like
    r'[a-f0-9]{16,}$'  # long hex
    r')', re.I)

FONT_RE = re.compile(r'^(?:NotoSans|ArialMT|TimesNewRoman|HelveticaNeue|CourierNew|LucidaConsole|CalibriLight|Roboto|OpenSans|Lato|Montserrat|PTSans|PTSerif|Dejavu|Liberation|[A-Z][A-Za-z0-9]+-(?:Regular|Bold|Light|Italic|Medium|Thin|Heavy|Black|SemiBold|ExtraBold))', re.I)

def is_noise_art(a):
    s = str(a).strip()
    if not s: return False
    if NOISE_RE.match(s): return True
    if FONT_RE.match(s): return True
    return False

client = [m for m in msgs if ((m.get('analysis') or {}).get('classification') or {}).get('label') == 'Клиент']
many = [(m, m.get('analysis',{}).get('lead',{}).get('articles') or []) for m in client]
many = [(m, arts) for m, arts in many if len(arts) >= 20]
print(f'Писем с >=20 артикулов: {len(many)}')

legit = 0
fp = 0
for m, arts in many:
    noise_n = sum(1 for a in arts if is_noise_art(a))
    ratio = noise_n / len(arts)
    if ratio > 0.3:
        fp += 1
        print(f"  FP #{m.get('id','')[:12]}: {len(arts)} arts, {noise_n} noise ({ratio:.0%}) — samples: {[a for a in arts if is_noise_art(a)][:3]}")
    else:
        legit += 1

print(f'\nLegit (большие tender): {legit}')
print(f'FP (мусор): {fp}')
