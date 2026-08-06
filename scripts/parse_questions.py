"""Merge cached OCR lines into question records and source-image crops."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OCR_DIR = ROOT / "reports" / "raw_ocr"
PAGE_DIR = ROOT / "tmp" / "pdfs" / "pages"
IMAGE_DIR = ROOT / "public" / "question-images"
OUTPUT = ROOT / "public" / "questions.json"
OVERRIDES = ROOT / "reports" / "answer_overrides.json"
ANSWERS = ROOT / "reports" / "answers.json"

QUESTION_TOKEN_RE = re.compile(r"(\d{1,4})\s*[、,，.．]")
OPTION_RE = re.compile(r"^\s*([A-D])\s*[.．、,，:：]\s*(.*)$")
SECTION_MARKERS = ("单选题", "多选题", "判断题", "简答题")
PAGE_ORDER = list(range(1, 14)) + [15, 14] + list(range(16, 38))
PAGE_RANK = {page: index for index, page in enumerate(PAGE_ORDER)}
MANUAL_ANCHORS = {
    # These four number lines are visibly present but the detector merged or
    # dropped their curved left edge.  The y values are PDF-page coordinates.
    100: (16, 418),
    6: (1, 1176),
    33: (5, 1698),
    88: (15, 524),
    113: (17, 1468),
    114: (18, 496),
    115: (18, 653),
    126: (19, 1462),
    127: (20, 524),
    140: (22, 484),
    141: (22, 632),
    153: (24, 400),
    167: (26, 466),
    168: (26, 662),
    194: (30, 436),
    208: (32, 449),
    226: (34, 464),
    227: (34, 583),
    247: (36, 632),
    253: (36, 1330),
    254: (36, 1458),
}


def center(line: dict) -> tuple[float, float]:
    return (
        sum(point[0] for point in line["box"]) / 4,
        sum(point[1] for point in line["box"]) / 4,
    )


def bounds(line: dict) -> tuple[float, float, float, float]:
    xs = [point[0] for point in line["box"]]
    ys = [point[1] for point in line["box"]]
    return min(xs), min(ys), max(xs), max(ys)


@dataclass
class MergedLine:
    page: int
    y: float
    variants: list[dict] = field(default_factory=list)

    @property
    def primary(self) -> dict:
        # The full-page pass preserves the printed line boundary.  Strip OCR
        # can be more detailed near curved margins, but its overlapping crops
        # sometimes concatenate the same text twice or attach a neighbouring
        # question.  Prefer full-page text whenever that line was detected;
        # fall back to strip variants only for lines the full pass missed.
        full_page = [item for item in self.variants if item.get("pass") == "full"]
        candidates = full_page or self.variants
        return max(
            candidates,
            key=lambda item: (len(item["text"]) + item["score"] * 12, item["score"]),
        )

    @property
    def text(self) -> str:
        return self.primary["text"].strip()

    @property
    def score(self) -> float:
        return float(self.primary["score"])

    @property
    def all_texts(self) -> list[str]:
        return list(dict.fromkeys(item["text"].strip() for item in self.variants if item["text"].strip()))


def merge_page(payload: dict) -> list[MergedLine]:
    raw = [item for item in payload["lines"] if item["text"].strip()]

    def group_by_y(
        items: list[dict], tolerance: int, require_horizontal_fragment: bool = False
    ) -> list[list[dict]]:
        items = sorted(items, key=lambda item: (center(item)[1], center(item)[0]))
        groups: list[list[dict]] = []
        for item in items:
            item_y = center(item)[1]
            if not groups:
                groups.append([item])
                continue
            group_y = sum(center(existing)[1] for existing in groups[-1]) / len(groups[-1])
            shares_row = abs(item_y - group_y) <= tolerance
            if shares_row and require_horizontal_fragment:
                x0, _, x1, _ = bounds(item)
                for existing in groups[-1]:
                    e0, _, e1, _ = bounds(existing)
                    overlap = max(0, min(x1, e1) - max(x0, e0))
                    if overlap > 0.18 * min(x1 - x0, e1 - e0):
                        shares_row = False
                        break
            if shares_row:
                groups[-1].append(item)
            else:
                groups.append([item])
        return groups

    # Build printed lines from the full-page pass first.  Overlapping strip
    # crops are only admitted when the full-page detector missed an entire
    # line; mixing both passes before grouping was the main cause of repeated
    # options and text leaking in from neighbouring questions.
    # A photographed line can slope enough for left/right detector boxes to
    # have centres 10-18 px apart.  Join those fragments before sorting by x.
    # Strip crops need the tighter tolerance because they overlap vertically.
    full_groups = group_by_y(
        [item for item in raw if item.get("pass") == "full"],
        18,
        require_horizontal_fragment=True,
    )
    strip_groups = group_by_y([item for item in raw if item.get("pass") != "full"], 6)
    full_centres = [
        sum(center(item)[1] for item in group) / len(group)
        for group in full_groups
    ]
    fallback_groups: list[list[dict]] = []
    for group in strip_groups:
        group_y = sum(center(item)[1] for item in group) / len(group)
        nearby = [
            (abs(group_y - full_y), index)
            for index, full_y in enumerate(full_centres)
            if abs(group_y - full_y) <= 18
        ]
        if nearby:
            # Keep strip variants on the same logical line so they can repair
            # a misread number token. MergedLine.primary still selects the
            # clean full-page wording for the actual stem/option text.
            _, index = min(nearby)
            full_groups[index].extend(group)
        else:
            fallback_groups.append(group)
    raw_groups = full_groups + fallback_groups
    raw_groups.sort(key=lambda group: sum(center(item)[1] for item in group) / len(group))

    merged: list[MergedLine] = []
    for group in raw_groups:
        by_pass: dict[str, list[dict]] = defaultdict(list)
        for item in group:
            by_pass[item["pass"]].append(item)
        variants: list[dict] = []
        for pass_name, items in by_pass.items():
            items.sort(key=lambda item: bounds(item)[0])
            accepted: list[dict] = []
            for item in items:
                x0, _, x1, _ = bounds(item)
                duplicate = False
                for current in accepted:
                    c0, _, c1, _ = bounds(current)
                    overlap = max(0, min(x1, c1) - max(x0, c0))
                    if overlap >= 0.75 * min(x1 - x0, c1 - c0):
                        if item["score"] > current["score"]:
                            accepted.remove(current)
                            accepted.append(item)
                        duplicate = True
                        break
                if not duplicate:
                    accepted.append(item)
            accepted.sort(key=lambda item: bounds(item)[0])
            text = "".join(item["text"].strip() for item in accepted)
            if text:
                variants.append(
                    {
                        "text": text,
                        "score": sum(item["score"] for item in accepted) / len(accepted),
                        "pass": pass_name,
                        "x0": min(bounds(item)[0] for item in accepted),
                        "x1": max(bounds(item)[2] for item in accepted),
                    }
                )
        # Collapse identical text variants while keeping the strongest score.
        best_by_text: dict[str, dict] = {}
        for variant in variants:
            old = best_by_text.get(variant["text"])
            if old is None or variant["score"] > old["score"]:
                best_by_text[variant["text"]] = variant
        merged.append(
            MergedLine(
                page=int(payload["page"]),
                y=sum(center(item)[1] for item in group) / len(group),
                variants=list(best_by_text.values()),
            )
        )
    return merged


def question_candidates(line: MergedLine) -> list[tuple[int, str, str]]:
    candidates: list[tuple[int, str, str]] = []
    for text in line.all_texts:
        for match in QUESTION_TOKEN_RE.finditer(text):
            if match.start() > 12:
                break
            tail = text[match.end():]
            if len(re.findall(r"[\u4e00-\u9fff]", tail[:50])) < 3:
                continue
            raw_number = match.group(1)
            number = int(raw_number)
            if number > 264 and len(raw_number) == 4:
                number = int(raw_number[-3:])
            if not 1 <= number <= 264:
                continue
            prefix = text[:match.start()].upper()
            answer_hint = "".join(char for char in prefix if char in "ABCD")
            candidates.append((number, answer_hint, text))
            break
    return candidates


def build_anchors(pages: dict[int, list[MergedLine]]) -> tuple[list[dict], list[dict]]:
    rows: list[tuple[int, int, MergedLine, list[tuple[int, str, str]]]] = []
    for page, lines in pages.items():
        for index, line in enumerate(lines):
            candidates = question_candidates(line)
            if candidates:
                rows.append((page, index, line, candidates))
    for number, (page, y) in MANUAL_ANCHORS.items():
        index = min(range(len(pages[page])), key=lambda value: abs(pages[page][value].y - y))
        line = pages[page][index]
        rows.append((page, index, line, [(number, "", f"{number}、[人工定位锚点]")]))
    rows.sort(key=lambda item: (PAGE_RANK[item[0]], item[2].y))

    anchors: list[dict] = []
    issues: list[dict] = []
    expected = 1
    for page, index, line, candidates in rows:
        numbers = sorted(set(number for number, _, _ in candidates))
        if expected in numbers:
            assigned = expected
            inferred = False
        else:
            usable = [number for number in numbers if number >= expected]
            tiny = [number for number in numbers if str(expected).endswith(str(number)) and number < expected]
            if tiny:
                assigned = expected
                inferred = True
            elif usable:
                assigned = min(usable)
                inferred = assigned != expected
            else:
                continue
        if anchors and assigned <= anchors[-1]["number"]:
            continue
        if assigned > 264:
            continue
        if assigned != expected:
            issues.append({"kind": "anchor-gap", "expected": expected, "found": assigned, "page": page, "y": round(line.y, 1)})
        answer_hints = []
        for number, hint, text in candidates:
            if number == assigned and hint:
                answer_hints.append(hint)
            elif assigned != number and hint:
                answer_hints.append(hint)
        anchors.append(
            {
                "number": assigned,
                "page": page,
                "lineIndex": index,
                "y": line.y,
                "inferred": inferred,
                "answerHints": list(dict.fromkeys(answer_hints)),
                "variants": line.all_texts,
            }
        )
        expected = assigned + 1
    return anchors, issues


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("（ ", "（").replace(" ）", "）")
    # Handwritten answer strings on the facing page are occasionally detected
    # at the far right of a printed line. They are not part of option text.
    text = re.sub(r"(?<=[\u4e00-\u9fff。；，）)\"”])[A-D]{1,4}\d*$", "", text)
    return text


def repair_common_ocr_artifacts(
    stem: str, options: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Repair only deterministic blank/punctuation artifacts from the scan."""
    stem = stem.replace("(）", "（）").replace("（)", "（）")
    stem = stem.replace("（（）", "（）").replace("（））", "（）")
    stem = stem.replace("（β）", "（）")
    stem = re.sub(r"（(?:[A-D]{1,4}|1)$", "（）", stem)
    if stem.endswith("（"):
        stem += "）"
    # A question stem in this booklet always ends with printed punctuation.
    if stem.endswith("（）"):
        stem += "。"
    cleaned_options = dict(options)
    for key, value in cleaned_options.items():
        value = re.sub(r"(?<=kV)[A-D]+$", "", value)
        value = re.sub(r"(?<=\d)[A-D]{2,4}$", "", value)
        cleaned_options[key] = value
    return stem, cleaned_options


