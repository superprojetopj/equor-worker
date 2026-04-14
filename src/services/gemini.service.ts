import fs from 'fs/promises'
import path from 'path'
import { getEnv } from '../config/env.js'

const BASE_URL = 'https://generativelanguage.googleapis.com'

function apiKey(): string {
  return getEnv().GEMINI_API_KEY
}

export interface GeminiFileRef {
  uri: string
  mimeType: string
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return map[ext] ?? 'application/octet-stream'
}

/**
 * Uploads a local file to the Gemini Files API.
 * Auto-detects mime type from the file extension.
 * Polls until the file state is ACTIVE before returning.
 */
export async function uploadFileToGemini(filePath: string): Promise<GeminiFileRef> {
  const fileName = path.basename(filePath)
  const mimeType = detectMimeType(filePath)
  const fileData = await fs.readFile(filePath)

  const boundary = `----GeminiBoundary${Date.now()}`
  const metadataJson = JSON.stringify({ file: { display_name: fileName } })
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  const closing = `\r\n--${boundary}--`

  const body = Buffer.concat([
    Buffer.from(metadataPart, 'utf-8'),
    Buffer.from(filePart, 'utf-8'),
    fileData,
    Buffer.from(closing, 'utf-8'),
  ])

  const url = `${BASE_URL}/upload/v1beta/files?key=${apiKey()}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body,
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini Files API upload failed [${response.status}]: ${text}`)
  }

  const json = (await response.json()) as {
    file?: { uri?: string; name?: string; state?: string }
  }

  const uri = json.file?.uri
  const name = json.file?.name

  if (!uri || !name) {
    throw new Error(`Gemini upload response missing uri/name: ${JSON.stringify(json)}`)
  }

  await waitForFileActive(name)

  return { uri, mimeType }
}

async function waitForFileActive(name: string, maxAttempts = 15): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = `${BASE_URL}/v1beta/${name}?key=${apiKey()}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (resp.ok) {
      const json = (await resp.json()) as { state?: string }
      if (json.state === 'ACTIVE') return
      if (json.state === 'FAILED') {
        throw new Error(`Gemini file processing failed: ${name}`)
      }
    }

    console.log(
      `  [Gemini] Arquivo processando (${name}), aguardando 2s... (${attempt + 1}/${maxAttempts})`
    )
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Gemini file never became ACTIVE after ${maxAttempts} attempts: ${name}`)
}

// Gemini 2.5 Flash context window (tokens)
const MAX_TOKENS = 1_048_576

/** Mesmo generationConfig em countTokens e generateContent para o total bater. */
function buildJsonGenerationConfig(responseSchema: object): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema,
    temperature: 1, 
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: 4096 }, 
  }
  return cfg
}

/**
 * Conta os tokens que os arquivos + prompt vão ocupar no contexto do Gemini.
 * Usa a REST API (mesma que o generateContent) para garantir consistência.
 * Inclui o responseSchema na contagem, pois ele consome tokens no contexto.
 */
export async function countTokensForFiles(
  files: GeminiFileRef[],
  prompt: string,
  responseSchema?: object
): Promise<number> {
  const model = getEnv().GEMINI_MODEL
  const url = `${BASE_URL}/v1beta/models/${model}:countTokens?key=${apiKey()}`

  const fileParts = files.map((f) => ({
    file_data: { mime_type: f.mimeType, file_uri: f.uri },
  }))

  const body: Record<string, unknown> = {
    generateContentRequest: {
      model: `models/${model}`,
      contents: [{ parts: [...fileParts, { text: prompt }] }],
      ...(responseSchema && {
        generationConfig: buildJsonGenerationConfig(responseSchema),
      }),
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini countTokens failed [${response.status}]: ${text}`)
  }

  const json = (await response.json()) as { totalTokens?: number }
  return json.totalTokens ?? 0
}

export { MAX_TOKENS }

export class GeminiTokenLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiTokenLimitError'
  }
}

/** Gemini generateContent com JSON schema. `files` pode ser [] (só texto, ex. merge de parciais). */
export async function callGeminiWithFiles(
  files: GeminiFileRef[],
  prompt: string,
  responseSchema: object,
): Promise<unknown> {
  const model = getEnv().GEMINI_MODEL
  const url = `${BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey()}`

  const body = {
    contents: [{
      parts: [
        ...files.map((f) => ({ file_data: { mime_type: f.mimeType, file_uri: f.uri } })),
        { text: prompt },
      ],
    }],
    generationConfig: buildJsonGenerationConfig(responseSchema),
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  })

  const responseText = await response.text()

  if (!response.ok) {
    const isTokenLimit = response.status === 400 && /token|context|size|exceed/i.test(responseText)
    if (isTokenLimit) {
      throw new GeminiTokenLimitError(`Gemini context limit exceeded [${response.status}]: ${responseText}`)
    }
    throw new Error(`Gemini generateContent failed [${response.status}]: ${responseText}`)
  }

  const json = JSON.parse(responseText) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error(`Gemini returned no text content: ${JSON.stringify(json)}`)
  }

  return parseGeminiJson(text)
}

/**
 * Parses JSON returned by Gemini, escaping any literal control characters
 * that Gemini sometimes emits raw inside string values (invalid per JSON spec).
 */
function parseGeminiJson(text: string): unknown {
  const sanitized = sanitizeJsonControlChars(text)
  try {
    return JSON.parse(sanitized)
  } catch {
    // Fallback: strip ```json ... ``` wrapper Gemini sometimes adds
    const codeBlock = sanitized.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (codeBlock) return JSON.parse(codeBlock[1])
    throw new Error(`Gemini response is not valid JSON: ${text.slice(0, 300)}`)
  }
}

/**
 * Walks the JSON text character-by-character and escapes literal control
 * characters (codepoint < 0x20) only when inside a JSON string value.
 * Characters outside strings are left untouched (they are valid whitespace).
 */
function sanitizeJsonControlChars(text: string): string {
  const ESCAPES: Record<string, string> = {
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\b': '\\b',
    '\f': '\\f',
  }
  let result = ''
  let inString = false
  let escaped = false

  for (const ch of text) {
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && ch.charCodeAt(0) < 0x20) {
      result += ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
      continue
    }
    result += ch
  }

  return result
}
