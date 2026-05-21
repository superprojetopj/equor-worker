import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import {
  BackendProcessDocumentResponseSchema,
  PlanilhaReviewListResponseSchema,
  type PlanilhaReviewItem,
} from '../schemas/backend.schema.js'
import type {
  DocumentStatus,
  DocumentResultPayload,
  PromptResult,
  BackendProcessDocumentResponse,
} from '../types/backend.types.js'

function backendUrl(): string {
  return getEnv().BACKEND_URL.replace(/\/$/, '')
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Worker-Key': getEnv().WORKER_SECRET,
  }
}

export async function fetchProcessDocumentData(processDocumentId: number): Promise<BackendProcessDocumentResponse> {
  const path = getEnv().BACKEND_AI_GENERATE_PATH.replace('{processDocumentId}', String(processDocumentId))
  const url = `${backendUrl()}${path}`

  const response = await fetchWithRetry(url, { method: 'GET', headers: headers() })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend GET ${path} failed: ${response.status} - ${body}`)
  }

  const json = (await response.json()) as { success?: boolean; data?: unknown }
  const payload = json.data ?? json
  return BackendProcessDocumentResponseSchema.parse(payload) as BackendProcessDocumentResponse
}

export async function reportAiGenerateResult(
  processDocumentId: number,
  status: DocumentStatus,
  prompts: PromptResult[] = [],
  errorMessage?: string
): Promise<void> {
  const path = getEnv().BACKEND_AI_GENERATE_RESULT_PATH.replace('{processDocumentId}', String(processDocumentId))
  const url = `${backendUrl()}${path}`

  const payload: DocumentResultPayload = {
    status,
    prompts,
    error_message: errorMessage ?? null,
  }

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST failed: ${response.status} - ${body}`)
  }
}

export async function fetchPlanilhaReviewList(): Promise<PlanilhaReviewItem[]> {
  const url = `${backendUrl()}/planilha-review/get-all`

  const response = await fetchWithRetry(url, { method: 'GET', headers: headers() })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend GET /planilha-review/get-all failed: ${response.status} - ${body}`)
  }

  const json = await response.json()
  const parsed = PlanilhaReviewListResponseSchema.parse(json)
  return parsed.data
}

export async function updatePlanilhaReview(id: number, payload: unknown): Promise<void> {
  const url = `${backendUrl()}/planilha-review/${id}`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST /planilha-review/${id} failed: ${response.status} - ${body}`)
  }
}
