export interface ContextFileRef {
  gcs_path: string
  file_name: string
  media_type: string
}

export interface ContextFile {
  base64Data: string
  mediaType: string
  fileName?: string
}
