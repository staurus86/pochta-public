"""Entity extraction quality audit per TZ 2026-04-19 (12 пунктов).

Reads data/prod-messages-2026-04-19-postH.json + optional XLSX for spam sheet audit.
Emits metrics matching business acceptance criteria.
"""
import json, re, sys, io
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PROD_JSON = sys.argv[1] if len(sys.argv) > 1 else 'data/prod-messages-2026-04-19-postH.json'
with open(PROD_JSON, 'r', encoding='utf-8') as f:
    _d = json.load(f)
    msgs = _d['messages'] if isinstance(_d, dict) else _d

# --- constants ---
READY = 'ready_for_crm'

# ФИО stop-words: legal forms + job titles
ORG_RE = re.compile(r'\b(?:ООО|ОАО|ЗАО|АО|ПАО|ИП|ФГУП|МУП|ГУП|НКО|АНО|LLC|Ltd\.?|GmbH|JSC|Inc\.?|S\.A\.|B\.V\.)\b', re.U)
TITLE_RE = re.compile(r'\b(?:менеджер|директор|руководитель|специалист|начальник|главный|инженер|бухгалтер|'
                      r'отдел\s+продаж|отдел\s+закупок|отдел\s+снабжения|генеральный|коммерческий|'
                      r'manager|director|sales|purchasing|engineer)\b', re.I|re.U)
MULTILINE_RE = re.compile(r'\n')

# Company HTML / URL / broken quotes
HTML_RE = re.compile(r'<[^>]+>|&lt;|&gt;|&nbsp;')
URL_RE = re.compile(r'https?://|www\.|mailto:', re.I)
EMAIL_FRAG_RE = re.compile(r'[\w.+-]+@[\w.-]+')
# broken quote: opening quote without matching close (or vice versa)
def has_broken_quotes(s):
    # Flags truly unbalanced quotes: guillemets («») or curly quotes („" ""»).
    # ASCII " has no separate close char, so parity-check it only.
    if not s: return False
    pairs = {'«': '»', '“': '”'}
    for op, cl in pairs.items():
        if s.count(op) != s.count(cl): return True
    if s.count('"') % 2 != 0: return True
    return False

# Article noise
ARTICLE_NOISE_RE = re.compile(r'(?:^|\s)(?:mailto:|page:|WordSection\d*|^mail$|e-mail|^\s*mail)', re.I)
ARTICLE_BAD_TOKENS = re.compile(r'^(?:page:|mailto:|WordSection|.*E-mail|.*@.*|.*\.com|.*\.ru)$', re.I)

# Phone pattern in body
PHONE_BODY_RE = re.compile(r'(?:\+7|8)[\s(.\-]*\d{3,4}[\s)\-.]*\d{2,4}[\s\-.]*\d{2,4}[\s\-.]*\d{2,4}|'
                           r'\+\d{1,3}[\s(.\-]*\d{2,4}[\s)\-.]*\d{2,4}[\s\-.]*\d{2,4}')

# Missing enum (target) — mirrors src/services/field-enums.js ALLOWED_MISSING
ALLOWED_MISSING = {'contact_name', 'phone', 'company', 'inn', 'kpp', 'ogrn',
                   'article', 'brand', 'quantity', 'delivery_address'}
# Known aliases that violate enum
MISSING_ALIASES = {
    'company_name', 'sender_phone', 'contact_phone', 'company_inn', 'sender_name_full',
    'company_address', 'mobile', 'mobile_phone', 'name', 'full_name', 'product_name',
    'sku', 'nomenclature', 'kpp', 'ogrn', 'tax_id', 'tax_number',
}

# Request type signals (rule-based fallback proxy)
RFQ_SIGNALS = re.compile(
    r'\b(?:КП|коммерческое\s+предложение|quotation|RFQ|request\s+for\s+quotation|'
    r'запрос\s+цены|запрос\s+стоимости|прошу\s+предоставить\s+цену|просчитать|'
    r'счет\s+(?:на|№)|invoice|price\s+request)\b', re.I|re.U)

# --- gather metrics ---
client_msgs = [m for m in msgs if ((m.get('analysis') or {}).get('classification') or {}).get('label') == 'Клиент']
total_client = len(client_msgs)

