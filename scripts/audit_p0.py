"""P0 audit — hunts massive patterns of errors in articles / product names / duplicates / false positives.

Reads data/prod-messages-local-postAudit2.json (or passed JSON).
Produces bug buckets with real message IDs + examples for downstream fixes.
"""
import json, re, sys, io, os
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROD_JSON = sys.argv[1] if len(sys.argv) > 1 else 'C:/Opencode-test/pochta/data/prod-messages-local-postAudit2.json'
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else 'C:/Opencode-test/pochta/.planning/phases/01-detection-fixes'
os.makedirs(OUT_DIR, exist_ok=True)

with open(PROD_JSON, 'r', encoding='utf-8') as f:
    _d = json.load(f)
    msgs = _d['messages'] if isinstance(_d, dict) else _d

client = [m for m in msgs if ((m.get('analysis') or {}).get('classification') or {}).get('label') == 'Клиент']
total = len(client)
print(f'P0 AUDIT: {total} client messages from {PROD_JSON}\n')

# ---------- Helpers ----------
DIGIT_ONLY_RE = re.compile(r'^\d+$')
YEAR_RE = re.compile(r'^(19|20)\d{2}$')
PHONE_LIKE_RE = re.compile(r'^\+?[78]?[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}$')
INN_LIKE_RE = re.compile(r'^\d{10}$|^\d{12}$')
DATE_LIKE_RE = re.compile(r'^\d{2}[./-]\d{2}[./-]\d{2,4}$')
OFN_RE = re.compile(r'^\d{1,4}$')  # short pure digit

URL_RE = re.compile(r'https?://|www\.', re.I)
EMAIL_FRAG_RE = re.compile(r'[\w.+-]+@[\w.-]+')
HTML_TAG_RE = re.compile(r'<[^>]+>')
CSS_RE = re.compile(r'\bfont-(?:family|size|weight|style)\b|\bcolor\s*:|mso-|\b(?:Arial|Helvetica|Calibri|Times\s+New\s+Roman)\b', re.I)
GOST_RE = re.compile(r'^ГОСТ[\s-]?\d', re.I)
SHORT_CYR_RE = re.compile(r'^[А-ЯЁа-яё]{1,3}$')
DECIMAL_NUM_RE = re.compile(r'^\d{1,3}[.,]\d+$')
PAGE_NOISE_RE = re.compile(r'^(page|mailto|e-?mail|WordSection|mso|span|div|class|style|table|tr|td)\b', re.I)
OFFICE_NUM_RE = re.compile(r'^(?:оф|каб|комн|этаж)\b', re.I)
ADDRESS_RE = re.compile(r'\b(?:стр|д|дом|пер|пр-т|просп|ш|ул|наб|кв|оф|корп|к)\.?\s*\d', re.I)

# ---------- Buckets ----------
bugs = defaultdict(list)
metrics = Counter()

def add(bucket, mid, payload):
    bugs[bucket].append((mid, payload))

