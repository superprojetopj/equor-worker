import type { FastifyRequest, FastifyReply } from 'fastify'
import { getEnv } from '../config/env.js'

export async function verifyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { WORKER_SECRET } = getEnv()

  const key = request.headers['x-worker-key']
  if (key !== WORKER_SECRET) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}
