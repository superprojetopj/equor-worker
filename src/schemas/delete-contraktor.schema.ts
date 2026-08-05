import { z } from 'zod'

export const DeleteContraktorParamsSchema = z.object({
  contraktorId: z.coerce.number().int().positive(),
})

export type DeleteContraktorPayload = z.infer<typeof DeleteContraktorParamsSchema>
