export interface ContextFile {
  base64Data: string
  mediaType: string
  fileName?: string
}

export interface ClaudeRequest {
  instruction: string
  htmlTemplate: string
  contextFiles: ContextFile[]
  metadata?: Record<string, unknown>
}
