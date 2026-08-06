"""Render the fixed source PDF and run repeatable local OCR.

The source is a photographed question booklet.  OCR is deliberately run on
overlapping horizontal strips: this retains enough resolution for the curved,
low-contrast lines near the inner page margin.  Results are cached per page so
the parser can be rerun without repeating OCR.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import cv2
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "question bank.pdf"
PAGE_DIR = ROOT / "tmp" / "pdfs" / "pages"
OCR_DIR = ROOT / "reports" / "raw_ocr"


def page_number(path: Path) -> int:
    return int(path.stem.rsplit("-", 1)[1])


def find_pdftoppm() -> str:
    configured = os.environ.get("PDFTOPPM")
    if configured and Path(configured).exists():
        return configured
    bundled = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "native" / "poppler" / "Library" / "bin" / "pdftoppm.exe"
    if bundled.exists():
        return str(bundled)
    return "pdftoppm"


def render_pages(pdf_path: Path, force: bool = False) -> list[Path]:
    PAGE_DIR.mkdir(parents=True, exist_ok=True)
    page_count = len(PdfReader(str(pdf_path)).pages)
    existing = sorted(PAGE_DIR.glob("page-*.png"), key=page_number)
    if not force and len(existing) == page_count:
        return existing
    subprocess.run(
        [find_pdftoppm(), "-r", "72", "-png", str(pdf_path), str(PAGE_DIR / "page")],
        check=True,
    )
    pages = sorted(PAGE_DIR.glob("page-*.png"), key=page_number)
    if len(pages) != page_count:
        raise RuntimeError(f"Expected {page_count} rendered pages, found {len(pages)}")
    return pages


def _box_to_list(box) -> list[list[float]]:
    return [[round(float(x), 2), round(float(y), 2)] for x, y in box]


def _ocr_page(page_path: str, force: bool = False) -> dict:
    # Imported in each worker so ONNX sessions are not pickled.
    from rapidocr_onnxruntime import RapidOCR

    path = Path(page_path)
    number = page_number(path)
    output = OCR_DIR / f"page-{number:02d}.json"
    if output.exists() and not force:
        return json.loads(output.read_text(encoding="utf-8"))

    image = cv2.imread(str(path))
    if image is None:
        raise RuntimeError(f"Could not read {path}")
    height, width = image.shape[:2]
    full_engine = RapidOCR(
        # Keep the full photographed page close to native resolution.  At
        # 1024px the inner-page curve collapsed punctuation and short blanks,
        # causing stems/options to be joined or truncated.
        det_limit_side_len=2500,
        max_side_len=3000,
        det_box_thresh=0.25,
        intra_op_num_threads=4,
        inter_op_num_threads=1,
    )

    raw_lines: list[dict] = []
    strip_height = 520
    strip_step = 410
    starts = list(range(0, height, strip_step))
    if starts and starts[-1] + 180 >= height:
        starts.pop()
    # Native-resolution full-page OCR now retains the curved-margin text that
    # previously required overlapping strips.  A single pass also prevents
    # duplicate lines from adjacent strip windows.
    for pass_name, y0, y1 in [("full", 0, height)]:
        crop = image[y0:y1]
        result, _ = full_engine(crop, box_thresh=0.2, text_score=0.3)
        for box, text, score in result or []:
            adjusted = [[float(x), float(y) + y0] for x, y in box]
            raw_lines.append(
                {
                    "box": _box_to_list(adjusted),
                    "text": str(text).strip(),
                    "score": round(float(score), 6),
                    "pass": pass_name,
                }
            )

    payload = {
        "page": number,
        "image": str(path.relative_to(ROOT)).replace("\\", "/"),
        "width": width,
        "height": height,
        "stripHeight": strip_height,
        "stripStep": strip_step,
        "lines": raw_lines,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--force-render", action="store_true")
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--workers", type=int, default=max(1, min(2, (os.cpu_count() or 2) // 2)))
    parser.add_argument(
        "--pages",
        type=str,
        help="Optional comma-separated physical PDF page numbers to OCR.",
    )
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)
    pages = render_pages(pdf_path, args.force_render)
    if args.pages:
        selected = {int(value.strip()) for value in args.pages.split(",") if value.strip()}
        pages = [page for page in pages if page_number(page) in selected]
    OCR_DIR.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    if args.workers == 1:
        # On Windows, repeatedly starting ONNX inside a spawned pool can be
        # substantially slower than a direct sequential pass.
        for done_index, page in enumerate(pages, start=1):
            results.append(_ocr_page(str(page), args.force_ocr))
            print(f"OCR {done_index:02d}/{len(pages):02d}: page {page_number(page):02d}", flush=True)
    else:
        with ProcessPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {pool.submit(_ocr_page, str(page), args.force_ocr): page for page in pages}
            for done_index, future in enumerate(as_completed(futures), start=1):
                page = futures[future]
                payload = future.result()
                results.append(payload)
                print(f"OCR {done_index:02d}/{len(pages):02d}: page {page_number(page):02d}", flush=True)

    results.sort(key=lambda item: item["page"])
    all_payloads = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(OCR_DIR.glob("page-*.json"))
    ]
    index = {
        "sourceFile": pdf_path.name,
        "sourcePages": len(PdfReader(str(pdf_path)).pages),
        "ocrPages": len(all_payloads),
        "rawLineCount": sum(len(item["lines"]) for item in all_payloads),
        "pages": [
            {"page": item["page"], "width": item["width"], "height": item["height"], "lines": len(item["lines"])}
            for item in all_payloads
        ],
    }
    (ROOT / "reports" / "ocr_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(index | {"pages": "omitted"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
