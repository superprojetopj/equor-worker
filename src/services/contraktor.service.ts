import { getEnv } from '../config/env.js'
import { fetchWithRetry } from '../lib/http.js'
import {
  ContraktorAddPartyResponseSchema,
  ContraktorListPartiesResponseSchema,
  ContraktorAddParticipantResponseSchema,
  ContraktorAttachFileResponseSchema,
  ContraktorCreateContractResponseSchema,
  ContraktorCreateProofResponseSchema,
  ContraktorShareLinkResponseSchema,
  ContraktorUploadFileResponseSchema,
  type ContraktorAddPartyResponse,
  type ContraktorListPartiesResponse,
  type ContraktorAddParticipantResponse,
  type ContraktorAttachFileResponse,
  type ContraktorCreateContractResponse,
  type ContraktorCreateProofResponse,
  type ContraktorShareLinkResponse,
  type ContraktorUploadFileResponse,
} from '../schemas/contraktor.schema.js'
import type {
  ContraktorAddPartyPayload,
  ContraktorAddParticipantPayload,
  ContraktorCreateContractPayload,
  ContraktorCreateProofPayload,
} from '../types/contraktor.types.js'

function baseUrl(): string {
  return getEnv().CONTRAKTOR_API_URL.replace(/\/$/, '')
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${getEnv().CONTRAKTOR_API_TOKEN}` }
}

function jsonHeaders(): Record<string, string> {
  return {
    ...authHeader(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

function apiHeaders(): Record<string, string> {
  return { ...authHeader(), Accept: 'application/json' }
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
    headers: apiHeaders(),
    body: form,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor POST /files failed: ${response.status} - ${body}`)
  }

  return ContraktorUploadFileResponseSchema.parse(await response.json())
}

async function listContraktorParties(search: string): Promise<ContraktorListPartiesResponse> {
  const url = `${baseUrl()}/parties?search=${encodeURIComponent(search)}`

  const response = await fetchWithRetry(url, { method: 'GET', headers: jsonHeaders() })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor GET /parties failed: ${response.status} - ${body}`)
  }

  return ContraktorListPartiesResponseSchema.parse(await response.json())
}

async function updateContraktorParty(
  partyId: number,
  payload: ContraktorAddPartyPayload
): Promise<ContraktorAddPartyResponse> {
  const url = `${baseUrl()}/parties/${partyId}`

  const response = await fetchWithRetry(url, {
    method: 'PATCH',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor PATCH /parties/${partyId} failed: ${response.status} - ${body}`)
  }

  return ContraktorAddPartyResponseSchema.parse(await response.json())
}

export async function addPartyToContraktor(
  payload: ContraktorAddPartyPayload
): Promise<ContraktorAddPartyResponse> {
  const email = payload.party.person_type === 'pf' ? payload.party.email : undefined

  if (email) {
    const { data: parties } = await listContraktorParties(email)
    const existing = parties.find((p) => p.email === email)

    if (existing) {
      if (existing.name === payload.party.name) {
        return { data: existing }
      }
      return updateContraktorParty(existing.id, payload)
    }
  }

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

  return ContraktorAddPartyResponseSchema.parse(await response.json())
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

  const attached = ContraktorAttachFileResponseSchema.parse(await attachResponse.json())

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

  return ContraktorAttachFileResponseSchema.parse(await mergeResponse.json())
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

  return ContraktorAddParticipantResponseSchema.parse(await response.json())
}

export async function getShareLink(
  proofId: number,
  subjectId: number
): Promise<ContraktorShareLinkResponse> {
  const url = `${baseUrl()}/proofs/${proofId}/subjects/${subjectId}/generate_sharelink`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: apiHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Contraktor GET /proofs/${proofId}/subjects/${subjectId}/generate_sharelink failed: ${response.status} - ${body}`
    )
  }

  return ContraktorShareLinkResponseSchema.parse(await response.json())
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

  return ContraktorCreateProofResponseSchema.parse(await response.json())
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

  return ContraktorCreateContractResponseSchema.parse(await response.json())
}

export async function deleteContraktorContract(contractId: number): Promise<void> {
  const url = `${baseUrl()}/contracts/${contractId}`

  const response = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: apiHeaders(),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Contraktor DELETE /contracts/${contractId} failed: ${response.status} - ${body}`)
  }
}
