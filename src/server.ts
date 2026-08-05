import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { createLogger } from './lib/logger.js'
import { aiRoutes } from './routes/ai-generate.route.js'
import { signRoutes } from './routes/signature.route.js'
import { deleteContraktorRoutes } from './routes/delete-contraktor.route.js'

export async function buildServer() {
  const logger = createLogger()
  const app = Fastify({ loggerInstance: logger })

  // No CORS plugin on purpose: every caller is server-side (PHP backend via
  // Cloud Tasks) and ignores CORS. Auth is the x-worker-key header, never a
  // cookie, so no browser page has ambient credentials to ride on either —
  // allowlisting origins here would be dead config, not protection.

  await app.register(sensible)
  await app.register(aiRoutes)
  await app.register(signRoutes)
  await app.register(deleteContraktorRoutes)

  return app
}
