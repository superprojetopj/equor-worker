import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import { createLogger } from './lib/logger.js'
import { taskRoutes } from './routes/task.route.js'

export async function buildServer() {
  const logger = createLogger()
  const app = Fastify({ loggerInstance: logger })

  await app.register(sensible)
  await app.register(taskRoutes)

  return app
}
