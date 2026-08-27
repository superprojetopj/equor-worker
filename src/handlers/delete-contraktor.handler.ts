import pino from 'pino'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { deleteContraktorContract } from '../services/contraktor.service.js'
import { DeleteContraktorParamsSchema } from '../schemas/delete-contraktor.schema.js'
import { runTask } from '../lib/task-route.js'

const log = pino({ name: 'delete-contraktor' })

/** Limpeza no Contraktor. Idempotente, então a falha volta para a fila. */
async function runDeleteContraktor(contraktorId: number): Promise<void> {
  try {
    await deleteContraktorContract(contraktorId)
  } catch (error) {
    log.error({ contraktorId, error: String(error) }, 'delete-contraktor failed')
    throw error
  }
}

export async function deleteContraktorHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { contraktorId } = DeleteContraktorParamsSchema.parse(request.body)

  return runTask(reply, {
    key: `delete-contraktor:${contraktorId}`,
    run: () => runDeleteContraktor(contraktorId),
  })
}
