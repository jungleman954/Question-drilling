import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Grid3X3,
  Image as ImageIcon,
  ListOrdered,
  RotateCcw,
  Shuffle,
  Target,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import type { PracticeState, Question, QuestionType } from './types'
import {
  clearExamState,
  clearPracticeState,
  emptyExamState,
  emptyPracticeState,
  loadExamState,
  loadPracticeState,
  saveExamState,
  savePracticeState,
} from './utils/storage'

type PracticeMode = 'sequential' | 'random' | 'wrong' | 'exam'
type TypeFilter = 'all' | QuestionType

const TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judgment: '判断题',
}

const MODE_LABELS: Record<PracticeMode, string> = {
  sequential: '顺序练习',
  random: '随机练习',
  wrong: '错题重练',
  exam: '考试模式',
}

const OPTION_SEED_KEY = 'question-drilling-option-seed-v1'

function getOptionSeed() {
  try {
    const existing = sessionStorage.getItem(OPTION_SEED_KEY)
    if (existing) return existing
    const created = `${Date.now()}-${Math.random()}`
    sessionStorage.setItem(OPTION_SEED_KEY, created)
    return created
  } catch {
    return `${Date.now()}-${Math.random()}`
  }
}

function stringHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function shuffledOptionKeys(question: Question, seed: string) {
  const original = Object.keys(question.options)
  if (question.type === 'judgment' || original.length < 2) return original

  const shuffled = [...original]
  let state = stringHash(`${seed}:${question.id}`) || 1
  const random = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }

  if (shuffled.every((letter, index) => letter === original[index])) {
    shuffled.push(shuffled.shift()!)
  }
  return shuffled
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function sameAnswer(selected: string[], answer: string) {
  return [...selected].sort().join('') === [...answer].sort().join('')
}

