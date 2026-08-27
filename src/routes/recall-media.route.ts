import type { FastifyInstance } from 'fastify'
import {
  recallTranscriptHandler,
  recallVideoHandler,
} from '../handlers/recall-media.handler.js'
import { verifyAuth } from '../middleware/auth.middleware.js'
import { shutdownGuard } from '../lib/shutdown.js'

/**
 * Duas rotas para dois eventos do Recall.
 *
 * `recording.done` manda o vídeo andar; `transcript.done`, minutos depois,
 * manda a transcrição. Rotas separadas porque as chaves de fila precisam ser
 * separadas: com uma chave só, o segundo evento chegando durante o primeiro
 * job era descartado como duplicado.
 */
export async function recallMediaRoutes(app: FastifyInstance) {
  app.post('/recall-video', {
    preHandler: [shutdownGuard, verifyAuth],
    handler: recallVideoHandler,
  })

  app.post('/recall-transcript', {
    preHandler: [shutdownGuard, verifyAuth],
    handler: recallTranscriptHandler,
  })
}
