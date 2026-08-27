import type { FastifyReply, FastifyRequest } from 'fastify'
import { AiGeneratePayloadSchema } from '../schemas/ai-generate.schema.js'
import { runAiGenerate } from '../services/ai-generate.service.js'
import { runTask } from '../lib/task-route.js'

export async function aiGenerateHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = AiGeneratePayloadSchema.parse(request.body)

  // Sem retry da fila: cada execução é outra fatura pelo mesmo documento, e a
  // falha já foi reportada ao backend, que a mostra na tela.
  return runTask(reply, {
    key: `ai-generate:${payload.processDocumentId}`,
    run: () => runAiGenerate(payload),
    allowRetry: false,
  })
}
