# 本地题库刷题网站

本项目从根目录固定题库文件 `question bank.pdf` 提取题目，生成静态题库，并由 React + TypeScript + Vite 在浏览器中运行。练习数据只保存在浏览器 `localStorage`，不需要后端、数据库或账号。

## 已生成内容

- `public/questions.json`：262 道题（单选 153、多选 55、判断 54）
- `public/question-images/`：每道题对应的原始页面裁剪图
- `reports/extraction_report.md`：完整性校验报告
- `reports/unresolved_questions.json`：待确认题目清单

网站支持顺序、随机和错题练习，可按题型筛选。答题卡可直接跳转到任意已答或未答题目；单选题和多选题的选项内容会在每次浏览器练习会话中重新乱序，并在刷新时保持稳定。

考试模式会从题库中随机抽取 100 道不重复题目：单选题 60 道、多选题 20 道、判断题 20 道。考试过程中不显示答案，交卷后统一评分；当前试卷与作答进度保存在本地，刷新后再次进入考试模式即可继续。

## 启动网站

```powershell
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5173/`。

生产构建：

```powershell
pnpm build
```

## 重新提取题库

首次创建 Python 环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

依次执行：

```powershell
.\.venv\Scripts\python.exe scripts\extract_questions.py
.\.venv\Scripts\python.exe scripts\parse_questions.py
.\.venv\Scripts\python.exe scripts\validate_questions.py
```

OCR 原始结果会缓存到 `reports/raw_ocr/`。解析脚本保留每题原始裁剪图，便于对照扫描页复核。
