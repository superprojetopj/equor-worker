import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import {
  BackendProcessDocumentResponseSchema,
  BackendSignDocumentResponseSchema,
} from '../schemas/backend.schema.js'
import {
  RecallMediaTaskDataSchema,
  type RecallMediaKind,
  type RecallMediaResultArtifact,
  type RecallMediaTaskData,
} from '../schemas/recall-media.schema.js'
import type {
  AiUsageReport,
  DocumentStatus,
  DocumentResultPayload,
  PromptResult,
  BackendProcessDocumentResponse,
  BackendSignDocumentResponse,
  SignatoryResult,
  SignTaskResultPayload,
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

export async function fetchProcessDocumentData(
  processDocumentId: number
): Promise<BackendProcessDocumentResponse> {
  const path = getEnv().BACKEND_AI_GENERATE_PATH.replace(
    '{processDocumentId}',
    String(processDocumentId)
  )
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

export async function fetchSignDocumentData(
  processDocumentId: number
): Promise<BackendSignDocumentResponse> {
  const path = getEnv().BACKEND_SIGN_TASK_DATA_PATH.replace(
    '{processDocumentId}',
    String(processDocumentId)
  )
  const url = `${backendUrl()}${path}`

  const response = await fetchWithRetry(url, { method: 'GET', headers: headers() })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend GET ${path} failed: ${response.status} - ${body}`)
  }

  const json = (await response.json()) as { success?: boolean; data?: unknown }
  const payload = json.data ?? json
  return BackendSignDocumentResponseSchema.parse(payload) as BackendSignDocumentResponse
}

/**
 * O que ainda falta transferir da reunião, com URLs frescas do Recall.
 *
 * O backend só resolve as URLs neste momento porque elas são de curta duração —
 * buscá-las antes de o worker pedir trabalho seria pedir para expirarem na
 * fila. Lista vazia é resposta legítima: nada pendente, ou artefato que o
 * Recall ainda está preparando.
 */
export async function fetchRecallMediaTaskData(
  processMeetingId: number,
  kind: RecallMediaKind
): Promise<RecallMediaTaskData> {
  const env = getEnv()
  const template =
    kind === 'video'
      ? env.BACKEND_RECALL_VIDEO_TASK_DATA_PATH
      : env.BACKEND_RECALL_TRANSCRIPT_TASK_DATA_PATH

  const path = template.replace('{processMeetingId}', String(processMeetingId))
  const url = `${backendUrl()}${path}`

  const response = await fetchWithRetry(url, { method: 'GET', headers: headers() })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend GET ${path} failed: ${response.status} - ${body}`)
  }

  const json = (await response.json()) as { success?: boolean; data?: unknown }
  const payload = json.data ?? json
  return RecallMediaTaskDataSchema.parse(payload)
}

export async function reportRecallMediaResult(
  processMeetingId: number,
  kind: RecallMediaKind,
  status: 'DONE' | 'FAILED',
  options: { artifacts?: RecallMediaResultArtifact[]; errorMessage?: string } = {}
): Promise<void> {
  const env = getEnv()
  const template =
    kind === 'video'
      ? env.BACKEND_RECALL_VIDEO_RESULT_PATH
      : env.BACKEND_RECALL_TRANSCRIPT_RESULT_PATH

  const path = template.replace('{processMeetingId}', String(processMeetingId))
  const url = `${backendUrl()}${path}`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      status,
      artifacts: options.artifacts ?? [],
      error_message: options.errorMessage ?? null,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST ${path} failed: ${response.status} - ${body}`)
  }
}

export async function reportSignTaskResult(
  processDocumentId: number,
  status: DocumentStatus,
  options: {
    contraktorContractId?: string
    gcsPath?: string
    signatories?: SignatoryResult[]
    errorMessage?: string
  } = {}
): Promise<void> {
  const path = getEnv().BACKEND_SIGN_TASK_RESULT_PATH.replace(
    '{processDocumentId}',
    String(processDocumentId)
  )
  const url = `${backendUrl()}${path}`

  const payload: SignTaskResultPayload = {
    status,
    contraktor_contract_id: options.contraktorContractId,
    gcs_path: options.gcsPath,
    signatories: options.signatories,
    error_message: options.errorMessage ?? null,
  }

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST ${path} failed: ${response.status} - ${body}`)
  }
}

export async function reportAiGenerateResult(
  processDocumentId: number,
  status: DocumentStatus,
  prompts: PromptResult[] = [],
  errorMessage?: string,
  usage?: AiUsageReport | null
): Promise<void> {
  const path = getEnv().BACKEND_AI_GENERATE_RESULT_PATH.replace(
    '{processDocumentId}',
    String(processDocumentId)
  )
  const url = `${backendUrl()}${path}`

  const payload: DocumentResultPayload = {
    status,
    prompts,
    error_message: errorMessage ?? null,
    usage: usage ?? null,
  }

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Backend POST ${path} failed: ${response.status} - ${body}`)
  }
}
