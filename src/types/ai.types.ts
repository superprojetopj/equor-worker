import type { ProcessMetadata } from './backend.types.js'
import type { ContextFile } from './storage.types.js'

export type { ContextFile }

export interface AIRequest {
  instruction: string
  contextFiles: ContextFile[]
  metadata: ProcessMetadata
}