def strip_question_prefix(text: str, number: int) -> str:
    # Prefer the printed number, tolerating a recognized handwritten answer.
    pattern = re.compile(rf"^\s*[A-D]{{0,4}}\s*{number}\s*[、,，.．]\s*")
    cleaned = pattern.sub("", text, count=1)
    if cleaned == text:
        generic = QUESTION_TOKEN_RE.search(text[:20])
        if generic:
            cleaned = text[generic.end():]
    return cleaned.strip()


def type_for(number: int) -> str:
    if number <= 153:
        return "single"
    if number <= 208:
        return "multiple"
    return "judgment"


def collect_question_lines(
    anchor: dict,
    next_anchor: dict | None,
    pages: dict[int, list[MergedLine]],
) -> list[MergedLine]:
    collected: list[MergedLine] = []
    start_rank = PAGE_RANK[anchor["page"]]
    end_rank = PAGE_RANK[next_anchor["page"]] if next_anchor else start_rank
    for page in PAGE_ORDER[start_rank:end_rank + 1]:
        lines = pages[page]
        start = anchor["lineIndex"] if page == anchor["page"] else 0
        end = next_anchor["lineIndex"] if next_anchor and page == next_anchor["page"] else len(lines)
        for line in lines[start:end]:
            text = line.text
            if any(marker in text for marker in SECTION_MARKERS):
                continue
            # Printed footer is a bare page number and should not join a stem.
            if re.fullmatch(r"\d{1,2}", text):
                continue
            collected.append(line)
    return collected


