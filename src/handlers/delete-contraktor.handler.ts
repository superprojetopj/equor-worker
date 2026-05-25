import type { FastifyReply, FastifyRequest } from 'fastify'
import { deleteContraktorContract } from '../services/contraktor.service.js'
import { DeleteContraktorParamsSchema } from '../schemas/delete-contraktor.schema.js'

export async function deleteContraktorHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { contraktorId } = DeleteContraktorParamsSchema.parse(request.body)

  await deleteContraktorContract(contraktorId)

  reply.code(200).send({ status: 'deleted', contraktorId })
}
