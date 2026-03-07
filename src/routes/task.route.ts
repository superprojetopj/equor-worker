import type { FastifyInstance } from 'fastify'
import { TaskPayloadSchema } from '../schemas/task.schema.js'
import { processTask } from '../handlers/process.handler.js'
import { verifyAuth } from '../middleware/auth.middleware.js'
import { isShuttingDown, trackTask } from '../lib/shutdown.js'

export async function taskRoutes(app: FastifyInstance) {
  app.post('/task', {
    preHandler: verifyAuth,
    handler: async (request, reply) => {
      if (isShuttingDown()) {
        return reply.code(503).send({ error: 'Worker is shutting down' })
      }

      const payload = TaskPayloadSchema.parse(request.body)

      reply.code(202).send({
        status: 'accepted',
        taskId: payload.taskId,
      })

      const task = processTask(payload).catch((err) => {
        app.log.error(
          { taskId: payload.taskId, processId: payload.processId, err },
          'Failed to process task'
        )
      })

      trackTask(task)
    },
  })

  app.get('/health', async () => ({
    status: isShuttingDown() ? 'draining' : 'ok',
  }))
}
