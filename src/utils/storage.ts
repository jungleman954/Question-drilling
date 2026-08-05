import type { ExamState, PracticeState } from '../types'

const STORAGE_KEY = 'question-drilling-progress-v1'
const EXAM_STORAGE_KEY = 'question-drilling-exam-v1'

export const emptyPracticeState = (): PracticeState => ({
  answers: {},
  wrongIds: [],
  totalAttempts: 0,
  correctAttempts: 0,
})

export function loadPracticeState(): PracticeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyPracticeState()
    const parsed = JSON.parse(raw) as Partial<PracticeState>
    return {
      answers: parsed.answers ?? {},
      wrongIds: parsed.wrongIds ?? [],
      totalAttempts: parsed.totalAttempts ?? 0,
      correctAttempts: parsed.correctAttempts ?? 0,
    }
  } catch {
    return emptyPracticeState()
  }
}

export function savePracticeState(state: PracticeState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearPracticeState() {
  localStorage.removeItem(STORAGE_KEY)
}

export const emptyExamState = (): ExamState => ({
  questionIds: [],
  answers: {},
  submitted: false,
  startedAt: null,
})

export function loadExamState(): ExamState {
  try {
    const raw = localStorage.getItem(EXAM_STORAGE_KEY)
    if (!raw) return emptyExamState()
    const parsed = JSON.parse(raw) as Partial<ExamState>
    return {
      questionIds: parsed.questionIds ?? [],
      answers: parsed.answers ?? {},
      submitted: parsed.submitted ?? false,
      startedAt: parsed.startedAt ?? null,
    }
  } catch {
    return emptyExamState()
  }
}

export function saveExamState(state: ExamState) {
  localStorage.setItem(EXAM_STORAGE_KEY, JSON.stringify(state))
}

export function clearExamState() {
  localStorage.removeItem(EXAM_STORAGE_KEY)
}
