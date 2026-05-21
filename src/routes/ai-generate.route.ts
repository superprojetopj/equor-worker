import type { FastifyInstance } from 'fastify'
import { aiGenerateHandler } from '../handlers/ai-generate.handler.js'
import { verifyAuth } from '../middleware/auth.middleware.js'
import { isShuttingDown, shutdownGuard } from '../lib/shutdown.js'

export async function taskRoutes(app: FastifyInstance) {
  app.post('/ai-generate', {
    preHandler: [shutdownGuard, verifyAuth],
    handler: aiGenerateHandler,
  })

  app.get('/health', async () => ({
    status: isShuttingDown() ? 'draining' : 'ok',
  }))
}
