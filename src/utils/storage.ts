import type { PracticeState } from '../types'

const STORAGE_KEY = 'question-drilling-progress-v1'

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
