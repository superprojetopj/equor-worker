import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import type {
  ContraktorAddPartyPayload,
  ContraktorAddPartyResponse,
  ContraktorAddParticipantPayload,
  ContraktorAddParticipantResponse,
  ContraktorAttachFileResponse,
  ContraktorCreateContractPayload,
  ContraktorCreateContractResponse,
  ContraktorCreateProofPayload,
  ContraktorCreateProofResponse,
  ContraktorShareLinkResponse,
  ContraktorUploadFileResponse,
} from '../types/contraktor.types.js'

function baseUrl(): string {
  return getEnv().CONTRAKTOR_API_URL.replace(/\/$/, '')
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${getEnv().CONTRAKTOR_API_TOKEN}` }
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeader(), 'Content-Type': 'application/json' }
}

export async function uploadFileToContraktor(
  buffer: Buffer,
  filename: string
): Promise<ContraktorUploadFileResponse> {
  const url = `${baseUrl()}/files`

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), filename)

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor POST /files failed: ${response.status} - ${body}`)
  }

  return (await response.json()) as ContraktorUploadFileResponse
}

export async function addPartyToContraktor(
  payload: ContraktorAddPartyPayload
): Promise<ContraktorAddPartyResponse> {
  const url = `${baseUrl()}/parties`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor POST /parties failed: ${response.status} - ${body}`)
  }

  return (await response.json()) as ContraktorAddPartyResponse
}

export async function attachFileToContract(
  contractId: number,
  fileId: number
): Promise<ContraktorAttachFileResponse> {
  const base = `${baseUrl()}/contracts/${contractId}/attachments`

  const attachResponse = await fetchWithRetry(base, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ attachment: { file_id: fileId } }),
  })

  if (!attachResponse.ok) {
    const body = await attachResponse.text()
    throw new Error(
      `Contraktor POST /contracts/${contractId}/attachments failed: ${attachResponse.status} - ${body}`
    )
  }

  const attached = (await attachResponse.json()) as ContraktorAttachFileResponse

  const mergeResponse = await fetchWithRetry(`${base}/${attached.data.id}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ attachment: { mergeable: true } }),
  })

  if (!mergeResponse.ok) {
    const body = await mergeResponse.text()
    throw new Error(
      `Contraktor PUT /contracts/${contractId}/attachments/${attached.data.id} failed: ${mergeResponse.status} - ${body}`
    )
  }

  return (await mergeResponse.json()) as ContraktorAttachFileResponse
}

export async function addParticipantToContract(
  contractId: number,
  payload: ContraktorAddParticipantPayload
): Promise<ContraktorAddParticipantResponse> {
  const url = `${baseUrl()}/contracts/${contractId}/shares`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Contraktor POST /contracts/${contractId}/shares failed: ${response.status} - ${body}`
    )
  }

  return (await response.json()) as ContraktorAddParticipantResponse
}

export async function getShareLink(
  proofId: number,
  subjectId: number
): Promise<ContraktorShareLinkResponse> {
  const url = `${baseUrl()}/proofs/${proofId}/subjects/${subjectId}/generate_sharelink`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: authHeader(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Contraktor GET /proofs/${proofId}/subjects/${subjectId}/generate_sharelink failed: ${response.status} - ${body}`
    )
  }

  return (await response.json()) as ContraktorShareLinkResponse
}

export async function dispatchForSignature(
  payload: ContraktorCreateProofPayload
): Promise<ContraktorCreateProofResponse> {
  const url = `${baseUrl()}/proofs`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor POST /proofs failed: ${response.status} - ${body}`)
  }

  return (await response.json()) as ContraktorCreateProofResponse
}

export async function createContraktorContract(
  payload: ContraktorCreateContractPayload
): Promise<ContraktorCreateContractResponse> {
  const url = `${baseUrl()}/contracts`

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor POST /contracts failed: ${response.status} - ${body}`)
  }

  return (await response.json()) as ContraktorCreateContractResponse
}
