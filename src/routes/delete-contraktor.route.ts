import type { FastifyInstance } from 'fastify'
import { deleteContraktorHandler } from '../handlers/delete-contraktor.handler.js'
import { verifyAuth } from '../middleware/auth.middleware.js'
import { shutdownGuard } from '../lib/shutdown.js'

export async function deleteContraktorRoutes(app: FastifyInstance) {
  app.post('/delete-contraktor', {
    preHandler: [shutdownGuard, verifyAuth],
    handler: deleteContraktorHandler,
  })
}
