import fs from 'fs/promises'
import path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getEnv } from '../config/env.js'

const BASE_URL = 'https://generativelanguage.googleapis.com'

function apiKey(): string {
  return getEnv().GEMINI_API_KEY
}

let _genai: GoogleGenerativeAI | null = null
function getGenAI(): GoogleGenerativeAI {
  if (!_genai) _genai = new GoogleGenerativeAI(apiKey())
  return _genai
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

// Gemini 1.5 Flash context window (tokens)
const MAX_TOKENS = 1_048_576

/**
 * Conta os tokens que os arquivos + prompt vão ocupar no contexto do Gemini.
 * Usa a Files API (fileUri já deve estar ACTIVE).
 * Retorna o total de tokens.
 */
export async function countTokensForFiles(
  files: GeminiFileRef[],
  prompt: string
): Promise<number> {
  const model = getEnv().GEMINI_MODEL
  const genModel = getGenAI().getGenerativeModel({ model })

  const fileParts = files.map((f) => ({
    fileData: { mimeType: f.mimeType, fileUri: f.uri },
  }))

  const { totalTokens } = await genModel.countTokens({
    contents: [{ role: 'user', parts: [...fileParts, { text: prompt }] }],
  })

  return totalTokens
}

export { MAX_TOKENS }

/**
 * Calls Gemini generateContent with one or more file references and returns the parsed JSON result.
 */
export async function callGeminiWithFiles(
  files: GeminiFileRef[],
  prompt: string,
  responseSchema: object
): Promise<unknown> {
  const model = getEnv().GEMINI_MODEL
  const url = `${BASE_URL}/v1beta/models/${model}:generateContent?key=${apiKey()}`

  const fileParts = files.map((f) => ({
    file_data: { mime_type: f.mimeType, file_uri: f.uri },
  }))

  const body = {
    contents: [
      {
        parts: [...fileParts, { text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini generateContent failed [${response.status}]: ${text}`)
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error(`Gemini returned no text content: ${JSON.stringify(json)}`)
  }

  return JSON.parse(text) as unknown
}
