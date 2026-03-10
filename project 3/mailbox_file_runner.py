#!/usr/bin/env python3

import json
import os
import re
import sys
import imaplib
import email
from pathlib import Path
from datetime import datetime, timedelta
from email.header import decode_header


def parse_accounts(file_path: Path):
    accounts = []
    contents = file_path.read_text(encoding="utf-8")
    for line in contents.splitlines():
        line = line.strip()
        if "@" not in line or "\t" not in line:
            continue

        parts = [part.strip() for part in line.split("\t")]
        if len(parts) < 6:
            continue

        accounts.append({
            "mailbox": parts[0],
            "webmail_url": parts[1],
            "password": parts[2],
            "collector_email": parts[3],
            "site_url": parts[4],
            "brand": parts[5],
        })

    return accounts


def decode_value(raw_value):
    if not raw_value:
        return ""

    result = ""
    for part, encoding in decode_header(raw_value):
        if isinstance(part, bytes):
            result += part.decode(encoding or "utf-8", errors="ignore")
        else:
            result += part
    return result


def extract_body_and_attachments(message):
    body = ""
    attachments = []

    if message.is_multipart():
        for part in message.walk():
            disposition = part.get("Content-Disposition", "")
            filename = decode_value(part.get_filename())
            if filename:
                attachments.append(filename)

            if part.get_content_type() == "text/plain" and "attachment" not in disposition.lower():
                try:
                    body = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="ignore")
                except Exception:
                    pass
            elif part.get_content_type() == "text/html" and not body:
                try:
                    html = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="ignore")
                    body = re.sub(r"<[^>]+>", " ", html)
                except Exception:
                    pass
    else:
        try:
            body = message.get_payload(decode=True).decode(message.get_content_charset() or "utf-8", errors="ignore")
        except Exception:
            body = ""

    body = re.sub(r"\s+", " ", body).strip()
    return body, attachments


def fetch_account_emails(account, host, port, days, max_emails):
    result = []
    mail = None
    try:
        mail = imaplib.IMAP4_SSL(host, port)
        mail.login(account["mailbox"], account["password"])
        mail.select("INBOX")

        since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
        status, messages = mail.search(None, f'SINCE {since_date}')
        if status != "OK":
            return result

        email_ids = messages[0].split()[-max_emails:]
        for email_id in reversed(email_ids):
            status, msg_data = mail.fetch(email_id, "(RFC822)")
            if status != "OK":
                continue

            message = email.message_from_bytes(msg_data[0][1])
            body, attachments = extract_body_and_attachments(message)
            result.append({
                "mailbox": account["mailbox"],
                "brand": account["brand"],
                "siteUrl": account["site_url"],
                "subject": decode_value(message.get("Subject")),
                "from": decode_value(message.get("From")),
                "date": decode_value(message.get("Date")),
                "body": body,
                "attachments": attachments,
            })
    except Exception as error:
        result.append({
            "mailbox": account["mailbox"],
            "brand": account["brand"],
            "siteUrl": account["site_url"],
            "subject": "",
            "from": "",
            "date": "",
            "body": "",
            "attachments": [],
            "error": str(error),
        })
    finally:
        if mail:
            try:
                mail.close()
            except Exception:
                pass
            try:
                mail.logout()
            except Exception:
                pass

    return result


def main():
    source_file = Path(os.getenv("PROJECT3_SOURCE_FILE", Path(__file__).resolve().parents[1] / "1.txt"))
    host = os.getenv("PROJECT3_IMAP_HOST", "mail.hosting.reg.ru")
    port = int(os.getenv("PROJECT3_IMAP_PORT", "993"))
    days = int(os.getenv("PROJECT3_DAYS", "1"))
    max_emails = int(os.getenv("PROJECT3_MAX_EMAILS", "10"))

    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        days = int(sys.argv[1])

    accounts = parse_accounts(source_file)
    emails = []
    for account in accounts:
        emails.extend(fetch_account_emails(account, host, port, days, max_emails))

    summary = {
        "status": "ok",
        "sourceFile": str(source_file),
        "accountCount": len(accounts),
        "fetchedEmailCount": len([item for item in emails if not item.get("error")]),
        "errorCount": len([item for item in emails if item.get("error")]),
        "emails": emails,
    }

    output = f"PROJECT3_JSON={json.dumps(summary, ensure_ascii=False)}"
    try:
        print(output)
    except UnicodeEncodeError:
        safe_output = output.encode("cp1251", errors="replace").decode("cp1251", errors="replace")
        print(safe_output)


if __name__ == "__main__":
    main()
