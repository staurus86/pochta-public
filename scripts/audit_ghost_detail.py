"""Детализация ghost brands: показать body, sender, article context для анализа."""
import pandas as pd, re, sys, io, sqlite3, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

df = pd.read_excel('pochta-inbox-2026-04-19-postH.xlsx', sheet_name='Заявки')
for c in ['Тело письма','Тема','От','Бренды','Артикулы','Название товара','Компания']:
    df[c] = df[c].fillna('').astype(str)

kl = df[df['Категория']=='Клиент'].copy()

# KB resolution
c = sqlite3.connect('data/detection-kb.sqlite')
kb_article_to_brand = {}
for art_norm, brand in c.execute("SELECT article_normalized, brand FROM nomenclature_dictionary WHERE brand != ''").fetchall():
    kb_article_to_brand.setdefault(art_norm.lower(), set()).add(brand)
brand_aliases = {}
for canonical, alias in c.execute("SELECT canonical_brand, alias FROM brand_aliases WHERE is_active=1").fetchall():
    brand_aliases.setdefault(canonical, set()).add(alias.lower())

def normalize_article(a): return re.sub(r'[\s\-\.\/]', '', a).lower()
def tokens(s): return [t.strip() for t in re.split(r'[,;|]', s) if t.strip()]

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
        art_norm = normalize_article(art)
        bs = kb_article_to_brand.get(art_norm, set())
        if brand in bs: return True
        for t in canon_toks:
            if t in art.lower(): return True
    return False

target_brands = {'System Plast','WIKA','item','Single','ROSEMOUNT','Hydac'}

kl['brand_list'] = kl['Бренды'].apply(tokens)
kl['art_list'] = kl['Артикулы'].apply(tokens)

printed = 0
for idx, r in kl.iterrows():
    for b in r['brand_list']:
        if b in target_brands and not is_brand_grounded(b, r['Тело письма'], r['Тема'], r['art_list']):
            print('='*70)
            print(f"#{r['№']} ghost-brand: {b}")
            print(f"От: {r['От']}")
            print(f"Тема: {r['Тема'][:100]}")
            body = r['Тело письма'][:500]
            print(f"Тело (500): {body}")
            print(f"Артикулы: {r['art_list'][:10]}")
            print(f"Все бренды: {r['brand_list']}")
            print(f"Название товара: {r['Название товара'][:200]}")
            printed += 1
            if printed >= 8:
                sys.exit(0)
