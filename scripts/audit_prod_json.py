"""Аудит на JSON с учётом attachmentAnalysis.combinedText (более точный чем XLSX-аудит)."""
import json, re, sys, io, sqlite3
from collections import Counter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('data/prod-messages-2026-04-19-postH.json', 'r', encoding='utf-8') as f:
    msgs = json.load(f)

# KB
c = sqlite3.connect('data/detection-kb.sqlite')
kb_article_to_brand = {}
for art_norm, brand in c.execute("SELECT article_normalized, brand FROM nomenclature_dictionary WHERE brand != ''").fetchall():
    kb_article_to_brand.setdefault(art_norm.lower(), set()).add(brand)
kb_article_to_brand_str = {}
for art, brand in c.execute("SELECT article, brand FROM nomenclature_dictionary WHERE brand != ''").fetchall():
    kb_article_to_brand_str.setdefault(art.lower(), set()).add(brand)
brand_aliases = {}
for canonical, alias in c.execute("SELECT canonical_brand, alias FROM brand_aliases WHERE is_active=1").fetchall():
    brand_aliases.setdefault(canonical, set()).add(alias.lower())

def normalize_article(a): return re.sub(r'[\s\-\.\/]', '', a).lower()

def is_brand_grounded(brand, body, subject, attachment_text, articles):
    full = body + '\n' + attachment_text
    full_low = full.lower(); subj_low = subject.lower()
    brand_low = brand.lower()
    if brand_low in full_low: return True
    aliases = brand_aliases.get(brand, set()) | {brand_low}
    for al in aliases:
        if len(al) >= 3 and al in full_low: return True
    for al in aliases:
        parts = [p for p in re.split(r'[\s\-_]+', al) if len(p) >= 4]
        if parts and all(p in full_low for p in parts): return True
    canon_toks = [t for t in re.split(r'[\s\-]+', brand_low) if len(t) >= 5]
    for t in canon_toks:
        if t in full_low: return True
    for al in aliases | {brand_low}:
        if len(al) >= 5 and al in subj_low: return True
    for art in articles:
        if not art or len(art) < 3: continue
        art_low = art.lower()
        art_norm = normalize_article(art)
        bs = kb_article_to_brand.get(art_norm, set()) | kb_article_to_brand_str.get(art_low, set())
        if brand in bs: return True
        for t in canon_toks:
            if t in art_low: return True
    return False

bad_arts_exact = {'кол-ве','Конический','Диафрагменный','Зажимной','Метчики','Счетчик','Эластичная','Шаровые',
                  'Инкрементальный','Ручки-барашки','ОЛ-БРУ-СПБиПК','Россия','Москва','Санкт'}
year_pat = re.compile(r'^(19|20)\d{2}$')
uuid_pat = re.compile(r'^(uuid:|[a-f0-9]{8}-[a-f0-9]{4}-)', re.I)
desc_pat = re.compile(r'^DESC:', re.I)
cyr_only_pat = re.compile(r'^[А-Яа-яЁё\s\-\.]+$')
short_num_pat = re.compile(r'^\d{1,3}$')

def bad_articles(lst, from_email):
    locals_ = set()
    m = re.search(r'([a-z0-9._+-]+)@', str(from_email).lower())
    if m: locals_.add(m.group(1))
    bad = []
    for a in lst:
        a_clean = str(a).strip()
        if a_clean in bad_arts_exact: bad.append(('exact', a_clean)); continue
        if year_pat.match(a_clean): bad.append(('year', a_clean)); continue
        if uuid_pat.match(a_clean): bad.append(('uuid', a_clean)); continue
        if desc_pat.match(a_clean): bad.append(('desc', a_clean)); continue
        if cyr_only_pat.match(a_clean) and not re.search(r'\d', a_clean): bad.append(('cyr-only', a_clean)); continue
        if short_num_pat.match(a_clean) and len(a_clean) <= 3: bad.append(('short-num', a_clean)); continue
        if a_clean.lower() in locals_: bad.append(('localpart', a_clean)); continue
    return bad

stopbrand = {'Россия','Москва','Санкт','True','Select','Check','Power','Motor','Sensor'}

# Filter client
client = [m for m in msgs if ((m.get('analysis') or {}).get('classification') or {}).get('label') == 'Клиент']
total = len(client)
print(f'Всего Клиент: {total}')

ghost_rows = []
ghost_brand_counts = Counter()
bad_art_rows = []
bad_art_counts = Counter()
stop_rows = []
dup_rows = []
many_brands_rows = []
many_arts_rows = []

