export interface ContextFileRef {
  gcs_path: string
  file_name: string
  media_type: string
}

export interface ProcessDocumentData {
  process_document_id: number
  html_template: string
  context_files: ContextFileRef[]
}

export interface ProcessData {
  id: number
  process_number: string
  documents: ProcessDocumentData[]
}

export interface BackendProcessResponse {
  process: ProcessData
  metadata?: Record<string, unknown>
}

export type DocumentStatus = 'processing' | 'completed' | 'failed'

export interface DocumentResultPayload {
  status: DocumentStatus
  result_html: string | null
  error_message: string | null
}
