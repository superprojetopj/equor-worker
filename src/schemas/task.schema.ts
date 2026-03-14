import { z } from 'zod'

export const TaskPayloadSchema = z.object({
  taskId: z.number().int(),
  processId: z.number().int(),
})

export type TaskPayload = z.infer<typeof TaskPayloadSchema>