# Buckets
inn_dot_zero = []       # #2: ИНН с .0
empty_type_ready = []   # #1: empty requestType in ready_for_crm
empty_type_rfq = []     # #1a: empty type but body has RFQ signal
phone_missing_present = []  # #4
fio_with_org = []       # #5a
fio_empty_ready = []    # #5b
fio_multiline_or_title = []  # #5c
company_html = []       # #6a
company_url = []        # #6b
company_broken_quotes = []  # #6c
article_noise = []      # #10
missing_non_enum = Counter()  # #7
missing_empty_when_should_have = []  # #8
inn_non_ru = []         # #3

for m in client_msgs:
    a = m.get('analysis') or {}
    s = a.get('sender') or {}
    lead = a.get('lead') or {}
    llm = a.get('llmExtraction') or {}
    status = m.get('pipelineStatus', '') or ''
    body = (m.get('bodyPreview') or '') + '\n' + (lead.get('freeText') or '')
    subject = m.get('subject') or ''
    full_src = subject + '\n' + body
    mid = m.get('id') or m.get('messageKey', '')

    # #2 INN .0
    inn_raw = s.get('inn')
    inn_str = str(inn_raw) if inn_raw is not None else ''
    if inn_str.endswith('.0'):
        inn_dot_zero.append((mid, inn_str))
    # #3 INN non-RU
    if inn_str:
        digits = re.sub(r'\D', '', inn_str.split('.')[0])
        if digits and len(digits) not in (9, 10, 12):
            inn_non_ru.append((mid, inn_str, len(digits)))

    # #1 Empty request type
    req_type = (llm.get('requestType') or '').strip()
    if status == READY and not req_type:
        empty_type_ready.append(mid)
    if not req_type and RFQ_SIGNALS.search(full_src):
        empty_type_rfq.append(mid)

    # #4 Phone missing but present
    phone = (s.get('mobilePhone') or s.get('cityPhone') or '').strip()
    if not phone and status == READY and PHONE_BODY_RE.search(full_src):
        phone_missing_present.append(mid)

    # #5 ФИО issues
    fio = s.get('fullName') or ''
    if status == READY:
        if not fio or fio == 'Не определено':
            fio_empty_ready.append(mid)
    if fio and fio != 'Не определено':
        if ORG_RE.search(fio):
            fio_with_org.append((mid, fio))
        if TITLE_RE.search(fio) or MULTILINE_RE.search(fio):
            fio_multiline_or_title.append((mid, fio[:80]))

    # #6 Company sanitization
    company = s.get('companyName') or ''
    if company:
        if HTML_RE.search(company):
            company_html.append((mid, company[:80]))
        elif URL_RE.search(company) or EMAIL_FRAG_RE.search(company):
            company_url.append((mid, company[:80]))
        if has_broken_quotes(company):
            company_broken_quotes.append((mid, company[:80]))

    # #10 Article noise
    articles = lead.get('articles') or []
    for art in articles:
        art_s = str(art)
        if ARTICLE_BAD_TOKENS.match(art_s) or ARTICLE_NOISE_RE.search(art_s):
            article_noise.append((mid, art_s))

    # #7 Missing enum violations
    missing = llm.get('missingForProcessing') or []
    for key in missing:
        k = str(key).strip().lower()
        if k not in ALLOWED_MISSING:
            missing_non_enum[k] += 1

    # #8 Missing empty when obvious gaps
    # Requires: type in (quotation/order) + missing is empty + critical field empty
    if req_type.lower() in ('quotation', 'order') and not missing:
        empties = []
        if not company: empties.append('company')
        if not phone: empties.append('phone')
        if not inn_str: empties.append('inn')
        if not (lead.get('articles') or []): empties.append('article')
        if empties:
            missing_empty_when_should_have.append((mid, req_type, empties))

# --- report ---
def pct(n): return f'{n/total_client*100:.1f}%' if total_client else '0%'

print(f'{"="*75}')
print(f'ENTITY EXTRACTION AUDIT — {total_client} Клиент писем')
print(f'Prod JSON: {PROD_JSON}')
print(f'{"="*75}')

print(f'\n#1 LLM Тип запроса пустой в ready_for_crm:  {len(empty_type_ready):4d}  ({pct(len(empty_type_ready))})')
print(f'   Пустой тип при наличии RFQ сигналов:      {len(empty_type_rfq):4d}')
print(f'\n#2 ИНН с артефактом .0:                     {len(inn_dot_zero):4d}  ({pct(len(inn_dot_zero))})')
if inn_dot_zero[:3]:
    print(f'   Примеры: {[x[1] for x in inn_dot_zero[:3]]}')
