import type { FastifyReply, FastifyRequest } from 'fastify'

let shuttingDown = false

export function isShuttingDown(): boolean {
  return shuttingDown
}

/**
 * Durante o encerramento, recusar é melhor que aceitar: 503 devolve a task à
 * fila, que reentrega quando a instância nova estiver de pé.
 */
export async function shutdownGuard(_: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (shuttingDown) reply.code(503).send({ error: 'Worker is shutting down' })
}

export function beginShutdown(): void {
  shuttingDown = true
}
