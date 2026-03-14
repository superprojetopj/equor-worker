import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { createLogger } from './lib/logger.js'
import { taskRoutes } from './routes/task.route.js'

export async function buildServer() {
  const logger = createLogger()
  const app = Fastify({ loggerInstance: logger })

  await app.register(cors, {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
  await app.register(sensible)
  await app.register(taskRoutes)

  return app
}
