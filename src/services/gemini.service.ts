import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import { stripMarkdownFences } from '../lib/ai-response.js'
import type { AIProviderRequest } from '../types/ai.types.js'

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

export async function callGemini(req: AIProviderRequest): Promise<string> {
  const { content, systemInstruction, generationConfig = { maxOutputTokens: 16000 } } = req
  const model = getEnv().GEMINI_MODEL
  const url = `${BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey()}`

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeout: 600_000 }
  )

  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Gemini generateContent failed [${response.status}]: ${responseText}`)
  }

  const json = JSON.parse(responseText) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error(`Gemini returned no text content: ${JSON.stringify(json)}`)
  }

  return stripMarkdownFences(text)
}