def parse_content(number: int, lines: list[MergedLine]) -> tuple[str, dict[str, str], float]:
    stem_parts: list[str] = []
    option_parts: dict[str, list[str]] = {}
    current_option: str | None = None
    scores: list[float] = []
    for index, line in enumerate(lines):
        text = line.text
        if index == 0:
            text = strip_question_prefix(text, number)
        text = clean_text(text)
        if not text:
            continue
        scores.append(line.score)
        match = OPTION_RE.match(text)
        if match:
            current_option = match.group(1)
            option_parts.setdefault(current_option, []).append(match.group(2).strip())
        elif current_option:
            option_parts[current_option].append(text)
        else:
            stem_parts.append(text)
    stem = clean_text("".join(stem_parts))
    options = {letter: clean_text("".join(parts)) for letter, parts in option_parts.items()}
    confidence = sum(scores) / len(scores) if scores else 0.0
    return stem, options, confidence


def crop_question(anchor: dict, next_anchor: dict | None, page_meta: dict[int, dict]) -> list[str]:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    assets: list[str] = []
    start_rank = PAGE_RANK[anchor["page"]]
    end_rank = PAGE_RANK[next_anchor["page"]] if next_anchor else start_rank
    crop_pages = PAGE_ORDER[start_rank:end_rank + 1]
    for page in crop_pages:
        source = PAGE_DIR / f"page-{page:02d}.png"
        image = Image.open(source).convert("RGB")
        width, height = image.size
        top = max(0, int(anchor["y"] - 38)) if page == anchor["page"] else 0
        bottom = (
            max(top + 20, int(next_anchor["y"] - 28))
            if next_anchor and page == next_anchor["page"]
            else height
        )
        # Keep the handwritten answer and all printed content, trim only empty outer margins.
        crop = image.crop((0, top, width, min(height, bottom)))
        if crop.width > 1400:
            target_h = round(crop.height * 1400 / crop.width)
            crop = crop.resize((1400, max(1, target_h)), Image.Resampling.LANCZOS)
        suffix = "" if len(crop_pages) == 1 else f"-p{page:02d}"
        filename = f"q{anchor['number']:04d}{suffix}.jpg"
        target = IMAGE_DIR / filename
        # Existing source crops remain valid when only OCR text merging rules
        # change. Avoid repeatedly rewriting hundreds of JPEGs (and Windows
        # file-sharing failures while the local Vite server is serving them).
        if not target.exists():
            crop.save(target, "JPEG", quality=78, optimize=True)
        assets.append(f"/question-images/{filename}")
    return assets


