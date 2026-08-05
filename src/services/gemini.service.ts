import pino from 'pino'
import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import { stripMarkdownFences } from '../lib/ai-response.js'
import { GeminiGenerateContentResponseSchema } from '../schemas/gemini.schema.js'
import type { AIProviderRequest, AIResult, AIUsage } from '../types/ai.types.js'

const log = pino({ name: 'gemini' })

const BASE_URL = 'https://generativelanguage.googleapis.com'

function apiKey(): string {
  const key = getEnv().GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured')
  }
  return key
}

export interface GeminiFileRef {
  uri: string
  mimeType: string
}

export async function callGemini(req: AIProviderRequest): Promise<AIResult> {
  const { content, systemInstruction, generationConfig = { maxOutputTokens: 16000 } } = req
  const model = getEnv().GEMINI_MODEL
  // API key goes in a header — never in the URL, where it would leak into
  // logs, error messages and proxies.
  const url = `${BASE_URL}/v1beta/models/${model}:generateContent`

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: content }],
    generationConfig,
    ...(systemInstruction && {
      system_instruction: { parts: [{ text: systemInstruction }] },
    }),
  }

  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
    },
    { timeout: 600_000 }
  )

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini generateContent failed [${response.status}]: ${responseText}`)
  }

  const json = GeminiGenerateContentResponseSchema.parse(JSON.parse(responseText))

  const usage: AIUsage = {
    provider: 'gemini',
    model,
    inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    // Sem tabela de preços Gemini — custo fica a cargo de quem consome o dado
    estimatedCostUsd: null,
  }
  log.info(usage, 'Gemini generation usage')

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error(`Gemini returned no text content: ${JSON.stringify(json)}`)
  }

  return { text: stripMarkdownFences(text), usage }
}
