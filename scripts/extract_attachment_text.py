import json
import sys


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


def main() -> int:
    if len(sys.argv) < 3:
      print(json.dumps({"ok": False, "error": "usage: extract_attachment_text.py <kind> <file_path>"}))
      return 1

    kind = sys.argv[1]
    file_path = sys.argv[2]

    if kind == "pdf":
        print(json.dumps(extract_pdf(file_path), ensure_ascii=False))
        return 0

    print(json.dumps({"ok": False, "error": f"unsupported_kind:{kind}"}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
