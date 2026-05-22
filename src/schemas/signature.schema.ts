import { z } from 'zod'

export const SignTaskParamsSchema = z.object({
  processDocumentId: z.coerce.number().int(),
})

export type SignTaskPayload = z.infer<typeof SignTaskParamsSchema>
