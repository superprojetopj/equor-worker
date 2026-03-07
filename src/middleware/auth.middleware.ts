import type { FastifyRequest, FastifyReply } from 'fastify'
import { getEnv } from '../config/env.js'

export async function verifyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { NODE_ENV, WORKER_SECRET } = getEnv()

  if (NODE_ENV === 'production') {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    // TODO: validate Google OIDC JWT
  } else {
    const secret = request.headers['x-worker-secret']
    if (secret !== WORKER_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  }
}
