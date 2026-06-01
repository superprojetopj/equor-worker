// ── Backend PHP response types (matches real API) ──

export interface Endereco {
  zip_code: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city_name: string
  state: string
}

export interface Cnae {
  subclasse: string
  denominacao: string
}

export interface Socio {
  cpf: string
  nome: string
  email: string
  phone: string
  whatsapp: string
  role: string
  profissao: string
  legal_representative: boolean
  is_signatory: boolean
  is_witness: boolean
  is_consultant: boolean
  is_reviewer: boolean
  endereco?: Endereco
  [key: string]: unknown
}

export interface Empresa {
  cnpj: string
  razao_social: string
  phone: string
  whatsapp: string
  email: string
  cnae_principal: Cnae | null
  cnaes_secundarios: Cnae[]
  endereco: Endereco
  socios: Socio[]
  [key: string]: unknown
}

export interface ProcessoInfo {
  process_number: string
  title?: string
  objeto_do_contrato?: string
  valores_e_multas?: string
  date_start?: string | null
  date_end?: string | null
}

export interface ProcessMetadata {
  processo?: ProcessoInfo
  contratantes?: Empresa[]
  contratadas?: Empresa[]
  [key: string]: unknown
}

// ── Document / Process ──

import type { ContextFileRef } from './storage.types.js'
export type { ContextFileRef }

export interface PromptItem {
  id: string
  prompt: string
}

export interface ProcessDocumentData {
  process_document_id: number
  html_template?: string
  prompts: PromptItem[]
  custom_prompt?: string | null
  context_files: ContextFileRef[]
}

export interface BackendProcessDocumentResponse {
  document: ProcessDocumentData
  metadata: ProcessMetadata
}

// ── Report back to backend ──

export type DocumentStatus = 'PROCESSING' | 'GENERATED' | 'FAILED'

export interface PromptResult {
  prompt_id: string
  result_html: string
}

export interface DocumentResultPayload {
  status: DocumentStatus
  prompts: PromptResult[]
  error_message: string | null
}

// ── Sign Task Data ──

export type SignaturePartyType = 'Contratante' | 'Contratada'

export interface Signature {
  name: string
  cpf: string
  email: string
  party_type: SignaturePartyType
}

export interface SignDocument {
  id: number
  title: string
  process_number: string
  html_content: string
}

export interface BackendSignDocumentResponse {
  document: SignDocument
  signatures: Signature[]
}

export interface SignatoryResult {
  name: string
  email: string
  share_link: string
}

export interface SignTaskResultPayload {
  status: DocumentStatus
  contraktor_contract_id?: string
  gcs_path?: string
  signatories?: SignatoryResult[]
  error_message: string | null
}
