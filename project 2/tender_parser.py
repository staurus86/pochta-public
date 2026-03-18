#!/usr/bin/env python3
"""
Tender Parser: Mail.klvrt.ru → Google Sheets (ФИНАЛЬНАЯ ВЕРСИЯ V4)
Точный парсинг SAP SRM под формат пользователя
"""

import json
import os
import sys
import hashlib
import re
import time
import base64
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path

# Google API
from google.oauth2.service_account import Credentials
import gspread

# Mail API
import imaplib
import email
from email.header import decode_header

BASE_DIR = Path(__file__).resolve().parent


def build_config() -> Dict:
    runtime_dir = Path(os.getenv('PROJECT2_RUNTIME_DIR', BASE_DIR))
    runtime_dir.mkdir(parents=True, exist_ok=True)

    credentials_b64 = os.getenv('PROJECT2_GOOGLE_CREDENTIALS_B64')
    credentials_json = os.getenv('PROJECT2_GOOGLE_CREDENTIALS_JSON')
    credentials_path = os.getenv('PROJECT2_GOOGLE_CREDENTIALS', str(BASE_DIR / 'credentials.json'))

    if credentials_b64:
        inline_path = runtime_dir / 'credentials.runtime.json'
        inline_path.write_text(base64.b64decode(credentials_b64).decode('utf-8'), encoding='utf-8')
        credentials_path = str(inline_path)
    elif credentials_json:
        inline_path = runtime_dir / 'credentials.runtime.json'
        inline_path.write_text(credentials_json, encoding='utf-8')
        credentials_path = str(inline_path)

    seen_path = Path(os.getenv('PROJECT2_SEEN_FILE', str(runtime_dir / 'seen_emails.json')))
    log_path = Path(os.getenv('PROJECT2_LOG_FILE', str(runtime_dir / 'tender_parser.log')))

    if not seen_path.exists():
        seen_b64 = os.getenv('PROJECT2_SEEN_B64')
        if seen_b64:
            seen_path.write_text(base64.b64decode(seen_b64).decode('utf-8'), encoding='utf-8')
        else:
            seen_path.write_text('{}', encoding='utf-8')

    if not log_path.exists():
        log_b64 = os.getenv('PROJECT2_LOG_B64')
        if log_b64:
            log_path.write_text(base64.b64decode(log_b64).decode('utf-8'), encoding='utf-8')
        else:
            log_path.write_text('', encoding='utf-8')

    def env_or_default(name: str, default: str) -> str:
        value = os.getenv(name)
        return value if value not in (None, '') else default

    return {
        'GMAIL_USER': env_or_default('PROJECT2_GMAIL_USER', 'parsertender@siderus.online'),
        'GMAIL_PASSWORD': env_or_default('PROJECT2_GMAIL_PASSWORD', 'K6-AuV5-3'),
        'IMAP_HOST': env_or_default('PROJECT2_IMAP_HOST', 'mail.klvrt.ru'),
        'IMAP_PORT': int(env_or_default('PROJECT2_IMAP_PORT', '993')),
        'GOOGLE_SHEETS_ID': env_or_default('PROJECT2_GOOGLE_SHEETS_ID', '1dLZxH5WcuriSSKRjR6xg1LiB7Hu6q-qVMWycGh2OQsM'),
        'GOOGLE_CREDENTIALS': credentials_path,
        'SEEN_FILE': str(seen_path),
        'LOG_FILE': str(log_path),
    }


CONFIG = build_config()

