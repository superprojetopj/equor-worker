import type { ContextFile } from './storage.types.js'

export type { ContextFile }

export type AIContentPart = { text: string } | { inline_data: { mime_type: string; data: string } }

export interface AIProviderRequest {
  content: AIContentPart[]
  systemInstruction?: string
  generationConfig?: Record<string, unknown>
}

export interface AIUsage {
  provider: 'claude' | 'gemini'
  model: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  estimatedCostUsd: number | null
}

export interface AIResult {
  text: string
  usage: AIUsage
}