for m in client:
    mid = m.get('id') or m.get('messageKey')
    a = m.get('analysis') or {}
    lead = a.get('lead') or {}
    status = m.get('pipelineStatus', '')
    subject = m.get('subject') or ''
    body = m.get('bodyPreview') or ''

    articles = lead.get('articles') or []
    brands = lead.get('detectedBrands') or []
    product_names = lead.get('productNames') or []
    product_names_clean = lead.get('productNamesClean') or []
    line_items = lead.get('lineItems') or []
    product_line_items = lead.get('productLineItems') or []

    # ==============================
    # P0-A: ARTICLES — false positives + duplicates
    # ==============================
    seen_norm = Counter()
    for art in articles:
        art_s = str(art).strip()
        if not art_s: continue
        norm = art_s.lower().replace(' ', '').replace('-', '').replace('/', '')
        seen_norm[norm] += 1

        # A1: digit-only that look like years
        if YEAR_RE.match(art_s):
            add('A1_year_as_article', mid, art_s)
        # A2: phone-like
        if PHONE_LIKE_RE.match(art_s) or (DIGIT_ONLY_RE.match(art_s) and len(art_s) == 11):
            add('A2_phone_as_article', mid, art_s)
        # A3: INN-like (10 or 12 digits pure)
        if INN_LIKE_RE.match(art_s):
            add('A3_inn_as_article', mid, art_s)
        # A4: date-like
        if DATE_LIKE_RE.match(art_s):
            add('A4_date_as_article', mid, art_s)
        # A5: very short pure digits (1-3 char)
        if DIGIT_ONLY_RE.match(art_s) and len(art_s) <= 3:
            add('A5_tiny_digit_article', mid, art_s)
        # A6: decimal numbers (1.5, 2,3)
        if DECIMAL_NUM_RE.match(art_s):
            add('A6_decimal_as_article', mid, art_s)
        # A7: GOST or standard
        if GOST_RE.match(art_s):
            add('A7_gost_as_article', mid, art_s)
        # A8: short cyrillic noise (2-3 cyr letters)
        if SHORT_CYR_RE.match(art_s):
            add('A8_short_cyr_article', mid, art_s)
        # A9: HTML/CSS tokens
        if HTML_TAG_RE.search(art_s) or CSS_RE.search(art_s):
            add('A9_html_css_article', mid, art_s)
        # A10: page/email noise
        if PAGE_NOISE_RE.match(art_s) or EMAIL_FRAG_RE.search(art_s) or URL_RE.search(art_s):
            add('A10_pagemail_article', mid, art_s)
        # A11: office / address tokens
        if OFFICE_NUM_RE.match(art_s) or ADDRESS_RE.match(art_s):
            add('A11_address_as_article', mid, art_s)

    # A12: duplicate articles in one email (case/format-insensitive)
    dup_articles = {k: v for k, v in seen_norm.items() if v > 1}
    if dup_articles:
        add('A12_duplicate_articles', mid, {'count': sum(v-1 for v in dup_articles.values()), 'items': list(dup_articles.keys())[:5]})

    # A13: too many articles (likely pollution) — >20 usually means over-extraction
    if len(articles) > 20:
        add('A13_over_extraction_articles', mid, {'count': len(articles), 'sample': articles[:6]})

    # ==============================
    # P0-B: PRODUCT NAMES — joining + duplicates
    # ==============================
    seen_names = Counter()
    for pn in product_names_clean:
        pn_s = str(pn).strip()
        if not pn_s: continue
        norm = pn_s.lower().strip()
        seen_names[norm] += 1

        # B1: contains HTML/CSS
        if HTML_TAG_RE.search(pn_s) or CSS_RE.search(pn_s):
            add('B1_html_in_title', mid, pn_s[:100])
        # B2: contains email fragment
        if EMAIL_FRAG_RE.search(pn_s) or URL_RE.search(pn_s):
            add('B2_email_url_in_title', mid, pn_s[:100])
        # B3: title too short (< 4 chars)
        if len(pn_s) < 4:
            add('B3_tiny_title', mid, pn_s)
        # B4: title is just digits or pure article
        if re.match(r'^[A-Z0-9\-./]+$', pn_s) and len(pn_s) < 25:
            add('B4_looks_like_article_only', mid, pn_s)
        # B5: title contains quoted-thread markers
        if re.search(r'^(?:>\s*|---+\s*(?:Original|Forwarded))', pn_s, re.I):
            add('B5_quoted_marker_title', mid, pn_s[:100])
        # B6: includes legal form + "бренды" (capability list)
        if re.search(r'Бренды|бренды,\s+по\s+которым', pn_s):
            add('B6_capability_list_title', mid, pn_s[:100])
        # B7: huge title (>300 chars = likely blob)
        if len(pn_s) > 300:
            add('B7_blob_title', mid, {'len': len(pn_s), 'head': pn_s[:120]})

    # B8: duplicate product titles (same name twice+)
    dup_names = {k: v for k, v in seen_names.items() if v > 1}
    if dup_names:
        add('B8_duplicate_titles', mid, {'count': sum(v-1 for v in dup_names.values()), 'items': list(dup_names.keys())[:5]})

    # B9: over-extraction (>30 titles)
    if len(product_names_clean) > 30:
        add('B9_over_extraction_titles', mid, {'count': len(product_names_clean)})

    # ==============================
    # P0-C: LINE ITEMS duplicates + contamination
    # ==============================
    line_seen = Counter()
    for li in line_items:
        art = (li.get('article') or '').strip().lower()
        qty = li.get('quantity')
        desc = (li.get('descriptionRu') or '').strip().lower()
        key = f'{art}|{qty}|{desc[:60]}'
        line_seen[key] += 1
    dup_lines = {k: v for k, v in line_seen.items() if v > 1}
    if dup_lines:
        add('C1_duplicate_line_items', mid, {'count': sum(v-1 for v in dup_lines.values())})

    # ==============================
    # P0-D: BRANDS — false positives + ghosts
    # ==============================
    # D1: brand with only punctuation/digits (ghost)
    for br in brands:
        br_s = str(br).strip()
        if not br_s: continue
        if DIGIT_ONLY_RE.match(br_s) or len(br_s) < 2:
            add('D1_ghost_brand', mid, br_s)
        if HTML_TAG_RE.search(br_s) or CSS_RE.search(br_s):
            add('D2_html_css_brand', mid, br_s)
        # D3: pure-cyrillic very short brand (2-3 letter)
        if SHORT_CYR_RE.match(br_s):
            add('D3_short_cyr_brand', mid, br_s)
        # D4: looks like country/region (Россия, Украина, РФ)
        if re.match(r'^(Россия|РФ|Украина|Беларусь|Казахстан|Kazakhstan|Belarus|Russia)$', br_s, re.I):
            add('D4_country_as_brand', mid, br_s)

    # D5: too many brands (pollution)
    if len(brands) > 10:
        add('D5_over_extraction_brands', mid, {'count': len(brands), 'sample': brands[:6]})

    # ==============================
    # P0-E: CROSS-FIELD CONTAMINATION
    # ==============================
    # E1: brand == article (same token in both buckets)
    brand_lower = {str(b).lower() for b in brands}
    for art in articles:
        a_lower = str(art).lower()
        if a_lower in brand_lower:
            add('E1_article_equals_brand', mid, art)
            break

    # E2: article appears in productName (full token match)
    if articles and product_names_clean:
        art_set = {str(a) for a in articles}
        for pn in product_names_clean:
            toks = re.findall(r'[A-Z0-9][A-Z0-9\-./]{2,}', pn)
            overlap = art_set & set(toks)
            if overlap and len(pn) < 40:  # short title that's basically an article
                add('E2_title_is_article', mid, {'title': pn, 'art': list(overlap)[:2]})
                break

    metrics['total'] += 1
    if articles: metrics['with_articles'] += 1
    if brands: metrics['with_brands'] += 1
    if product_names_clean: metrics['with_titles'] += 1

