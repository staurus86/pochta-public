import json
import sys
import re
import zipfile
from xml.etree import ElementTree as ET


def extract_pdf(file_path: str) -> dict:
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return {"ok": False, "error": f"fitz_unavailable:{exc}"}

    try:
        doc = fitz.open(file_path)
    except Exception as exc:
        return {"ok": False, "error": f"pdf_open_failed:{exc}"}

    texts = []
    image_only_pages = 0
    total_pages = len(doc)

    for page_index, page in enumerate(doc):
        if page_index >= 20:
            break
        text = page.get_text("text") or ""
        normalized = " ".join(text.split())
        if normalized:
            texts.append(normalized)
        else:
            images = page.get_images(full=True)
            drawings = page.get_drawings()
            if images or drawings:
                image_only_pages += 1

    doc.close()

    combined = "\n".join(texts).strip()
    needs_ocr = not combined and image_only_pages > 0
    return {
        "ok": True,
        "text": combined[:40000],
        "parser": "pymupdf",
        "needs_ocr": needs_ocr,
        "pages": total_pages,
        "image_only_pages": image_only_pages,
    }


def _strip_xml_namespaces(root: ET.Element) -> None:
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]


def _safe_zip_read(zf: zipfile.ZipFile, name: str) -> str:
    try:
        with zf.open(name) as fh:
            return fh.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""


def extract_docx(file_path: str) -> dict:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            targets = [
                name for name in zf.namelist()
                if re.match(r"^word/(document|header\d+|footer\d+)\.xml$", name, re.I)
            ][:8]
            parts = []
            for name in targets:
                xml = _safe_zip_read(zf, name)
                if not xml:
                    continue
                try:
                    root = ET.fromstring(xml)
                    _strip_xml_namespaces(root)
                    texts = [t.text.strip() for t in root.iter("t") if t.text and t.text.strip()]
                    if texts:
                        parts.append(" ".join(texts))
                except Exception:
                    texts = re.findall(r"<w:t[^>]*>([\s\S]*?)</w:t>", xml, re.I)
                    texts = [re.sub(r"\s+", " ", t).strip() for t in texts if t and t.strip()]
                    if texts:
                        parts.append(" ".join(texts))
    except Exception as exc:
        return {"ok": False, "error": f"docx_open_failed:{exc}"}

    combined = "\n".join(parts).strip()
    return {
        "ok": True,
        "text": combined[:40000],
        "parser": "python_zip_docx",
        "needs_ocr": False,
    }


def extract_xlsx(file_path: str) -> dict:
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            shared_strings = []
            shared_xml = _safe_zip_read(zf, "xl/sharedStrings.xml")
            if shared_xml:
                try:
                    root = ET.fromstring(shared_xml)
                    _strip_xml_namespaces(root)
                    for si in root.iter("si"):
                        texts = [t.text or "" for t in si.iter("t")]
                        shared_strings.append("".join(texts).strip())
                except Exception:
                    pass

            worksheet_names = [
                name for name in zf.namelist()
                if re.match(r"^xl/worksheets/sheet\d+\.xml$", name, re.I)
            ][:10]
            lines = []
            for name in worksheet_names:
                xml = _safe_zip_read(zf, name)
                if not xml:
                    continue
                try:
                    root = ET.fromstring(xml)
                    _strip_xml_namespaces(root)
                    for row in root.iter("row"):
                        values = []
                        for cell in row.iter("c"):
                            cell_type = cell.attrib.get("t", "")
                            value = ""
                            inline = cell.find("is")
                            if inline is not None:
                                value = "".join((t.text or "") for t in inline.iter("t")).strip()
                            else:
                                v = cell.find("v")
                                if v is not None and v.text:
                                    value = v.text.strip()
                                    if cell_type == "s" and value.isdigit():
                                        idx = int(value)
                                        value = shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
                            value = re.sub(r"\s+", " ", value).strip()
                            if value:
                                values.append(value)
                        if values:
                            lines.append("\t".join(values))
                except Exception:
                    continue
    except Exception as exc:
        return {"ok": False, "error": f"xlsx_open_failed:{exc}"}

    combined = "\n".join(lines).strip()
    return {
        "ok": True,
        "text": combined[:40000],
        "parser": "python_zip_xlsx",
        "needs_ocr": False,
    }


def main() -> int:
    if len(sys.argv) < 3:
      print(json.dumps({"ok": False, "error": "usage: extract_attachment_text.py <kind> <file_path>"}))
      return 1

    kind = sys.argv[1]
    file_path = sys.argv[2]

    if kind == "pdf":
        print(json.dumps(extract_pdf(file_path), ensure_ascii=False))
        return 0
    if kind == "docx":
        print(json.dumps(extract_docx(file_path), ensure_ascii=False))
        return 0
    if kind == "xlsx":
        print(json.dumps(extract_xlsx(file_path), ensure_ascii=False))
        return 0

    print(json.dumps({"ok": False, "error": f"unsupported_kind:{kind}"}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