print(f'\n#3 ИНН не-РФ длина (не 10/12):              {len(inn_non_ru):4d}')
if inn_non_ru[:3]:
    print(f'   Примеры: {[(x[1], x[2]) for x in inn_non_ru[:3]]}')
print(f'\n#4 Телефон пустой но есть в теле (ready):   {len(phone_missing_present):4d}  ({pct(len(phone_missing_present))})')
print(f'\n#5a ФИО с юрлицом ООО/АО/LLC:               {len(fio_with_org):4d}')
if fio_with_org[:3]:
    print(f'    Примеры: {[x[1][:50] for x in fio_with_org[:3]]}')
print(f'#5b ФИО пустое в ready_for_crm:              {len(fio_empty_ready):4d}')
print(f'#5c ФИО с должностью / multiline:            {len(fio_multiline_or_title):4d}')
if fio_multiline_or_title[:3]:
    print(f'    Примеры: {[x[1] for x in fio_multiline_or_title[:3]]}')
print(f'\n#6a Компания HTML/angle-bracket:             {len(company_html):4d}')
if company_html[:3]:
    print(f'    Примеры: {[x[1] for x in company_html[:3]]}')
print(f'#6b Компания mailto/URL/email:               {len(company_url):4d}')
if company_url[:3]:
    print(f'    Примеры: {[x[1] for x in company_url[:3]]}')
print(f'#6c Компания битые кавычки:                  {len(company_broken_quotes):4d}')
if company_broken_quotes[:3]:
    print(f'    Примеры: {[x[1] for x in company_broken_quotes[:3]]}')
print(f'\n#7 Missing non-enum значения:                {sum(missing_non_enum.values()):4d} upper on {len(missing_non_enum)} distinct keys')
if missing_non_enum:
    print(f'   Топ-10: {missing_non_enum.most_common(10)}')
print(f'\n#8 Missing=empty при quotation/order+пустых: {len(missing_empty_when_should_have):4d}')
if missing_empty_when_should_have[:3]:
    print(f'   Примеры: {[(x[1], x[2]) for x in missing_empty_when_should_have[:3]]}')
print(f'\n#10 Article noise (page:/WordSection/mail):  {len(article_noise):4d}')
if article_noise[:5]:
    print(f'    Примеры: {[x[1] for x in article_noise[:5]]}')

# Summary
print(f'\n{"="*75}')
print('СВОДКА (target = 0 или близко к 0):')
print(f'  #1 empty type ready:     {len(empty_type_ready)}')
print(f'  #2 ИНН .0:               {len(inn_dot_zero)}')
print(f'  #3 ИНН non-RU:           {len(inn_non_ru)}')
print(f'  #4 phone missing:        {len(phone_missing_present)}')
print(f'  #5 ФИО issues:           {len(fio_with_org) + len(fio_multiline_or_title)} ({len(fio_empty_ready)} empty ready)')
print(f'  #6 Company dirty:        {len(company_html) + len(company_url) + len(company_broken_quotes)}')
print(f'  #7 missing enum violations: {sum(missing_non_enum.values())}')
print(f'  #8 missing empty miss:   {len(missing_empty_when_should_have)}')
print(f'  #10 article noise:       {len(article_noise)}')

# Dump for followup
out = {
    'total_client': total_client,
    'c1_empty_type_ready': [mid for mid in empty_type_ready],
    'c1a_empty_type_rfq': empty_type_rfq,
    'c2_inn_dot_zero': inn_dot_zero,
    'c3_inn_non_ru': inn_non_ru,
    'c4_phone_missing': phone_missing_present,
    'c5a_fio_org': fio_with_org,
    'c5b_fio_empty_ready': fio_empty_ready,
    'c5c_fio_title_multiline': fio_multiline_or_title,
    'c6a_company_html': company_html,
    'c6b_company_url': company_url,
    'c6c_company_broken_quotes': company_broken_quotes,
    'c7_missing_non_enum': dict(missing_non_enum),
    'c8_missing_empty_misses': missing_empty_when_should_have,
    'c10_article_noise': article_noise,
}
with open('data/audit_entity_details.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(f'\nДетали: data/audit_entity_details.json')
