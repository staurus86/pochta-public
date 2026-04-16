#!/usr/bin/env python3
"""
Импорт inn_okved.xlsx и lid_without_calc_brand.xlsx в detection-kb.sqlite.

inn_okved.xlsx  → company_directory (дедуп по ИНН, merge с существующими)
lid_without_calc_brand.xlsx → brand_aliases (только новые бренды, которых нет в KB)
"""
import zipfile, xml.etree.ElementTree as ET, sqlite3, sys, os, re
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "data" / "detection-kb.sqlite"
INN_XLSX = ROOT / "inn_okved.xlsx"
BRAND_XLSX = ROOT / "lid_without_calc_brand.xlsx"


def read_xlsx(path):
    """Читает XLSX и возвращает (header, rows)."""
    with zipfile.ZipFile(path) as z:
        ss = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.parse(z.open("xl/sharedStrings.xml"))
            ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            ss = [
                "".join(t.text or "" for t in si.iter(ns + "t"))
                for si in tree.getroot()
            ]
        sheet = next(
            n for n in z.namelist()
            if "worksheets/sheet" in n and n.endswith(".xml")
        )
        tree = ET.parse(z.open(sheet))
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        rows = []
        for row in tree.getroot().iter(ns + "row"):
            vals = []
            for c in row:
                t = c.get("t", "")
                v_el = c.find(ns + "v")
                v = v_el.text if v_el is not None else ""
                if t == "s" and v:
                    vals.append(ss[int(v)] if int(v) < len(ss) else "")
                elif v:
                    vals.append(v)
                else:
                    vals.append("")
            rows.append(vals)
    if not rows:
        return [], []
    return rows[0], rows[1:]


def clean_str(s):
    """Убирает \r, лишние пробелы, _x000D_."""
    if not s:
        return ""
    s = str(s).replace("_x000D_", "").replace("\r", "").replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()


def is_valid_inn(inn):
    return inn and inn.strip().isdigit() and len(inn.strip()) in (10, 12)


# ─── 1. Импорт company_directory из inn_okved.xlsx ────────────────────────────

def import_company_directory(conn):
    print("\n=== inn_okved.xlsx → company_directory ===")
    header, rows = read_xlsx(INN_XLSX)
    print(f"Прочитано строк: {len(rows)}, колонки: {header}")

    # Определяем индексы колонок по имени
    h = [c.lower().strip() for c in header]
    def col(name, fallback=-1):
        return h.index(name) if name in h else fallback

    idx_name    = col("name")
    idx_inn     = col("inn")
    idx_okved   = col("okved")
    idx_title   = col("okved_title")
    idx_fio     = col("fio")
    idx_post    = col("post")
    idx_email   = col("email")

    def get(row, idx):
        return clean_str(row[idx]) if idx >= 0 and idx < len(row) else ""

    # Собираем уникальные записи по ИНН (приоритет — более полная запись)
    by_inn = {}  # inn → dict
    no_inn = []

    for row in rows:
        inn = get(row, idx_inn).strip()
        name = get(row, idx_name)
        if not name:
            continue
        okved = get(row, idx_okved)
        okved_title = get(row, idx_title)
        fio = get(row, idx_fio)
        post = get(row, idx_post)
        email = get(row, idx_email).lower()

        rec = dict(
            company_name=name, inn=inn, okved=okved, okved_title=okved_title,
            contact_name=fio if fio not in ("-", "") else "",
            contact_position=post, email=email,
            email_domain=email.split("@")[-1] if "@" in email else "",
            greeting="", source_file="inn_okved.xlsx"
        )

        if is_valid_inn(inn):
            existing = by_inn.get(inn)
            # Берём запись с более полным набором данных
            if existing is None:
                by_inn[inn] = rec
            else:
                # Мержим: берём непустые поля
                for k in ("okved", "okved_title", "contact_name", "contact_position", "email", "email_domain"):
                    if not existing[k] and rec[k]:
                        existing[k] = rec[k]
        else:
            no_inn.append(rec)

    print(f"Уникальных ИНН: {len(by_inn)}, записей без ИНН: {len(no_inn)}")

    cur = conn.cursor()

    # Загружаем существующие ИНН из DB
    existing_inns = set(
        r[0] for r in cur.execute(
            "SELECT inn FROM company_directory WHERE inn != '' AND is_active = 1"
        ).fetchall()
    )
    print(f"Уже в DB: {len(existing_inns)} записей с ИНН")

    inserted = 0
    updated = 0

    for inn, rec in by_inn.items():
        if inn in existing_inns:
            # UPDATE только пустые поля
            cur.execute("""
                UPDATE company_directory SET
                  okved        = CASE WHEN okved = '' AND ? != '' THEN ? ELSE okved END,
                  okved_title  = CASE WHEN okved_title = '' AND ? != '' THEN ? ELSE okved_title END,
                  contact_name = CASE WHEN contact_name = '' AND ? != '' THEN ? ELSE contact_name END,
                  contact_position = CASE WHEN contact_position = '' AND ? != '' THEN ? ELSE contact_position END
                WHERE inn = ? AND is_active = 1
            """, (
                rec["okved"], rec["okved"],
                rec["okved_title"], rec["okved_title"],
                rec["contact_name"], rec["contact_name"],
                rec["contact_position"], rec["contact_position"],
                inn
            ))
            updated += 1
        else:
            try:
                cur.execute("""
                    INSERT INTO company_directory
                      (company_name, inn, okved, okved_title, contact_name,
                       contact_position, email, email_domain, greeting, source_file, is_active)
                    VALUES (?,?,?,?,?,?,?,?,?,?,1)
                """, (
                    rec["company_name"], inn, rec["okved"], rec["okved_title"],
                    rec["contact_name"], rec["contact_position"],
                    rec["email"], rec["email_domain"], rec["greeting"], rec["source_file"]
                ))
                inserted += 1
            except sqlite3.IntegrityError:
                pass  # email unique constraint

    conn.commit()
    print(f"Добавлено новых: {inserted}, обновлено существующих: {updated}")
    total = cur.execute("SELECT COUNT(*) FROM company_directory WHERE is_active=1").fetchone()[0]
    print(f"Итого в company_directory: {total}")