def main() -> None:
    ocr_files = sorted(OCR_DIR.glob("page-*.json"))
    if len(ocr_files) != 37:
        raise RuntimeError(f"Expected OCR for 37 pages, found {len(ocr_files)}. Run extract_questions.py first.")
    payloads = [json.loads(path.read_text(encoding="utf-8")) for path in ocr_files]
    page_meta = {int(payload["page"]): payload for payload in payloads}
    pages = {int(payload["page"]): merge_page(payload) for payload in payloads}
    anchors, anchor_issues = build_anchors(pages)

    overrides = {}
    if OVERRIDES.exists():
        overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    verified_answers = json.loads(ANSWERS.read_text(encoding="utf-8")) if ANSWERS.exists() else {}

    questions: list[dict] = []
    target_anchors = [anchor for anchor in anchors if anchor["number"] <= 262]
    for index, anchor in enumerate(target_anchors):
        next_anchor = anchors[anchors.index(anchor) + 1] if anchors.index(anchor) + 1 < len(anchors) else None
        lines = collect_question_lines(anchor, next_anchor, pages)
        stem, options, confidence = parse_content(anchor["number"], lines)
        number_key = str(anchor["number"])
        override = overrides.get(number_key, {})
        stem = override.get("stem", stem)
        options = override.get("options", options)
        stem, options = repair_common_ocr_artifacts(stem, options)
        answer = override.get("answer", verified_answers.get(number_key, ""))
        if not answer and len(anchor["answerHints"]) == 1:
            answer = anchor["answerHints"][0]
        answer = "".join(sorted(set(answer)))
        question_type = type_for(anchor["number"])
        expected_options = {"A", "B"} if question_type == "judgment" else {"A", "B", "C", "D"}
        notes: list[str] = []
        verified = bool(override.get("verified"))
        if anchor["inferred"] and not verified:
            notes.append("题号由连续性规则恢复，需核对原图")
        if not stem:
            notes.append("未可靠识别题干")
        missing_options = sorted(expected_options - set(options))
        if missing_options:
            notes.append("缺少选项：" + "、".join(missing_options))
        legal_answers = expected_options
        if not answer:
            notes.append("手写答案未可靠识别")
        elif not set(answer) <= legal_answers:
            notes.append("答案字母超出选项范围")
        if confidence < 0.90 and not verified:
            notes.append(f"OCR平均置信度较低：{confidence:.3f}")
        if override.get("notes") and not verified:
            notes.append(str(override["notes"]))
        assets = crop_question(anchor, next_anchor, page_meta)
        questions.append(
            {
                "id": f"q-{anchor['number']:04d}",
                "originalNumber": anchor["number"],
                "type": question_type,
                "stem": stem,
                "options": options,
                "correctAnswer": answer,
                "sourcePage": anchor["page"],
                "sourcePages": PAGE_ORDER[
                    PAGE_RANK[anchor["page"]]:PAGE_RANK[(next_anchor or anchor)["page"]] + 1
                ],
                "images": assets,
                "needsReview": bool(notes),
                "reviewNotes": notes,
                "ocrConfidence": round(confidence, 4),
            }
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "reports" / "anchor_issues.json").write_text(
        json.dumps({"anchors": anchors, "issues": anchor_issues}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"questions": len(questions), "anchors": len(anchors), "anchorIssues": len(anchor_issues)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
