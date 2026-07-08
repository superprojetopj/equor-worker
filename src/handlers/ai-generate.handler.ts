import type { FastifyReply, FastifyRequest } from 'fastify'
import { AiGeneratePayloadSchema } from '../schemas/ai-generate.schema.js'
import { runAiGenerate } from '../services/ai-generate.service.js'
import { enqueueJob } from '../lib/job-queue.js'

export async function aiGenerateHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = AiGeneratePayloadSchema.parse(request.body)

  const accepted = enqueueJob(`ai-generate:${payload.processDocumentId}`, () =>
    runAiGenerate(payload)
  )

  reply.code(202).send({
    status: 'accepted',
    payload,
    ...(accepted ? {} : { duplicate: true }),
  })
}
