import { getEnv } from '../config/env.js'
import {
  BackendProcessResponseSchema,
  PlanilhaReviewListResponseSchema,
  type PlanilhaReviewItem,
} from '../schemas/backend.schema.js'
import type {
  BackendProcessResponse,
  DocumentStatus,
  DocumentResultPayload,
  PromptResult,
} from '../types/backend.types.js'

export type { PlanilhaReviewItem }

function backendUrl(): string {
  return getEnv().BACKEND_URL.replace(/\/$/, '')
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Worker-Key': getEnv().WORKER_SECRET,
  }
}

export async function fetchProcessData(processId: number): Promise<BackendProcessResponse> {
  const path = getEnv().BACKEND_DOCUMENT_PATH.replace('{id}', String(processId))
  const url = `${backendUrl()}${path}`

  const response = await fetch(url, {
    method: 'GET',
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend GET failed: ${response.status} - ${body}`)
  }

  const json = (await response.json()) as { success?: boolean; data?: unknown }
  const payload = json.data ?? json
  return BackendProcessResponseSchema.parse(payload) as BackendProcessResponse
}

export async function reportDocumentResult(
  processDocumentId: number,
  status: DocumentStatus,
  prompts: PromptResult[] = [],
  errorMessage?: string
): Promise<void> {
  const url = `${backendUrl()}/worker/process-document/${processDocumentId}/result`

  const payload: DocumentResultPayload = {
    status,
    prompts,
    error_message: errorMessage ?? null,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST failed: ${response.status} - ${body}`)
  }
}

export async function fetchPlanilhaReviewList(): Promise<PlanilhaReviewItem[]> {
  const url = `${backendUrl()}/planilha-review/get-all`

  const response = await fetch(url, {
    method: 'GET',
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  })

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

  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST /planilha-review/${id} failed: ${response.status} - ${body}`)
  }
}