# ---------- Report ----------
print(f'{"="*75}\nSUMMARY\n{"="*75}')
print(f'Total client: {metrics["total"]}')
print(f'  with_articles: {metrics["with_articles"]}')
print(f'  with_brands:   {metrics["with_brands"]}')
print(f'  with_titles:   {metrics["with_titles"]}\n')

order = [
    # ARTICLES
    'A1_year_as_article', 'A2_phone_as_article', 'A3_inn_as_article', 'A4_date_as_article',
    'A5_tiny_digit_article', 'A6_decimal_as_article', 'A7_gost_as_article', 'A8_short_cyr_article',
    'A9_html_css_article', 'A10_pagemail_article', 'A11_address_as_article',
    'A12_duplicate_articles', 'A13_over_extraction_articles',
    # TITLES
    'B1_html_in_title', 'B2_email_url_in_title', 'B3_tiny_title', 'B4_looks_like_article_only',
    'B5_quoted_marker_title', 'B6_capability_list_title', 'B7_blob_title',
    'B8_duplicate_titles', 'B9_over_extraction_titles',
    # LINE ITEMS
    'C1_duplicate_line_items',
    # BRANDS
    'D1_ghost_brand', 'D2_html_css_brand', 'D3_short_cyr_brand', 'D4_country_as_brand', 'D5_over_extraction_brands',
    # CROSS
    'E1_article_equals_brand', 'E2_title_is_article',
]

print(f'{"BUCKET":40s} {"MSG":>6} {"INST":>6}')
print('-'*58)
report = {}
for b in order:
    items = bugs[b]
    n_msg = len({x[0] for x in items})
    n_inst = len(items)
    report[b] = {'msgs': n_msg, 'instances': n_inst, 'examples': items[:8]}
    print(f'{b:40s} {n_msg:6d} {n_inst:6d}')

# Save detail dump
with open(os.path.join(OUT_DIR, 'P0_AUDIT.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2, default=str)
print(f'\nSaved detail → {OUT_DIR}/P0_AUDIT.json')