# ─── 2. Импорт брендов из lid_without_calc_brand.xlsx ────────────────────────

def import_brands(conn):
    print("\n=== lid_without_calc_brand.xlsx → brand_aliases ===")
    header, rows = read_xlsx(BRAND_XLSX)
    print(f"Прочитано строк: {len(rows)}, колонки: {header}")

    h = [c.lower().strip() for c in header]
    idx_brand = h.index("brand_name") if "brand_name" in h else 3

    # Собираем уникальные бренды
    brands_seen = set()
    for row in rows:
        brand = clean_str(row[idx_brand] if idx_brand < len(row) else "")
        if brand and len(brand) >= 2 and len(brand) <= 100:
            # Фильтр: не числа, не одиночные символы, не мусор
            if not brand.isdigit() and not re.match(r'^[\d\s,.-]+$', brand):
                brands_seen.add(brand)

    print(f"Уникальных брендов из файла: {len(brands_seen)}")

    cur = conn.cursor()
    # brand_aliases: canonical_brand, alias
    existing = set(
        r[0].lower() for r in cur.execute(
            "SELECT canonical_brand FROM brand_aliases UNION SELECT alias FROM brand_aliases"
        ).fetchall()
    )
    print(f"Уже в brand_aliases: {len(existing)} вхождений")

    inserted = 0
    skipped = 0
    for brand in sorted(brands_seen):
        if brand.lower() in existing:
            skipped += 1
            continue
        try:
            cur.execute(
                "INSERT INTO brand_aliases (canonical_brand, alias, is_active) VALUES (?, ?, 1)",
                (brand, brand)
            )
            inserted += 1
            existing.add(brand.lower())
        except sqlite3.IntegrityError:
            skipped += 1

    conn.commit()
    print(f"Добавлено новых брендов: {inserted}, пропущено (дубли): {skipped}")
    total = cur.execute("SELECT COUNT(*) FROM brand_aliases").fetchone()[0]
    print(f"Итого в brand_aliases: {total}")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not DB_PATH.exists():
        print(f"ОШИБКА: БД не найдена: {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    if not INN_XLSX.exists():
        print(f"ОШИБКА: Файл не найден: {INN_XLSX}", file=sys.stderr)
        sys.exit(1)
    if not BRAND_XLSX.exists():
        print(f"ОШИБКА: Файл не найден: {BRAND_XLSX}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(DB_PATH))
    try:
        import_company_directory(conn)
        import_brands(conn)
    finally:
        conn.close()

    print("\nГотово.")
