"""Комплексный аудит pochta-inbox-2026-04-19-postH.xlsx:
- ghost brands (бренд не в теле И не через KB artikul)
- дубли в товарах
- мусорные артикулы
- неправильные бренды (стоп-лист)
- количество > threshold
- кол-во писем с ошибками
"""
import pandas as pd
import re, sys, io, sqlite3
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

df = pd.read_excel('pochta-inbox-2026-04-19-postH.xlsx', sheet_name='Заявки')
for c in ['Тело письма','Тема','От','Бренды','Артикулы','Название товара','Компания']:
    df[c] = df[c].fillna('').astype(str)

kl = df[df['Категория']=='Клиент'].copy()
total = len(kl)
print(f'Всего писем "Заявки": {len(df)} | Клиент: {total}')
print()

# KB для разрешения article → brand
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

def normalize_article(a):
    return re.sub(r'[\s\-\.\/]', '', a).lower()

def tokens(s):
    return [t.strip() for t in re.split(r'[,;|]', s) if t.strip()]

# === 1. Ghost brands (KB-aware) ===
def is_brand_grounded(brand, body, subject, articles):
    body_low = body.lower(); subj_low = subject.lower()
    brand_low = brand.lower()
    if brand_low in body_low: return True
    aliases = brand_aliases.get(brand, set()) | {brand_low}
    for al in aliases:
        if len(al) >= 3 and al in body_low: return True
    for al in aliases:
        parts = [p for p in re.split(r'[\s\-_]+', al) if len(p) >= 4]
        if parts and all(p in body_low for p in parts): return True
    canon_toks = [t for t in re.split(r'[\s\-]+', brand_low) if len(t) >= 5]
    for t in canon_toks:
        if t in body_low: return True
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

kl['brand_list'] = kl['Бренды'].apply(tokens)
kl['art_list'] = kl['Артикулы'].apply(tokens)
kl['name_list'] = kl['Название товара'].apply(tokens)

ghost_rows = []
ghost_brand_counts = {}
for idx, r in kl.iterrows():
    for b in r['brand_list']:
        if not is_brand_grounded(b, r['Тело письма'], r['Тема'], r['art_list']):
            ghost_rows.append((r['№'], b))
            ghost_brand_counts[b] = ghost_brand_counts.get(b, 0) + 1

ghost_emails = set(n for n, _ in ghost_rows)
print('='*70)
print(f'1) GHOST-БРЕНДЫ (не в теле/subject/KB): {len(ghost_rows)} случаев в {len(ghost_emails)} письмах ({len(ghost_emails)/total*100:.1f}%)')
print('   Топ-15 ghost-брендов:')
for b, v in sorted(ghost_brand_counts.items(), key=lambda x: -x[1])[:15]:
    print(f'     "{b}" x{v}')

# === 2. Дубли в товарах ===
def has_dup_names(names):
    if len(names) < 2: return False
    norm = [re.sub(r'\s+', ' ', n.lower().strip()) for n in names]
    return len(set(norm)) < len(norm)

def dup_count(names):
    norm = [re.sub(r'\s+', ' ', n.lower().strip()) for n in names]
    return len(norm) - len(set(norm))

kl['dup_names'] = kl['name_list'].apply(has_dup_names)
kl['dup_names_n'] = kl['name_list'].apply(dup_count)
print()
print('='*70)
print(f'2) ДУБЛИ в "Название товара": {kl["dup_names"].sum()} писем')
for _, r in kl[kl['dup_names']].head(5).iterrows():
    names = r['name_list']
    print(f'   #{r["№"]}: {len(names)} позиций, {r["dup_names_n"]} дубликатов')
    print(f'     {names[:3]}...')

# === 3. Мусорные артикулы ===
bad_arts_exact = {'кол-ве','Конический','Диафрагменный','Зажимной','Метчики','Счетчик','Эластичная','Шаровые',
                  'Инкрементальный','Ручки-барашки','ОЛ-БРУ-СПБиПК','Россия','Москва','Санкт'}
year_pat = re.compile(r'^(19|20)\d{2}$')
uuid_pat = re.compile(r'^(uuid:|[a-f0-9]{8}-[a-f0-9]{4}-)', re.I)
desc_pat = re.compile(r'^DESC:', re.I)
cyr_only_pat = re.compile(r'^[А-Яа-яЁё\s\-\.]+$')
short_num_pat = re.compile(r'^\d{1,3}$')
localpart_pat = re.compile(r'^[a-z0-9._]+@', re.I)

def bad_articles(lst, from_email):
    locals_ = set()
    m = re.search(r'([a-z0-9._+-]+)@', str(from_email).lower())
    if m: locals_.add(m.group(1))
    bad = []
    for a in lst:
        a_clean = a.strip()
        if a_clean in bad_arts_exact: bad.append(('exact', a_clean)); continue
        if year_pat.match(a_clean): bad.append(('year', a_clean)); continue
        if uuid_pat.match(a_clean): bad.append(('uuid', a_clean)); continue
        if desc_pat.match(a_clean): bad.append(('desc', a_clean)); continue
        if cyr_only_pat.match(a_clean) and not re.search(r'\d', a_clean): bad.append(('cyr-only', a_clean)); continue
        if short_num_pat.match(a_clean) and len(a_clean) <= 3: bad.append(('short-num', a_clean)); continue
        if a_clean.lower() in locals_: bad.append(('localpart', a_clean)); continue
    return bad

