import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { createLogger } from './lib/logger.js'
import { aiRoutes } from './routes/ai-generate.route.js'
import { signRoutes } from './routes/signature.route.js'
import { deleteContraktorRoutes } from './routes/delete-contraktor.route.js'
import { recallMediaRoutes } from './routes/recall-media.route.js'

export async function buildServer() {
  const logger = createLogger()

  // Sem corte por tempo do lado do Node: as rotas de task seguram a conexão
  // pelo tempo do trabalho (uma transferência de vídeo passa de dez minutos), e
  // quem decide o prazo é o dispatch_deadline da própria task, no Cloud Tasks.
  // Um requestTimeout aqui cortaria o job sem ninguém saber por quê.
  const app = Fastify({
    loggerInstance: logger,
    connectionTimeout: 0,
    requestTimeout: 0,
    keepAliveTimeout: 72_000,
  })

  // No CORS plugin on purpose: every caller is server-side (PHP backend via
  // Cloud Tasks) and ignores CORS. Auth is the x-worker-key header, never a
  // cookie, so no browser page has ambient credentials to ride on either —
  // allowlisting origins here would be dead config, not protection.

  await app.register(sensible)
  await app.register(aiRoutes)
  await app.register(signRoutes)
  await app.register(deleteContraktorRoutes)
  await app.register(recallMediaRoutes)

  return app
}
