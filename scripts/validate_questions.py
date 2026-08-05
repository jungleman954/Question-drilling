"""Validate the generated bank and write human-readable extraction reports."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS = ROOT / "public" / "questions.json"
SOURCE = ROOT / "question bank.pdf"
REPORT = ROOT / "reports" / "extraction_report.md"
UNRESOLVED = ROOT / "reports" / "unresolved_questions.json"

TYPE_LABELS = {"single": "单选题", "multiple": "多选题", "judgment": "判断题"}


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

    problems: list[dict] = []
    for item in data:
        notes = list(item.get("reviewNotes", []))
        options = item.get("options", {})
        expected_letters = {"A", "B"} if item["type"] == "judgment" else {"A", "B", "C", "D"}
        answer = set(item.get("correctAnswer", ""))
        if set(options) != expected_letters:
            notes.append("选项集合不完整或异常")
        if answer and not answer <= expected_letters:
            notes.append("答案不属于合法选项")
        if not answer:
            notes.append("答案为空")
        if not item.get("stem"):
            notes.append("题干为空")
        if notes:
            problems.append(
                {
                    "id": item["id"],
                    "originalNumber": item["originalNumber"],
                    "sourcePage": item["sourcePage"],
                    "notes": list(dict.fromkeys(notes)),
                    "images": item.get("images", []),
                }
            )

    unresolved_payload = {
        "summary": {
            "count": len(problems),
            "missingNumbers": missing,
            "duplicateNumbers": duplicates,
        },
        "questions": problems,
    }
    UNRESOLVED.write_text(json.dumps(unresolved_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    source_pages = len(PdfReader(str(SOURCE)).pages)
    status = "通过" if not missing and not duplicates and not out_of_range and len(data) == 262 else "未通过"
    lines = [
        "# 题库提取与完整性报告",
        "",
        "## 源文件",
        "",
        f"- 文件：`{SOURCE.name}`",
        f"- PDF 页数：{source_pages}",
        "- 有效题号：1–262（第 37 页的 263–264 为简答题，按要求排除）",
        "- 页面性质：拍照扫描页；答案为题号左侧手写字母",
        "",
        "## 提取统计",
        "",
        f"- 识别题目总数：{len(data)}",
        f"- 最低题号：{min(numbers) if numbers else '无'}",
        f"- 最高题号：{max(numbers) if numbers else '无'}",
        f"- 单选题：{type_counts['single']}",
        f"- 多选题：{type_counts['multiple']}",
        f"- 判断题：{type_counts['judgment']}",
        f"- 待确认题目：{len(problems)}",
        "",
        "## 连续性检查",
        "",
        f"- 总体状态：**{status}**",
        f"- 缺失题号：{missing if missing else '无'}",
        f"- 重复题号：{duplicates if duplicates else '无'}",
        f"- 越界题号：{out_of_range if out_of_range else '无'}",
        "",
        "## 校验规则",
        "",
        "1. 题号集合必须恰好等于 1–262，且每个题号仅出现一次。",
        "2. 1–153 为单选题，154–208 为多选题，209–262 为判断题。",
        "3. 单选题与多选题必须包含 A–D；判断题必须包含 A、B。",
        "4. 正确答案必须由已有选项字母组成；不确定答案保持为空并列入待确认清单。",
        "5. 每题保留来源页码与原题裁图，OCR 文本可回溯核对。",
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
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
