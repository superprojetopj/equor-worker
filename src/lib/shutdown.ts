import type { FastifyReply, FastifyRequest } from 'fastify'
import pino from 'pino'

const log = pino({ name: 'worker' })

let inFlight = 0
let shuttingDown = false
let drainResolve: (() => void) | null = null

export function isShuttingDown(): boolean {
  return shuttingDown
}

export async function shutdownGuard(_: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (shuttingDown) reply.code(503).send({ error: 'Worker is shutting down' })
}

export function dispatch(task: Promise<void>, context: Record<string, unknown> = {}): void {
  trackTask(task.catch((err) => log.error({ ...context, err }, 'Unhandled task error')))
}

export function beginShutdown(): void {
  shuttingDown = true
}

export function trackTask(promise: Promise<unknown>): void {
  inFlight++
  promise.finally(() => {
    inFlight--
    if (inFlight === 0 && drainResolve) {
      drainResolve()
      drainResolve = null
    }
  })
}

export function waitForDrain(timeoutMs: number): Promise<void> {
  if (inFlight === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    drainResolve = resolve
    setTimeout(resolve, timeoutMs)
  })
}
