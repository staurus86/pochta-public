"""Скачивает сообщения из production, строит XLSX с той же схемой что pochta-inbox-2026-04-19.xlsx,
и запускает audit_xlsx_2026_04_19.py-логику inline."""
import urllib.request, urllib.parse, json, base64, re, sys, io, sqlite3
from openpyxl import Workbook

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = 'https://pochta-production.up.railway.app'
USER = 'admin'
PASS = 'LgxaZ@ZDgNBXgSpnmTHEW6MC'
PID = 'project-4-klvrt-mail'

def req(path, token=None, method='GET', body=None):
    url = BASE + path
    headers = {}
    if token: headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    else:
        data = None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read().decode())

print('Логин...')
auth = req('/api/auth/login', method='POST', body={'login': USER, 'password': PASS})
token = auth['token']
print(f'Токен получен ({len(token)} chars)')

print('Скачиваю messages (limit=5000)...')
data = req(f'/api/projects/{PID}/messages?limit=5000', token=token)
msgs = data.get('messages', [])
print(f'Получено: {len(msgs)} писем')

# Save raw
with open('data/prod-messages-2026-04-19-postH.json', 'w', encoding='utf-8') as f:
    json.dump(msgs, f, ensure_ascii=False)
print('Сохранено в data/prod-messages-2026-04-19-postH.json')

# Build XLSX
CATEGORY_MAP = {'client': 'Клиент', 'spam': 'СПАМ', 'supplier': 'Поставщик', 'other': 'Другое'}

def get_product_names(lead):
    def norm(x):
        if isinstance(x, dict): return x.get('name') or x.get('product_name') or x.get('productName') or ''
        return str(x) if x else ''
    names = lead.get('productNames') or []
    out = [norm(n) for n in names if norm(n)]
    if out: return out
    line_items = lead.get('lineItems') or []
    return [norm(li) for li in line_items if norm(li)]

def is_spam(m):
    cat = ((m.get('analysis') or {}).get('classification') or {}).get('label') or ''
    return cat.upper() == 'СПАМ' or cat.lower() == 'spam' or m.get('pipelineStatus') in ('ignored_spam', 'quarantined')

HEADERS = ['№','Дата','От','Ящик','Тема','Тело письма','Статус','Категория','Confidence','ФИО','Должность','Компания','ИНН','Телефон','Бренды','Артикулы','Название товара','LLM Тип запроса','LLM Срочно','LLM Не хватает']

def row_of(m, idx):
    a = m.get('analysis') or {}
    s = a.get('sender') or {}
    l = a.get('lead') or {}
    llm = a.get('llmExtraction') or {}
    cls = a.get('classification') or {}
    cat = cls.get('label') or ''
    cat_ru = CATEGORY_MAP.get(str(cat).lower(), cat)
    return [
        idx + 1,
        m.get('createdAt') or '', m.get('from') or s.get('email') or '',
        m.get('mailbox') or '', m.get('subject') or '',
        (m.get('bodyPreview') or l.get('freeText') or '')[:1000],
        m.get('pipelineStatus') or '', cat_ru, cls.get('confidence') or '',
        s.get('fullName') or '', s.get('position') or '',
        s.get('companyName') or '', str(s.get('inn') or ''),
        s.get('cityPhone') or s.get('mobilePhone') or '',
        '; '.join(str(x) for x in (a.get('detectedBrands') or []) if x),
        '; '.join(str(x) for x in (l.get('articles') or []) if x),
        '; '.join(get_product_names(l)),
        llm.get('requestType') or '', 'Да' if llm.get('isUrgent') else '',
        '; '.join(llm.get('missingForProcessing') or [])
    ]

main_rows = [m for m in msgs if not is_spam(m)]
spam_rows = [m for m in msgs if is_spam(m)]
print(f'Заявки: {len(main_rows)}, Спам: {len(spam_rows)}')

wb = Workbook()
ws1 = wb.active; ws1.title = 'Заявки'
ws1.append(HEADERS)
for i, m in enumerate(main_rows):
    ws1.append(row_of(m, i))

ws2 = wb.create_sheet('Спам')
ws2.append(HEADERS)
for i, m in enumerate(spam_rows):
    ws2.append(row_of(m, i))

out = 'pochta-inbox-2026-04-19-postH.xlsx'
wb.save(out)
print(f'XLSX сохранён: {out}')
