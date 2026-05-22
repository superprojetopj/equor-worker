import type { FastifyInstance } from 'fastify'
import { signHandler } from '../handlers/signature.handler.js'
import { verifyAuth } from '../middleware/auth.middleware.js'
import { shutdownGuard } from '../lib/shutdown.js'

export async function signRoutes(app: FastifyInstance) {
  app.post('/signature', {
    preHandler: [shutdownGuard, verifyAuth],
    handler: signHandler,
  })
}
