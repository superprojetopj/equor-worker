import type { ProcessMetadata } from './backend.types.js'

export interface ContextFile {
  base64Data: string
  mediaType: string
  fileName?: string
}

export interface ClaudeRequest {
  instruction: string
  contextFiles: ContextFile[]
  metadata?: ProcessMetadata
}