function createExamQuestionIds(questions: Question[]) {
  const singles = shuffle(questions.filter((question) => question.type === 'single')).slice(0, 60)
  const multiples = shuffle(questions.filter((question) => question.type === 'multiple')).slice(0, 20)
  const judgments = shuffle(questions.filter((question) => question.type === 'judgment')).slice(0, 20)
  return shuffle([...singles, ...multiples, ...judgments]).map((question) => question.id)
}

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loadingError, setLoadingError] = useState('')
  const [practice, setPractice] = useState<PracticeState>(() => loadPracticeState())
  const [exam, setExam] = useState(() => loadExamState())
  const [mode, setMode] = useState<PracticeMode>('sequential')
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [randomOrder, setRandomOrder] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [lastResult, setLastResult] = useState<boolean | null>(null)
  const [showSource, setShowSource] = useState(true)
  const [showAnswerSheet, setShowAnswerSheet] = useState(true)
  const [optionSeed] = useState(getOptionSeed)

  useEffect(() => {
    fetch('/questions.json')
      .then((response) => {
        if (!response.ok) throw new Error('题库数据读取失败')
        return response.json() as Promise<Question[]>
      })
      .then(setQuestions)
      .catch((error: Error) => setLoadingError(error.message))
  }, [])

  useEffect(() => savePracticeState(practice), [practice])
  useEffect(() => saveExamState(exam), [exam])

  const typeFiltered = useMemo(
    () => questions.filter((question) => filter === 'all' || question.type === filter),
    [questions, filter],
  )

  const modeFiltered = useMemo(() => {
    if (mode !== 'wrong') return typeFiltered
    const wrong = new Set(practice.wrongIds)
    return typeFiltered.filter((question) => wrong.has(question.id))
  }, [mode, practice.wrongIds, typeFiltered])

  useEffect(() => {
    if (mode === 'random') setRandomOrder(shuffle(modeFiltered.map((question) => question.id)))
  }, [mode, filter, questions.length])

  const orderedQuestions = useMemo(() => {
    if (mode === 'exam') {
      const byId = new Map(questions.map((question) => [question.id, question]))
      return exam.questionIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    }
    if (mode !== 'random') return modeFiltered
    const byId = new Map(modeFiltered.map((question) => [question.id, question]))
    const existing = randomOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    const included = new Set(existing.map((question) => question.id))
    return [...existing, ...modeFiltered.filter((question) => !included.has(question.id))]
  }, [exam.questionIds, mode, modeFiltered, questions, randomOrder])

  const current = orderedQuestions[currentIndex]

  const currentOptions = useMemo(() => {
    if (!current) return []
    return shuffledOptionKeys(current, optionSeed).map((originalLetter, index) => ({
      originalLetter,
      displayLetter: String.fromCharCode(65 + index),
      text: current.options[originalLetter],
    }))
  }, [current, optionSeed])

  const displayedCorrectAnswer = useMemo(
    () => current?.correctAnswer
      .split('')
      .map((originalLetter) => currentOptions.find((option) => option.originalLetter === originalLetter)?.displayLetter)
      .filter(Boolean)
      .sort()
      .join('、') ?? '',
    [current, currentOptions],
  )

  useEffect(() => {
    setCurrentIndex(0)
  }, [mode, filter])

  useEffect(() => {
    if (currentIndex >= orderedQuestions.length && orderedQuestions.length > 0) {
      setCurrentIndex(orderedQuestions.length - 1)
    }
  }, [currentIndex, orderedQuestions.length])

  useEffect(() => {
    if (mode === 'exam' && current) {
      const savedSelection = exam.answers[current.id] ?? []
      setSelected(savedSelection)
      setSubmitted(exam.submitted)
      setLastResult(exam.submitted ? sameAnswer(savedSelection, current.correctAnswer) : null)
    } else {
      setSelected([])
      setSubmitted(false)
      setLastResult(null)
    }
    setShowSource(true)
  }, [current?.id, exam.submitted, mode])

  const answeredInView = mode === 'exam'
    ? orderedQuestions.filter((question) => (exam.answers[question.id] ?? []).length > 0).length
    : orderedQuestions.filter((question) => practice.answers[question.id]).length
  const progressPercent = orderedQuestions.length ? Math.round((answeredInView / orderedQuestions.length) * 100) : 0
  const accuracy = practice.totalAttempts
    ? Math.round((practice.correctAttempts / practice.totalAttempts) * 100)
    : 0

  const examCorrectCount = mode === 'exam' && exam.submitted
    ? orderedQuestions.filter((question) => sameAnswer(exam.answers[question.id] ?? [], question.correctAnswer)).length
    : 0

  const selectOption = (letter: string) => {
    if (!current || submitted) return
    setSelected((currentSelection) => {
      const nextSelection = current.type === 'multiple'
        ? currentSelection.includes(letter)
          ? currentSelection.filter((item) => item !== letter)
          : [...currentSelection, letter].sort()
        : [letter]
      if (mode === 'exam') {
        setExam((previous) => ({
          ...previous,
          answers: { ...previous.answers, [current.id]: nextSelection },
        }))
      }
      return nextSelection
    })
  }

  const submit = () => {
    if (!current || selected.length === 0 || submitted) return
    const correct = sameAnswer(selected, current.correctAnswer)
    setSubmitted(true)
    setLastResult(correct)
    setPractice((previous) => {
      const wrong = new Set(previous.wrongIds)
      if (!correct) wrong.add(current.id)
      return {
        answers: {
          ...previous.answers,
          [current.id]: { selected: [...selected], correct, answeredAt: new Date().toISOString() },
        },
        wrongIds: [...wrong],
        totalAttempts: previous.totalAttempts + 1,
        correctAttempts: previous.correctAttempts + (correct ? 1 : 0),
      }
    })
  }

  const goTo = (nextIndex: number) => {
    if (!orderedQuestions.length) return
    setCurrentIndex(Math.max(0, Math.min(orderedQuestions.length - 1, nextIndex)))
  }

  const jumpToQuestion = (questionId: string) => {
    const nextIndex = orderedQuestions.findIndex((question) => question.id === questionId)
    if (nextIndex < 0) return
    goTo(nextIndex)
    window.requestAnimationFrame(() => {
      document.querySelector('.question-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const answerSheetLabel = (question: Question, index: number) => {
    const numberLabel = mode === 'exam' ? `试卷第 ${index + 1} 题` : `第 ${question.originalNumber} 题`
    if (question.id === current?.id) return `${numberLabel}，当前题`
    if (mode === 'exam') {
      const selection = exam.answers[question.id] ?? []
      if (!selection.length) return `${numberLabel}，未作答`
      if (!exam.submitted) return `${numberLabel}，已作答`
      return `${numberLabel}，${sameAnswer(selection, question.correctAnswer) ? '回答正确' : '回答错误'}`
    }
    const answer = practice.answers[question.id]
    if (!answer) return `${numberLabel}，未作答`
    return `${numberLabel}，${answer.correct ? '回答正确' : '回答错误'}`
  }

  const switchMode = (nextMode: PracticeMode) => {
    if (nextMode === 'exam') {
      if (exam.questionIds.length === 100) {
        setFilter('all')
        setMode('exam')
        return
      }
      startExam(false)
      return
    }
    if (nextMode === 'random') setRandomOrder(shuffle(typeFiltered.map((question) => question.id)))
    setMode(nextMode)
  }

  const startExam = (confirmReplace: boolean) => {
    if (confirmReplace && exam.questionIds.length > 0 && !window.confirm('确定重新随机组卷吗？当前考试进度将被清空。')) return
    const questionIds = createExamQuestionIds(questions)
    setExam({ questionIds, answers: {}, submitted: false, startedAt: new Date().toISOString() })
    setFilter('all')
    setMode('exam')
    setCurrentIndex(0)
    setSelected([])
    setSubmitted(false)
    setLastResult(null)
  }

  const submitExam = () => {
    if (mode !== 'exam' || exam.submitted || orderedQuestions.length !== 100) return
    const unanswered = orderedQuestions.filter((question) => !(exam.answers[question.id] ?? []).length).length
    const message = unanswered > 0
      ? `还有 ${unanswered} 道题未作答，确定现在交卷吗？`
      : '已完成全部题目，确定交卷吗？'
    if (!window.confirm(message)) return

    const correctQuestions = orderedQuestions.filter((question) => sameAnswer(exam.answers[question.id] ?? [], question.correctAnswer))
    const correctIds = new Set(correctQuestions.map((question) => question.id))
    setPractice((previous) => {
      const wrong = new Set(previous.wrongIds)
      const answers = { ...previous.answers }
      orderedQuestions.forEach((question) => {
        const selection = exam.answers[question.id] ?? []
        const correct = correctIds.has(question.id)
        if (!correct) wrong.add(question.id)
        answers[question.id] = {
          selected: selection,
          correct,
          answeredAt: new Date().toISOString(),
        }
      })
      return {
        answers,
        wrongIds: [...wrong],
        totalAttempts: previous.totalAttempts + orderedQuestions.length,
        correctAttempts: previous.correctAttempts + correctQuestions.length,
      }
    })
    setExam((previous) => ({ ...previous, submitted: true }))
    setSubmitted(true)
    if (current) setLastResult(correctIds.has(current.id))
  }

  const resetAll = () => {
    if (!window.confirm('确定清空全部答题记录、正确率和错题本吗？')) return
    clearPracticeState()
    clearExamState()
    setPractice(emptyPracticeState())
    setExam(emptyExamState())
    if (mode === 'exam') setMode('sequential')
    setSelected([])
    setSubmitted(false)
    setLastResult(null)
  }

  const reshuffle = () => {
    setRandomOrder(shuffle(modeFiltered.map((question) => question.id)))
    setCurrentIndex(0)
  }

  if (loadingError) {
    return <div className="center-state"><CircleAlert size={28} />{loadingError}</div>
  }

  if (!questions.length) {
    return <div className="center-state"><span className="loader" />正在读取题库…</div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><BookOpenCheck size={21} /></div>
          <div>
            <strong>安规练习册</strong>
            <span>262 题 · 本地题库</span>
          </div>
        </div>
        <button className="ghost-button danger" onClick={resetAll} title="清空练习记录">
          <Trash2 size={16} />
          <span>清空记录</span>
        </button>
      </header>

      <main>
        <section className="hero-row" aria-label="练习概览">
          <div className="hero-copy">
            <span className="eyebrow">变电安规题库</span>
            <h1>把每一道题，练成直觉。</h1>
            <p>顺序推进、随机抽练，或只重做错题。答题记录会自动保存在当前浏览器。</p>
          </div>
          <div className="stats-grid">
            <article className="stat-card accent-green">
              <CheckCircle2 size={18} />
              <div><strong>{Object.keys(practice.answers).length}</strong><span>已答题目</span></div>
            </article>
            <article className="stat-card accent-amber">
              <Target size={18} />
              <div><strong>{accuracy}%</strong><span>累计正确率</span></div>
            </article>
            <article className="stat-card accent-red">
              <XCircle size={18} />
              <div><strong>{practice.wrongIds.length}</strong><span>错题记录</span></div>
            </article>
          </div>
        </section>

        <section className="control-panel">
          <div className="mode-tabs" aria-label="练习模式">
            <button className={mode === 'sequential' ? 'active' : ''} onClick={() => switchMode('sequential')}>
              <ListOrdered size={17} />顺序练习
            </button>
            <button className={mode === 'random' ? 'active' : ''} onClick={() => switchMode('random')}>
              <Shuffle size={17} />随机练习
            </button>
            <button className={mode === 'wrong' ? 'active' : ''} onClick={() => switchMode('wrong')}>
              <RotateCcw size={17} />错题重练
              {practice.wrongIds.length > 0 && <em>{practice.wrongIds.length}</em>}
            </button>
            <button className={mode === 'exam' ? 'active' : ''} onClick={() => switchMode('exam')}>
              <ClipboardCheck size={17} />考试模式
            </button>
          </div>
          <div className="filter-row">
            {mode === 'exam' ? (
              <>
                <span className="exam-composition">单选 60 · 多选 20 · 判断 20</span>
                <button className="reshuffle" onClick={() => startExam(true)}><Shuffle size={14} />重新组卷</button>
              </>
            ) : (
              <>
                <span>题型</span>
                {(['all', 'single', 'multiple', 'judgment'] as TypeFilter[]).map((item) => (
                  <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                    {item === 'all' ? '全部' : TYPE_LABELS[item]}
                  </button>
                ))}
                {mode === 'random' && (
                  <button className="reshuffle" onClick={reshuffle}><Shuffle size={14} />重新洗牌</button>
                )}
              </>
            )}
          </div>
        </section>

        <section className="progress-strip">
          <div className="progress-label">
            <span>{MODE_LABELS[mode]} · {orderedQuestions.length} 题</span>
            <strong>{answeredInView}/{orderedQuestions.length} 已完成</strong>
          </div>
          <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
        </section>

        {mode === 'exam' && orderedQuestions.length === 100 && (
          <section className={`exam-status-panel ${exam.submitted ? 'exam-finished' : ''}`} aria-label="考试状态">
            <div className="exam-status-copy">
              <ClipboardCheck size={22} />
              <div>
                <strong>{exam.submitted ? `考试成绩：${examCorrectCount} 分` : '100 题随机试卷'}</strong>
                <span>
                  {exam.submitted
                    ? `答对 ${examCorrectCount} 题，答错或未答 ${100 - examCorrectCount} 题。可通过答题卡检查每道题。`
                    : `单选 60 题、多选 20 题、判断 20 题；已作答 ${answeredInView} 题。交卷前不显示答案。`}
                </span>
              </div>
            </div>
            {exam.submitted ? (
              <button className="exam-secondary-button" onClick={() => startExam(true)}><Shuffle size={15} />重新组卷</button>
            ) : (
              <button className="exam-submit-button" onClick={submitExam}>交卷</button>
            )}
          </section>
        )}

        {!current ? (
          <section className="empty-card">
            <CheckCircle2 size={34} />
            <h2>{mode === 'wrong' ? '错题本还是空的' : '当前筛选下没有题目'}</h2>
            <p>{mode === 'wrong' ? '答错的题会自动出现在这里。' : '换一个题型筛选继续练习。'}</p>
            {mode === 'wrong' && <button className="primary-button" onClick={() => switchMode('sequential')}>开始顺序练习</button>}
          </section>
        ) : (
          <section className="practice-layout">
            <article className="question-card">
              <div className="question-meta">
                <div className="meta-left">
                  <span className={`type-badge ${current.type}`}>{TYPE_LABELS[current.type]}</span>
                  {mode === 'exam' ? (
                    <>
                      <span className="exam-sequence-number">试卷第 {currentIndex + 1} 题</span>
                      <span>题库原题 {current.originalNumber}</span>
                    </>
                  ) : (
                    <span>原题第 {current.originalNumber} 题</span>
                  )}
                  <span>PDF 第 {current.sourcePages.join('、')} 页</span>
                  {current.type !== 'judgment' && <span className="shuffle-note"><Shuffle size={12} />选项已乱序</span>}
                </div>
                <span className="counter">{currentIndex + 1} / {orderedQuestions.length}</span>
              </div>

              <h2 className="question-stem">{current.stem}</h2>

              {current.needsReview && (
                <div className="review-note"><CircleAlert size={16} />OCR 文本待确认，请同时核对右侧原题图。</div>
              )}

              <div className="options" role="group" aria-label="题目选项">
                {currentOptions.map(({ originalLetter, displayLetter, text }) => {
                  const chosen = selected.includes(originalLetter)
                  const isAnswer = submitted && current.correctAnswer.includes(originalLetter)
                  const isWrongChoice = submitted && chosen && !current.correctAnswer.includes(originalLetter)
                  return (
                    <button
                      key={originalLetter}
                      className={`option ${chosen ? 'selected' : ''} ${isAnswer ? 'correct' : ''} ${isWrongChoice ? 'wrong' : ''}`}
                      onClick={() => selectOption(originalLetter)}
                      disabled={submitted}
                    >
                      <span className="option-letter">
                        {isAnswer ? <Check size={16} /> : isWrongChoice ? <X size={16} /> : displayLetter}
                      </span>
                      <span>{text}</span>
                    </button>
                  )
                })}
              </div>

              {submitted && (
                <div className={`result-panel ${lastResult ? 'success' : 'error'}`}>
                  {lastResult ? <CheckCircle2 size={21} /> : <XCircle size={21} />}
                  <div>
                    <strong>{lastResult ? '回答正确' : '回答错误'}</strong>
                    <span>正确答案：{displayedCorrectAnswer}</span>
                  </div>
                </div>
              )}

              <div className="question-actions">
                <button className="nav-button" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
                  <ChevronLeft size={17} />上一题
                </button>
                {mode === 'exam' ? (
                  exam.submitted ? (
                    <span className={`exam-question-result ${lastResult ? 'is-right' : 'is-wrong'}`}>
                      {lastResult ? '本题正确' : '本题错误'}
                    </span>
                  ) : (
                    <button className="primary-button exam-hand-in" onClick={submitExam}>交卷</button>
                  )
                ) : !submitted ? (
                  <button className="primary-button" onClick={submit} disabled={!selected.length}>提交答案</button>
                ) : (
                  <button className="primary-button" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === orderedQuestions.length - 1}>
                    下一题<ChevronRight size={17} />
                  </button>
                )}
                {mode === 'exam' ? (
                  <button className="nav-button next" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === orderedQuestions.length - 1}>
                    下一题<ChevronRight size={17} />
                  </button>
                ) : !submitted && (
                  <button className="nav-button next" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === orderedQuestions.length - 1}>
                    下一题<ChevronRight size={17} />
                  </button>
                )}
              </div>
            </article>

            <div className="side-column">
              <aside className="answer-sheet-card">
                <button className="side-card-heading" onClick={() => setShowAnswerSheet((value) => !value)}>
                  <span><Grid3X3 size={17} />答题卡 <b>{answeredInView}/{orderedQuestions.length}</b></span>
                  <em>{showAnswerSheet ? '收起' : '展开'}</em>
                </button>
                {showAnswerSheet && (
                  <>
                    <div className="answer-sheet-legend" aria-hidden="true">
                      <span><i className="legend-current" />当前</span>
                      {mode === 'exam' && !exam.submitted ? (
                        <span><i className="legend-answered" />已答</span>
                      ) : (
                        <>
                          <span><i className="legend-correct" />正确</span>
                          <span><i className="legend-wrong" />错误</span>
                        </>
                      )}
                      <span><i />未答</span>
                    </div>
                    <div className="answer-sheet-grid" aria-label="答题卡题号">
                      {orderedQuestions.map((question, index) => {
                        const answer = practice.answers[question.id]
                        const examSelection = exam.answers[question.id] ?? []
                        const status = question.id === current.id
                          ? 'current'
                          : mode === 'exam' && examSelection.length > 0 && !exam.submitted
                            ? 'answered-pending'
                            : mode === 'exam' && exam.submitted
                              ? sameAnswer(examSelection, question.correctAnswer)
                                ? 'answered-correct'
                                : 'answered-wrong'
                          : answer?.correct
                            ? 'answered-correct'
                            : answer
                              ? 'answered-wrong'
                              : 'unanswered'
                        return (
                          <button
                            key={question.id}
                            className={status}
                            onClick={() => jumpToQuestion(question.id)}
                            aria-label={answerSheetLabel(question, index)}
                            aria-current={question.id === current.id ? 'step' : undefined}
                          >
                            {mode === 'exam' ? index + 1 : question.originalNumber}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </aside>

              <aside className="source-card">
                <button className="side-card-heading" onClick={() => setShowSource((value) => !value)}>
                  <span><ImageIcon size={17} />原题影像</span>
                  <em>{showSource ? '收起' : '展开'}</em>
                </button>
                {showSource && (
                  <div className="source-images">
                    {current.images.map((source) => (
                      <a key={source} href={source} target="_blank" rel="noreferrer" title="打开原图">
                        <img src={source} alt={`第 ${current.originalNumber} 题原题图`} />
                      </a>
                    ))}
                  </div>
                )}
                <p>图片直接裁自源 PDF；点击可查看大图。</p>
                {mode !== 'exam' && practice.answers[current.id] && (
                  <div className={`previous-result ${practice.answers[current.id].correct ? 'was-right' : 'was-wrong'}`}>
                    {practice.answers[current.id].correct ? '上次答对' : '上次答错'} · 已记录所选内容
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
