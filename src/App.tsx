import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
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
import { clearPracticeState, emptyPracticeState, loadPracticeState, savePracticeState } from './utils/storage'

type PracticeMode = 'sequential' | 'random' | 'wrong'
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

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loadingError, setLoadingError] = useState('')
  const [practice, setPractice] = useState<PracticeState>(() => loadPracticeState())
  const [mode, setMode] = useState<PracticeMode>('sequential')
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [randomOrder, setRandomOrder] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [lastResult, setLastResult] = useState<boolean | null>(null)
  const [showSource, setShowSource] = useState(true)

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
    if (mode !== 'random') return modeFiltered
    const byId = new Map(modeFiltered.map((question) => [question.id, question]))
    const existing = randomOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    const included = new Set(existing.map((question) => question.id))
    return [...existing, ...modeFiltered.filter((question) => !included.has(question.id))]
  }, [mode, modeFiltered, randomOrder])

  const current = orderedQuestions[currentIndex]

  useEffect(() => {
    setCurrentIndex(0)
  }, [mode, filter])

  useEffect(() => {
    if (currentIndex >= orderedQuestions.length && orderedQuestions.length > 0) {
      setCurrentIndex(orderedQuestions.length - 1)
    }
  }, [currentIndex, orderedQuestions.length])

  useEffect(() => {
    setSelected([])
    setSubmitted(false)
    setLastResult(null)
    setShowSource(true)
  }, [current?.id, mode])

  const answeredInView = orderedQuestions.filter((question) => practice.answers[question.id]).length
  const progressPercent = orderedQuestions.length ? Math.round((answeredInView / orderedQuestions.length) * 100) : 0
  const accuracy = practice.totalAttempts
    ? Math.round((practice.correctAttempts / practice.totalAttempts) * 100)
    : 0

  const selectOption = (letter: string) => {
    if (!current || submitted) return
    if (current.type === 'multiple') {
      setSelected((currentSelection) =>
        currentSelection.includes(letter)
          ? currentSelection.filter((item) => item !== letter)
          : [...currentSelection, letter].sort(),
      )
    } else {
      setSelected([letter])
    }
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

  const switchMode = (nextMode: PracticeMode) => {
    if (nextMode === 'random') setRandomOrder(shuffle(typeFiltered.map((question) => question.id)))
    setMode(nextMode)
  }

  const resetAll = () => {
    if (!window.confirm('确定清空全部答题记录、正确率和错题本吗？')) return
    clearPracticeState()
    setPractice(emptyPracticeState())
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
          </div>
          <div className="filter-row">
            <span>题型</span>
            {(['all', 'single', 'multiple', 'judgment'] as TypeFilter[]).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item === 'all' ? '全部' : TYPE_LABELS[item]}
              </button>
            ))}
            {mode === 'random' && (
              <button className="reshuffle" onClick={reshuffle}><Shuffle size={14} />重新洗牌</button>
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
                  <span>原题第 {current.originalNumber} 题</span>
                  <span>PDF 第 {current.sourcePages.join('、')} 页</span>
                </div>
                <span className="counter">{currentIndex + 1} / {orderedQuestions.length}</span>
              </div>

              <h2 className="question-stem">{current.stem}</h2>

              {current.needsReview && (
                <div className="review-note"><CircleAlert size={16} />OCR 文本待确认，请同时核对右侧原题图。</div>
              )}

              <div className="options" role="group" aria-label="题目选项">
                {Object.entries(current.options).map(([letter, text]) => {
                  const chosen = selected.includes(letter)
                  const isAnswer = submitted && current.correctAnswer.includes(letter)
                  const isWrongChoice = submitted && chosen && !current.correctAnswer.includes(letter)
                  return (
                    <button
                      key={letter}
                      className={`option ${chosen ? 'selected' : ''} ${isAnswer ? 'correct' : ''} ${isWrongChoice ? 'wrong' : ''}`}
                      onClick={() => selectOption(letter)}
                      disabled={submitted}
                    >
                      <span className="option-letter">
                        {isAnswer ? <Check size={16} /> : isWrongChoice ? <X size={16} /> : letter}
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
                    <span>正确答案：{current.correctAnswer.split('').join('、')}</span>
                  </div>
                </div>
              )}

              <div className="question-actions">
                <button className="nav-button" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
                  <ChevronLeft size={17} />上一题
                </button>
                {!submitted ? (
                  <button className="primary-button" onClick={submit} disabled={!selected.length}>提交答案</button>
                ) : (
                  <button className="primary-button" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === orderedQuestions.length - 1}>
                    下一题<ChevronRight size={17} />
                  </button>
                )}
                {!submitted && (
                  <button className="nav-button next" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === orderedQuestions.length - 1}>
                    下一题<ChevronRight size={17} />
                  </button>
                )}
              </div>
            </article>

            <aside className="source-card">
              <button className="source-heading" onClick={() => setShowSource((value) => !value)}>
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
              {practice.answers[current.id] && (
                <div className={`previous-result ${practice.answers[current.id].correct ? 'was-right' : 'was-wrong'}`}>
                  {practice.answers[current.id].correct ? '上次答对' : '上次答错'} · 选择 {practice.answers[current.id].selected.join('、')}
                </div>
              )}
            </aside>
          </section>
        )}
      </main>
    </div>
  )
}
