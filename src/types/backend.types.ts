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

export interface Empresa {
  cnpj: string
  razao_social: string
  phone: string
  whatsapp: string
  email: string
  cnae_principal: string | null
  cnaes_secundarios: string[]
  endereco: Endereco
  [key: string]: unknown
}

export interface Socio {
  contact_id: number
  company_id: number
  cpf: string
  nome: string
  email: string
  phone: string
  whatsapp: string
  role: string
  occupation: string
  [key: string]: unknown
}

export interface ProcessMetadata {
  contratantes?: Empresa[]
  contratadas?: Empresa[]
  socios?: Socio[]
  [key: string]: unknown
}

// ── Document / Process ──

export interface ContextFileRef {
  gcs_path: string
  file_name: string
  media_type: string
}

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

export interface ProcessData {
  id: number
  process_number: string
  documents: ProcessDocumentData[]
}

export interface BackendProcessResponse {
  process: ProcessData
  metadata?: ProcessMetadata
}

// ── Report back to backend ──

export type DocumentStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface PromptResult {
  prompt_id: string
  result_html: string
}

export interface DocumentResultPayload {
  status: DocumentStatus
  prompts: PromptResult[]
  error_message: string | null
}
