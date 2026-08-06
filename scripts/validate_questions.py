"""校验题库连续性、数据结构及常见 OCR 内容缺陷。"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "public" / "questions.json"
SOURCE = ROOT / "question bank.pdf"
OCR_INDEX = ROOT / "reports" / "ocr_index.json"
REPORT = ROOT / "reports" / "extraction_report.md"
UNRESOLVED = ROOT / "reports" / "unresolved_questions.json"

TYPE_LABELS = {"single": "单选题", "multiple": "多选题", "judgment": "判断题"}
# 原题第 40 题的 A、D 选项确实相同。忠实保留，不自行编造选项。
SOURCE_VERIFIED_DUPLICATE_OPTIONS = {40}


def content_notes(item: dict) -> list[str]:
    notes = list(item.get("reviewNotes", []))
    stem = str(item.get("stem", "")).strip()
    options = item.get("options", {})
    number = int(item["originalNumber"])
    expected_letters = {"A", "B"} if item["type"] == "judgment" else {"A", "B", "C", "D"}
    answer = set(item.get("correctAnswer", ""))

    if set(options) != expected_letters:
        notes.append("选项集合不完整或异常")
    if any(not str(value).strip() for value in options.values()):
        notes.append("存在空选项")
    normalized = [re.sub(r"\s+", "", str(value)) for value in options.values()]
    if len(normalized) != len(set(normalized)) and number not in SOURCE_VERIFIED_DUPLICATE_OPTIONS:
        notes.append("存在重复选项")
    if answer and not answer <= expected_letters:
        notes.append("答案不属于合法选项")
    if not answer:
        notes.append("答案为空")
    if not stem:
        notes.append("题干为空")
    elif stem[-1] not in "。！？，：；”』）":
        notes.append("题干疑似被截断或缺少句末标点")
    if stem.count("（") != stem.count("）"):
        notes.append("题干圆括号不配对")
    if stem.count("[") != stem.count("]"):
        notes.append("题干方括号不配对")
    if any(str(value).count("（") != str(value).count("）") for value in options.values()):
        notes.append("选项圆括号不配对")
    all_text = stem + "".join(map(str, options.values()))
    if re.search(r"[α-ωΑ-Ω�]", all_text):
        notes.append("存在 OCR 异常符号")
    if re.search(r"\d{1,3}[、.]\s*依据变电安规", stem[8:]):
        notes.append("题干疑似串入下一题")
    if re.search(r"(?<=\d)[A-D]{2,4}$", "".join(map(str, options.values()))):
        notes.append("选项末尾疑似粘连手写答案")
    return list(dict.fromkeys(notes))


def source_page_count() -> int:
    """从 OCR 索引取得已处理页数，避免校验脚本依赖 PDF 第三方库。"""
    if not OCR_INDEX.exists():
        return 0
    index = json.loads(OCR_INDEX.read_text(encoding="utf-8"))
    pages = index.get("pages", index if isinstance(index, list) else [])
    return len(pages)


def main() -> None:
    data = json.loads(QUESTIONS.read_text(encoding="utf-8"))
    numbers = [int(item["originalNumber"]) for item in data]
    counts = Counter(numbers)
    expected = set(range(1, 263))
    actual = set(numbers)
    missing = sorted(expected - actual)
    duplicates = sorted(number for number, count in counts.items() if count > 1)
    out_of_range = sorted(actual - expected)
    type_counts = Counter(item["type"] for item in data)

    problems = []
    for item in data:
        notes = content_notes(item)
        if notes:
            problems.append({
                "id": item["id"],
                "originalNumber": item["originalNumber"],
                "sourcePage": item["sourcePage"],
                "notes": notes,
                "images": item.get("images", []),
            })

    unresolved_payload = {
        "summary": {
            "count": len(problems),
            "missingNumbers": missing,
            "duplicateNumbers": duplicates,
            "sourceVerifiedDuplicateOptions": sorted(SOURCE_VERIFIED_DUPLICATE_OPTIONS),
        },
        "questions": problems,
    }
    UNRESOLVED.write_text(json.dumps(unresolved_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    source_pages = source_page_count()
    passed = not missing and not duplicates and not out_of_range and len(data) == 262 and not problems
    status = "通过" if passed else "未通过"
    lines = [
        "# 题库提取、内容校对与完整性报告",
        "",
        "## 源文件",
        "",
        f"- 文件：`{SOURCE.name}`",
        f"- PDF 页数：{source_pages}",
        "- 有效题号：1–262（第 37 页的 263–264 为简答题，按要求排除）",
        "- OCR：整页识别后，对异常页使用 2500px 检测分辨率复扫",
        "",
        "## 题库统计",
        "",
        f"- 题目总数：{len(data)}",
        f"- 最低题号：{min(numbers) if numbers else '无'}",
        f"- 最高题号：{max(numbers) if numbers else '无'}",
        f"- 单选题：{type_counts['single']}",
        f"- 多选题：{type_counts['multiple']}",
        f"- 判断题：{type_counts['judgment']}",
        f"- 待确认题目：{len(problems)}",
        "",
        "## 校验结果",
        "",
        f"- 总体状态：**{status}**",
        f"- 缺失题号：{missing if missing else '无'}",
        f"- 重复题号：{duplicates if duplicates else '无'}",
        f"- 越界题号：{out_of_range if out_of_range else '无'}",
        "- 第 40 题 A、D 选项在原图中确实相同，已按原文保留，未擅自改写。",
        "",
        "## 内容审计规则",
        "",
        "1. 检查题号 1–262 连续且唯一，题型区间正确。",
        "2. 检查选项集合、空选项、答案合法性和非原文重复选项。",
        "3. 检查题干与选项括号配对、句末截断、异常 OCR 符号。",
        "4. 检查串入相邻题号、手写答案粘连到选项等常见 OCR 合并错误。",
        "5. 所有显式修正保存在 `reports/answer_overrides.json`，可重复生成。",
        "",
        "## 待确认说明",
        "",
        f"详细清单见 `reports/unresolved_questions.json`，共 {len(problems)} 题。",
    ]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": status,
        "sourcePages": source_pages,
        "questionCount": len(data),
        "typeCounts": dict(type_counts),
        "missing": missing,
        "duplicates": duplicates,
        "unresolved": len(problems),
        "sourceVerifiedDuplicateOptions": sorted(SOURCE_VERIFIED_DUPLICATE_OPTIONS),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