def log(message: str, level: str = "INFO"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_msg = f"[{timestamp}] [{level}] {message}"
    try:
        print(log_msg)
    except UnicodeEncodeError:
        safe_msg = log_msg.encode('cp1251', errors='replace').decode('cp1251', errors='replace')
        print(safe_msg)
    with open(CONFIG['LOG_FILE'], 'a', encoding='utf-8') as f:
        f.write(log_msg + '\n')

class MailReader:
    def __init__(self, email_user: str, password: str, imap_host: str, imap_port: int = 993):
        self.email = email_user
        self.password = password
        self.imap_host = imap_host
        self.imap_port = imap_port
        self.mail = None

    def connect(self):
        try:
            self.mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            self.mail.login(self.email, self.password)
            log(f"✅ Почта подключена: {self.email}")
        except Exception as e:
            log(f"❌ Mail auth failed: {e}", "ERROR")
            raise

    def get_new_emails(self, days: int = 1, max_emails: int = 100) -> List[Dict]:
        try:
            self.mail.select('INBOX')
            since_date = (datetime.now() - timedelta(days=days)).strftime('%d-%b-%Y')
            status, messages = self.mail.search(None, f'SINCE {since_date}')
            email_ids = messages[0].split()
            total_found = len(email_ids)
            if max_emails > 0:
                email_ids = email_ids[-max_emails:]
            log(f"📧 Найдено писем: {total_found} | Берём в обработку: {len(email_ids)}")

            emails = []
            for email_id in email_ids:
                try:
                    status, msg_data = self.mail.fetch(email_id, '(RFC822)')
                    msg = email.message_from_bytes(msg_data[0][1])
                    body, urls = self._get_body(msg)

                    email_dict = {
                        'id': email_id.decode(),
                        'subject': self._decode_header(msg['Subject']),
                        'from': msg['From'],
                        'date': msg['Date'],
                        'body': body,
                        'urls': urls,
                    }
                    emails.append(email_dict)
                except Exception as e:
                    log(f"⚠️  Error parsing email {email_id}: {e}", "WARN")
            return emails
        except Exception as e:
            log(f"❌ Get emails failed: {e}", "ERROR")
            return []

    def _decode_header(self, header: str) -> str:
        if not header: return ''
        try:
            decoded_parts = decode_header(header)
            result = ''
            for part, encoding in decoded_parts:
                if isinstance(part, bytes):
                    result += part.decode(encoding or 'utf-8', errors='ignore')
                else:
                    result += part
            return result
        except:
            return str(header)

    def _get_body(self, msg: email.message.Message) -> tuple:
        body = ''
        urls = []
        for part in msg.walk():
            if part.get_content_type() == 'text/plain':
                try:
                    body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                except: pass
            elif part.get_content_type() == 'text/html':
                try:
                    html = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    urls = re.findall(r'href=["\']([^"\']+srm\.digtp\.com[^"\']*)["\']', html, re.IGNORECASE)
                    urls = [u.replace('&amp;', '&').replace('&quot;', '"') for u in urls]
                    body = self._strip_html(html)
                except: pass
        return body.strip(), urls

    @staticmethod
    def _strip_html(html: str) -> str:
        text = re.sub(r'<[^>]+>', '', html)
        text = text.replace('&nbsp;', ' ').replace('&quot;', '"').replace('&amp;', '&')
        text = re.sub(r'\n\n+', '\n', text).replace('  ', ' ')
        return text.strip()

    def disconnect(self):
        if self.mail:
            try: self.mail.close()
            except: pass

class TenderParser:
    def parse_email(self, subject: str, body: str, urls: List[str]) -> Optional[Dict]:
        text = body

        tender_id = self._extract_tender_id(subject, text)
        title = self._extract_title(subject, text)
        deadline_date, deadline_time, opening_date, opening_time, city = self._extract_dates_and_city(text)
        customer_full = self._extract_organization(text)
        contact_name = self._extract_contact_name(text)
        contact_email = self._extract_contact_email(text)
        contact_phone_or_id = self._extract_phone_or_id(text)
        tender_url = self._extract_url_from_html(urls)
        status = self._extract_status(text)

        data = {
            'tender_id': tender_id or '',
            'tender_id_raw': tender_id or '',
            'title': title or '',
            'deadline_date': deadline_date,
            'deadline_time': deadline_time,
            'opening_date': opening_date,
            'opening_time': opening_time,
            'city': city,
            'customer_full': customer_full,
            'contact_name': contact_name,
            'contact_email': contact_email,
            'contact_phone_or_id': contact_phone_or_id,
            'tender_url': tender_url,
            'status': status,
        }

        log(f"✅ ID={tender_id} | {contact_name} | {contact_email} | Phone={contact_phone_or_id} | City={city}")
        return data

    @staticmethod
    def _extract_tender_id(subject: str, text: str) -> str:
        m = re.search(r'№\s*(\d{6,})', text)
        if m: return m.group(1)
        for pattern in [subject, text]:
            m = re.search(r'\b(\d{10})\b', pattern)
            if m: return m.group(1)
        return ''

    @staticmethod
    def _extract_title(subject: str, text: str) -> str:
        m = re.search(r'№\s*\d+\s+(.+?)(?:\n|Категория)', text, re.DOTALL)
        if m:
            return m.group(1).split('\n')[0].strip()
        return subject.strip() if subject else ''

    @staticmethod
    def _extract_dates_and_city(text: str) -> tuple:
        """Извлечь даты и город (точные форматы)"""
        deadline_date = deadline_time = opening_date = opening_time = city = ''

        # Срок подачи + город
        m_dead = re.search(
            r'Срок подачи предложения:\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s*,\s*Россия,\s*([А-Яа-яЁё\s\-]+?)(?=\n|Дата вскрытия|$)',
            text, re.IGNORECASE
        )
        if m_dead:
            deadline_date = m_dead.group(1).strip()
            deadline_time = m_dead.group(2).strip()
            city = m_dead.group(3).strip()

        # Дата вскрытия
        m_open = re.search(
            r'Дата вскрытия предложений:\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})',
            text, re.IGNORECASE
        )
        if m_open:
            opening_date = m_open.group(1).strip()
            opening_time = m_open.group(2).strip()

        return deadline_date, deadline_time or '', opening_date, opening_time or '', city

    @staticmethod
    def _extract_organization(text: str) -> str:
        """Организация из 'Процедура проводится:' (БЕЗ лишнего текста)"""
        match = re.search(r'Процедура\s+проводится:\s+([^\n]+?)(?=Контактное|Email|Телефон|\n\n|$)', text, re.IGNORECASE)
        return match.group(1).strip() if match else ''

    @staticmethod
    def _extract_contact_name(text: str) -> str:
        """Контактное лицо"""
        m = re.search(r'Контактное лицо:\s*([А-ЯЁ][а-яё\s.-]+?)(?=\n|Email:|Телефон:|$)', text, re.IGNORECASE)
        return m.group(1).strip() if m else ''

    @staticmethod
    def _extract_contact_email(text: str) -> str:
        """Email контакта (ТОЛЬКО email, без мусора)"""
        # Ищем "Email: адрес"
        match = re.search(r'Email:\s+(\S+@\S+?)(?=\s|Телефон|Доб|\n|$)', text, re.IGNORECASE)
        if match:
            email = match.group(1).strip()
            # Проверяем что это не наш
            if '@siderus.ru' not in email.lower() and '@digtp.com' not in email.lower():
                return email
        
        # Если не нашли, ищем любой email кроме наших
        emails = re.findall(r'[\w\.-]+@[\w\.-]+\.\w+', text)
        for email in emails:
            if '@siderus.ru' not in email.lower() and '@digtp.com' not in email.lower() and 'wf-batch' not in email.lower():
                return email
        
        return ''

    @staticmethod
    def _extract_phone_or_id(text: str) -> str:
        """
        Телефон ВСЕ форматы:
        - Телефон: +798944860
        - Телефон: +7(495)7870485
        - Телефон: 131228312
        - Доб. Доб. 22198
        """
        
        # Вариант 1: Телефон: <номер>
        # Ищем ВСЁ от "Телефон:" до перевода строки
        m = re.search(r'Телефон:\s*([+\d][\d\-\(\)\s]+?)(?=\n|Доб\.|Email:|$)', text, re.IGNORECASE)
        if m:
            phone = m.group(1).strip()
            # Убираем пробелы внутри
            phone = re.sub(r'\s+', '', phone)
            if phone:
                return phone
        
        # Вариант 2: Доб. Доб. <номер>
        m = re.search(r'Доб\.\s*Доб\.\s*(\d+)', text, re.IGNORECASE)
        if m:
            return m.group(1)
        
        return ''

    @staticmethod
    def _extract_url_from_html(urls: List[str]) -> str:
        """Извлечь ссылку на тендер из HTML и нормализовать"""
        for url in urls:
            if 'srm.digtp.com' in url.lower():
                # Очищаем от > в конце
                url = url.rstrip('>').strip()
                # Нормализуем протокол: HTTPS:// → https://
                url = re.sub(r'^HTTPS://', 'https://', url, flags=re.IGNORECASE)
                url = re.sub(r'^HTTP://', 'http://', url, flags=re.IGNORECASE)
                return url
        
        if urls:
            url = urls[0].rstrip('>').strip()
            url = re.sub(r'^HTTPS://', 'https://', url, flags=re.IGNORECASE)
            url = re.sub(r'^HTTP://', 'http://', url, flags=re.IGNORECASE)
            return url
        
        return ''


    @staticmethod
    def _extract_status(text: str) -> str:
        """Статус тендера"""
        m = re.search(r'\b(Открыт|Закрыт|Отмен[аен]|Завершен[АО]?)\b', text, re.IGNORECASE)
        if m:
            status = m.group(1)
            return 'Завершён' if status.lower().startswith('завершен') else status.capitalize()
        return 'Открыт'

class SheetsManager:
    def __init__(self, credentials_file: str, sheet_id: str):
        self.credentials_file = credentials_file
        self.sheet_id = sheet_id
        self.client = self._auth(credentials_file)
        self.sheet = None
        self.batch_rows = []

    def _auth(self, credentials_file: str) -> gspread.Client:
        scope = ['https://www.googleapis.com/auth/spreadsheets']
        creds = Credentials.from_service_account_file(credentials_file, scopes=scope)
        client = gspread.Client(auth=creds)
        log("✅ Google Sheets авторизирован")
        return client

    def open_sheet(self, sheet_name: str = 'Tenders') -> gspread.Worksheet:
        try:
            workbook = self.client.open_by_key(self.sheet_id)
            try:
                self.sheet = workbook.worksheet(sheet_name)
                if not self.sheet.row_values(1):
                    self._clear_and_create_headers()
            except:
                self.sheet = workbook.add_worksheet(title=sheet_name, rows=5000, cols=15)
                self._clear_and_create_headers()
            log(f"✅ Лист '{sheet_name}' открыт")
            return self.sheet
        except Exception as e:
            log(f"❌ Open sheet failed: {e}", "ERROR")
            raise

    def _clear_and_create_headers(self):
        self.sheet.clear()
        headers = [
            'ID тендера', 'Номер закупки (сырой)', 'Описание / категория',
            'Дата подачи предложения', 'Время подачи предложения', 
            'Дата вскрытия предложений', 'Время вскрытия предложений',
            'Город', 'Заказчик / подразделение', 'Контактное лицо',
            'Email контакта', 'Телефон / внутр. ID', 'Ссылка на тендер',
            'Статус', 'Дата письма'
        ]
        self.sheet.insert_row(headers, 1)
        log("✅ Заголовки созданы")

    def get_all_tender_ids(self) -> set:
        try:
            rows = self.sheet.get_all_values()
            return {row[0].strip() for row in rows[1:] if row and row[0].strip()}
        except:
            return set()

    def add_tender(self, tender_data: Dict, email_date: str) -> bool:
        row = [
            tender_data.get('tender_id', ''),
            tender_data.get('tender_id_raw', ''),
            tender_data.get('title', ''),
            tender_data.get('deadline_date', ''),
            tender_data.get('deadline_time', ''),
            tender_data.get('opening_date', ''),
            tender_data.get('opening_time', ''),
            tender_data.get('city', ''),
            tender_data.get('customer_full', ''),
            tender_data.get('contact_name', ''),
            tender_data.get('contact_email', ''),
            tender_data.get('contact_phone_or_id', ''),
            tender_data.get('tender_url', ''),
            tender_data.get('status', ''),
            email_date
        ]
        self.batch_rows.append(row)
        return True

    def flush_batch(self) -> int:
        """Записать все накопленные строки одним запросом с retry"""
        if not self.batch_rows:
            return 0

        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                self.sheet.append_rows(self.batch_rows, value_input_option='RAW')
                count = len(self.batch_rows)
                log(f"✅ Записано {count} тендеров")
                self.batch_rows = []
                time.sleep(2)  # Увеличиваем задержку
                return count
                
            except Exception as e:
                retry_count += 1
                error_msg = str(e).lower()
                
                # Если это проблема с квотой — ждём дольше
                if '429' in str(e) or 'quota' in error_msg or 'rate' in error_msg:
                    wait_time = 60 * retry_count  # 60, 120, 180 секунд
                    log(f"⚠️  API Quota exceeded. Ждём {wait_time}с перед повтором ({retry_count}/{max_retries})...", "WARN")
                    time.sleep(wait_time)
                
                # Если это ошибка соединения — ждём и переподключаемся
                elif 'connection' in error_msg or '10054' in str(e):
                    wait_time = 30 * retry_count  # 30, 60, 90 секунд
                    log(f"⚠️  Connection error. Ждём {wait_time}с перед повтором ({retry_count}/{max_retries})...", "WARN")
                    time.sleep(wait_time)
                    # Переподключаемся к Google Sheets
                    try:
                        self.client = self._auth(self.credentials_file)
                        log("✅ Переподключение к Google Sheets выполнено")
                    except:
                        pass
                
                # Если это последний retry
                if retry_count >= max_retries:
                    log(f"❌ Flush failed after {max_retries} retries: {e}", "ERROR")
                    return 0
                
                log(f"🔄 Повтор {retry_count}/{max_retries}...", "WARN")
        
        return 0

class DuplicateChecker:
    def __init__(self, seen_file: str):
        self.seen_file = seen_file
        self.seen = self._load()

    def _load(self) -> Dict:
        return json.load(open(self.seen_file, 'r', encoding='utf-8')) if os.path.exists(self.seen_file) else {}

    def _save(self):
        with open(self.seen_file, 'w', encoding='utf-8') as f:
            json.dump(self.seen, f, indent=2, ensure_ascii=False)

    def get_hash(self, email_dict: Dict) -> str:
        return hashlib.md5(f"{email_dict['subject']}|{email_dict['from']}|{email_dict['date']}".encode()).hexdigest()

    def is_duplicate(self, email_dict: Dict) -> bool:
        return self.get_hash(email_dict) in self.seen

    def mark_as_seen(self, email_dict: Dict):
        self.seen[self.get_hash(email_dict)] = {
            'subject': email_dict['subject'],
            'from': email_dict['from'],
            'timestamp': datetime.now().isoformat()
        }
        self._save()

class TenderProcessor:
    def __init__(self, config: Dict):
        self.config = config
        self.mail = MailReader(config['GMAIL_USER'], config['GMAIL_PASSWORD'], config['IMAP_HOST'], config['IMAP_PORT'])
        self.parser = TenderParser()
        self.sheets = SheetsManager(config['GOOGLE_CREDENTIALS'], config['GOOGLE_SHEETS_ID'])
        self.dedup = DuplicateChecker(config['SEEN_FILE'])

    def run(self, days: int = 1, max_emails: int = 100):
        """Главный процесс с проверкой в таблице"""
        log("=" * 80)
        log("🚀 TENDER PARSER V5 - С ПРОВЕРКОЙ НЕДОСТАЮЩИХ")
        log("=" * 80)

        summary = {
            'status': 'ok',
            'days': days,
            'maxEmails': max_emails,
            'processed': 0,
            'added': 0,
            'skipped': 0,
            'failed': 0,
        }

        try:
            self.mail.connect()
            emails = self.mail.get_new_emails(days, max_emails=max_emails)

            if not emails:
                log("📭 Новых писем нет")
                summary['message'] = 'Новых писем нет'
                return summary

            self.sheets.open_sheet()
            existing_ids = self.sheets.get_all_tender_ids()
            log(f"📊 В таблице: {len(existing_ids)} тендеров")

            processed = skipped = failed = 0
            
            for email_dict in emails:
                # ✅ ПЕРВАЯ ПРОВЕРКА: есть ли уже в таблице
                tender_data = self.parser.parse_email(
                    email_dict['subject'], 
                    email_dict['body'], 
                    email_dict.get('urls', [])
                )

                if not tender_data or not tender_data.get('tender_id'):
                    # Если не смогли спарсить — пропускаем и запоминаем
                    failed += 1
                    self.dedup.mark_as_seen(email_dict)
                    continue

                tender_id = tender_data['tender_id'].strip()
                
                # ✅ ГЛАВНАЯ ПРОВЕРКА: есть ли ID в таблице?
                if tender_id in existing_ids:
                    # Уже добавлен
                    skipped += 1
                    self.dedup.mark_as_seen(email_dict)
                    continue

                # 🟢 Если ID НЕ в таблице — добавляем (НЕЗАВИСИМО от дедупликации)
                if self.sheets.add_tender(tender_data, email_dict['date']):
                    processed += 1
                    existing_ids.add(tender_id)
                    log(f"✅ Добавлен: {tender_id}")
                else:
                    failed += 1
                    log(f"❌ Ошибка при добавлении: {tender_id}")
                    # НЕ помечаем как seen, чтобы повторить в следующий раз
                    continue

                # Только если успешно добавили — помечаем как обработанное
                self.dedup.mark_as_seen(email_dict)

            # Батч-запись всех накопленных
            added = self.sheets.flush_batch()
            self.mail.disconnect()

            summary.update({
                'processed': processed,
                'added': added,
                'skipped': skipped,
                'failed': failed,
                'message': 'Выполнение завершено'
            })

            log("=" * 80)
            log(f"✅ Обработано: {processed} | Добавлено в таблицу: {added} | Пропущено: {skipped} | Ошибки: {failed}")
            log("=" * 80)
            return summary

        except Exception as e:
            summary.update({
                'status': 'error',
                'message': str(e),
            })
            log(f"❌ FATAL: {e}", "ERROR")
            try: self.mail.disconnect()
            except: pass
            return summary


if __name__ == '__main__':
    if CONFIG['GOOGLE_SHEETS_ID'] == 'your-sheet-id':
        print("❌ ЗАПОЛНИ CONFIG:")
        print("1. GOOGLE_SHEETS_ID ← ID из URL Google Sheets")
        print("2. credentials.json ← Service Account")
        sys.exit(1)

    # Опция очистки дедупликации
    if len(sys.argv) > 1 and sys.argv[1] == '--reset':
        if os.path.exists(CONFIG['SEEN_FILE']):
            os.remove(CONFIG['SEEN_FILE'])
            print(f"✅ Очищен {CONFIG['SEEN_FILE']}")
        if os.path.exists(CONFIG['LOG_FILE']):
            os.remove(CONFIG['LOG_FILE'])
            print(f"✅ Очищен {CONFIG['LOG_FILE']}")
        print("\n🚀 Теперь запусти: python tender_parser.py")
        sys.exit(0)

    # Парсим количество дней и лимит писем
    days = 1
    max_emails = int(os.getenv('PROJECT2_MAX_EMAILS', '100') or '100')
    args = sys.argv[1:]
    for index, arg in enumerate(args):
        if arg == '--max-emails' and index + 1 < len(args):
            try:
                max_emails = max(1, int(args[index + 1]))
            except ValueError:
                pass
            continue

        if arg.isdigit():
            days = int(arg)
            break

    processor = TenderProcessor(CONFIG)
    result = processor.run(days=days, max_emails=max_emails)
    print(f"SUMMARY_JSON={json.dumps(result, ensure_ascii=False)}")