kl['bad_arts'] = kl.apply(lambda r: bad_articles(r['art_list'], r['От']), axis=1)
kl['has_bad_art'] = kl['bad_arts'].apply(bool)
bad_samples = []
bad_art_types = {}
for _, r in kl.iterrows():
    for typ, a in r['bad_arts']:
        bad_art_types[typ] = bad_art_types.get(typ, 0) + 1
        if len(bad_samples) < 10: bad_samples.append((r['№'], typ, a))

print()
print('='*70)
print(f'3) МУСОРНЫЕ АРТИКУЛЫ: {kl["has_bad_art"].sum()} писем')
for t, v in sorted(bad_art_types.items(), key=lambda x: -x[1]):
    print(f'     {t}: {v}')
print('   Примеры:')
for n, t, a in bad_samples[:8]:
    print(f'     #{n} [{t}]: "{a}"')

# === 4. Артикул не в теле (слабое доказательство) ===
def art_not_in_body(lst, body):
    body_low = body.lower()
    body_norm = normalize_article(body)
    not_in = []
    for a in lst:
        if len(a) < 3: continue
        if a.lower() in body_low: continue
        # Нормализованный (без дефисов/точек) артикул
        if normalize_article(a) in body_norm: continue
        not_in.append(a)
    return not_in

kl['arts_not_in_body'] = kl.apply(lambda r: art_not_in_body(r['art_list'], r['Тело письма']), axis=1)
kl['arts_missing_body'] = kl['arts_not_in_body'].apply(bool)
# Сколько артикулов в среднем missing
print()
print('='*70)
print(f'4) АРТИКУЛ НЕ В ТЕЛЕ: {kl["arts_missing_body"].sum()} писем')
# Артикулы из вложений — легитимны, поэтому не считаем ошибкой автоматически
total_missing = sum(len(x) for x in kl['arts_not_in_body'])
print(f'   Всего артикулов не в теле: {total_missing} (могут быть из вложений)')

# === 5. ≥10 брендов ===
kl['many_brands'] = kl['brand_list'].apply(lambda x: len(x) >= 10)
kl['many_arts'] = kl['art_list'].apply(lambda x: len(x) >= 20)
print()
print('='*70)
print(f'5) ≥10 БРЕНДОВ в письме: {kl["many_brands"].sum()}')
print(f'   ≥20 АРТИКУЛОВ в письме: {kl["many_arts"].sum()}')
for _, r in kl[kl['many_brands']].head(5).iterrows():
    print(f'     #{r["№"]}: {len(r["brand_list"])} брендов: {r["brand_list"][:5]}...')

# === 6. Стоп-лист брендов (уже известные false positives) ===
stopbrand = {'Россия','Москва','Санкт','True','Select','Check','Power','Motor','Sensor'}
def has_stop(lst): return [b for b in lst if b in stopbrand]
kl['stop_brands'] = kl['brand_list'].apply(has_stop)
kl['has_stop'] = kl['stop_brands'].apply(bool)
print()
print('='*70)
print(f'6) СТОП-БРЕНДЫ (точные false positives): {kl["has_stop"].sum()}')
for _, r in kl[kl['has_stop']].head(5).iterrows():
    print(f'     #{r["№"]}: {r["stop_brands"]}')

# === 7. Итог ===
kl['has_ghost'] = kl['№'].isin(ghost_emails)
any_err = kl['has_ghost'] | kl['has_bad_art'] | kl['many_brands'] | kl['many_arts'] | kl['has_stop'] | kl['dup_names']
print()
print('='*70)
print('СВОДКА:')
print(f'  Всего Клиент: {total}')
print(f'  Ghost-брендов: {kl["has_ghost"].sum()} ({kl["has_ghost"].sum()/total*100:.1f}%)')
print(f'  Мусорных артикулов: {kl["has_bad_art"].sum()} ({kl["has_bad_art"].sum()/total*100:.1f}%)')
print(f'  ≥10 брендов: {kl["many_brands"].sum()}')
print(f'  ≥20 артикулов: {kl["many_arts"].sum()}')
print(f'  Стоп-брендов: {kl["has_stop"].sum()}')
print(f'  Дубли товаров: {kl["dup_names"].sum()}')
print(f'  Уникальных писем с ≥1 ошибкой: {any_err.sum()} ({any_err.sum()/total*100:.1f}%)')
print(f'  ТОЧНОСТЬ (refined): {(1 - any_err.sum()/total)*100:.2f}%')

# Сохранить reports
kl['errors'] = kl.apply(lambda r: [
    *(['ghost:'+b for b in r['brand_list'] if not is_brand_grounded(b, r['Тело письма'], r['Тема'], r['art_list'])]),
    *(['bad_art:'+t+':'+a for t,a in r['bad_arts']]),
    *(['stop:'+b for b in r['stop_brands']]),
    *(['dup_names'] if r['dup_names'] else []),
    *(['many_brands'] if r['many_brands'] else []),
    *(['many_arts'] if r['many_arts'] else []),
], axis=1)
errdf = kl[any_err][['№','От','Тема','Бренды','Артикулы','Название товара','errors']].copy()
errdf['errors'] = errdf['errors'].apply(lambda x: '; '.join(x))
errdf.to_excel('pochta-audit-2026-04-19-postH.xlsx', index=False)
print()
print(f'Отчёт сохранён: pochta-audit-2026-04-19-postH.xlsx ({len(errdf)} writes)')
