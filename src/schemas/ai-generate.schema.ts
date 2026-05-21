import { z } from 'zod'

export const AiGeneratePayloadSchema = z.object({
  processDocumentId: z.number().int(),
})

export type AiGeneratePayload = z.infer<typeof AiGeneratePayloadSchema>
