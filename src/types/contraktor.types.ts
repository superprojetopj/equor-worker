export interface ContraktorSignatory {
  name: string
  email: string
  cpf: string
  role?: string
}

interface ContraktorPartyBase {
  name: string
  birth_date?: string
  address_zip_code?: string
  address_street?: string
  address_number?: string
  address_neighborhood?: string
  address_complement?: string
  address_city?: string
  address_state?: string
  address_country?: string
  reference?: string
  phone?: string
  whatsappnum?: string
}

export interface ContraktorPartyPF extends ContraktorPartyBase {
  person_type: 'pf'
  email: string
  document?: string
  national_id?: string
  marital_status?: 'single' | 'married' | 'divorced' | 'widower'
  nationality?: string
  profession?: string
}

export interface ContraktorPartyPJ extends ContraktorPartyBase {
  person_type: 'pj'
  trade_name?: string
  document?: string
  contact_email?: string
  contact_name?: string
  contact_phone?: string
  state_subscription?: string
  city_subscription?: string
}

export type ContraktorParty = ContraktorPartyPF | ContraktorPartyPJ

export interface ContraktorAddPartyPayload {
  party: ContraktorParty
}

export interface ContraktorPartyData {
  id: number
  person_type: 'pf' | 'pj'
  name: string
  email: string | null
  document: string | null
  inserted_at: string
  updated_at: string
}

export interface ContraktorAddPartyResponse {
  data: ContraktorPartyData
}

export interface ContraktorListPartiesResponse {
  data: ContraktorPartyData[]
}

export interface ContraktorCreateContractPayload {
  contract: {
    title: string
    document: { file_id: number }
    workflow_id?: number
    metadata?: Record<string, string>
  }
}

export interface ContraktorContractData {
  id: number
  title: string
  number: string
  status: { id: number; name: string; color: number }
  inserted_at: string
  updated_at: string
}

export interface ContraktorCreateContractResponse {
  data: ContraktorContractData
}

export interface ContraktorFileData {
  id: number
  name: string
  mime: string
  size: number
  download_url: string
  preview_url: string
  google_file_id: string | null
  inserted_at: string
  updated_at: string
}

export interface ContraktorUploadFileResponse {
  data: ContraktorFileData
}

// ── Attachments ──

export interface ContraktorAttachmentData {
  id: number
  contract: { id: number }
  file: ContraktorFileData
  mergeable: boolean | null
  inserted_at: string
  updated_at: string
}

export interface ContraktorAttachFileResponse {
  data: ContraktorAttachmentData
}

// ── Sharings (participants linked to contract) ──

export interface ContraktorAddParticipantPayload {
  sharing: {
    qualification: string
    party_id: number
    company_id?: number
    notification_type: 'email' | 'whatsapp'
    redirect_after_success?: string
  }
}

export interface ContraktorSharingData {
  id: number
  contract: { id: number }
  party: ContraktorPartyData
  qualification: string
  notification_type: string
  order: number
  inserted_at: string
  updated_at: string
}

export interface ContraktorAddParticipantResponse {
  data: ContraktorSharingData
}

// ── Proof (dispatch for signature) ──

export interface ContraktorCreateProofPayload {
  proof: {
    contract_id: number
    engine: 'standard' | 'certificate'
    ordered?: boolean
  }
}

export interface ContraktorProofSubject {
  id: number
  name: string
  email: string
  document: string | null
  qualification: string
  notification_type: string
  order: number
  sent_at: string | null
  viewed_at: string | null
  confirmed_at: string | null
}

export interface ContraktorProofData {
  id: number
  status: string
  ordered: boolean | null
  subjects: ContraktorProofSubject[]
  inserted_at: string
  updated_at: string
}

export interface ContraktorCreateProofResponse {
  data: ContraktorProofData
}

// ── Share links ──

export interface ContraktorShareLinkResponse {
  data: {
    sharelink: string
  }
}