for m in client:
    a = m.get('analysis') or {}
    l = a.get('lead') or {}
    brands = a.get('detectedBrands') or []
    articles = [str(x) for x in (l.get('articles') or []) if x]
    body = m.get('bodyPreview') or ''
    subject = m.get('subject') or ''
    att = ((a.get('attachmentAnalysis') or {}).get('combinedText') or '')
    msg_id = m.get('id') or m.get('messageKey','')

    # Ghost
    for b in brands:
        if not is_brand_grounded(b, body, subject, att, articles):
            ghost_rows.append((msg_id, b))
            ghost_brand_counts[b] += 1

    # Bad articles
    ba = bad_articles(articles, m.get('from',''))
    if ba:
        bad_art_rows.append((msg_id, ba))
        for t, _ in ba: bad_art_counts[t] += 1

    # Stop brands
    stops = [b for b in brands if b in stopbrand]
    if stops: stop_rows.append((msg_id, stops))

    # Many brands / articles
    if len(brands) >= 10: many_brands_rows.append((msg_id, len(brands), brands))
    if len(articles) >= 20: many_arts_rows.append((msg_id, len(articles)))

    # Dup names — реальный дубль ТОЛЬКО если и article и name совпадают
    pairs = []
    for p in (l.get('productNames') or []):
        if isinstance(p, dict):
            n = p.get('name') or p.get('product_name') or ''
            art = p.get('article') or ''
        else:
            n = str(p); art = ''
        if n: pairs.append((str(art).strip().lower(), re.sub(r'\s+', ' ', n.lower().strip())))
    uniq_pairs = set(pairs)
    if len(pairs) >= 2 and len(uniq_pairs) < len(pairs):
        dup_rows.append((msg_id, len(pairs) - len(uniq_pairs), [p[1] for p in pairs[:3]]))

ghost_emails = set(mid for mid, _ in ghost_rows)
bad_art_emails = set(mid for mid, _ in bad_art_rows)
stop_emails = set(mid for mid, _ in stop_rows)
many_b_emails = set(mid for mid, _, _ in many_brands_rows)
many_a_emails = set(mid for mid, _ in many_arts_rows)
dup_emails = set(mid for mid, _, _ in dup_rows)

any_err = ghost_emails | bad_art_emails | stop_emails | many_b_emails | many_a_emails | dup_emails

print()
print('='*70)
print(f'1) GHOST-БРЕНДЫ (KB-aware + attachment-aware): {len(ghost_rows)} в {len(ghost_emails)} письмах ({len(ghost_emails)/total*100:.1f}%)')
print('   Топ-15 ghost:')
for b, v in ghost_brand_counts.most_common(15):
    print(f'     "{b}" x{v}')

print()
print(f'2) МУСОРНЫЕ АРТИКУЛЫ: {len(bad_art_emails)} писем ({len(bad_art_emails)/total*100:.1f}%)')
for t, v in sorted(bad_art_counts.items(), key=lambda x: -x[1]):
    print(f'     {t}: {v}')

print()
print(f'3) СТОП-БРЕНДЫ: {len(stop_emails)}')
print(f'4) ≥10 брендов: {len(many_b_emails)}')
print(f'5) ≥20 артикулов: {len(many_a_emails)}')
print(f'6) ДУБЛИ товаров: {len(dup_emails)}')

print()
print('='*70)
print('СВОДКА (adjusted for attachments):')
print(f'  Ghost: {len(ghost_emails)} ({len(ghost_emails)/total*100:.1f}%)')
print(f'  Мусор: {len(bad_art_emails)} ({len(bad_art_emails)/total*100:.1f}%)')
print(f'  Стоп: {len(stop_emails)}')
print(f'  ≥10 брендов: {len(many_b_emails)}')
print(f'  ≥20 артикулов: {len(many_a_emails)}')
print(f'  Дубли: {len(dup_emails)}')
print(f'  УНИКАЛЬНЫХ с ≥1 ошибкой: {len(any_err)} ({len(any_err)/total*100:.1f}%)')
print(f'  ТОЧНОСТЬ: {(1 - len(any_err)/total)*100:.2f}%')

# Save detailed report
with open('data/audit_postH_details.json', 'w', encoding='utf-8') as f:
    json.dump({
        'total': total,
        'ghost_emails': list(ghost_emails),
        'ghost_brands_top': ghost_brand_counts.most_common(50),
        'bad_art_emails': list(bad_art_emails),
        'bad_art_types': dict(bad_art_counts),
        'stop_rows': stop_rows,
        'many_brands_rows': [(mid, n, br[:5]) for mid, n, br in many_brands_rows],
        'many_arts_rows': many_arts_rows,
        'dup_rows': dup_rows,
        'any_err_ids': list(any_err),
    }, f, ensure_ascii=False, indent=2)
print(f'\nДетали: data/audit_postH_details.json')
