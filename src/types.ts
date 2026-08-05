export type QuestionType = 'single' | 'multiple' | 'judgment'

export interface Question {
  id: string
  originalNumber: number
  type: QuestionType
  stem: string
  options: Record<string, string>
  correctAnswer: string
  sourcePage: number
  sourcePages: number[]
  images: string[]
  needsReview: boolean
  reviewNotes: string[]
  ocrConfidence: number
}

export interface AnswerRecord {
  selected: string[]
  correct: boolean
  answeredAt: string
}

export interface PracticeState {
  answers: Record<string, AnswerRecord>
  wrongIds: string[]
  totalAttempts: number
  correctAttempts: number
}
