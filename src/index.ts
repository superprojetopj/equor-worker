import 'dotenv/config'
import { getEnv } from './config/env.js'
import { buildServer } from './server.js'
import { beginShutdown } from './lib/shutdown.js'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const env = getEnv()
  if (!env.WORKER_SECRET?.trim()) {
    throw new Error('WORKER_SECRET is required and must not be empty (check GCP env vars)')
  }
  const { PORT } = env
  const app = await buildServer()

  await app.listen({ port: PORT, host: '0.0.0.0' })
  app.log.info(`Equor Worker listening on port ${PORT}`)

  /**
   * As rotas agora seguram a requisição pelo tempo todo do trabalho, e uma
   * transferência de vídeo pode levar minutos. `app.close()` sozinho esperaria
   * por ela — e o orquestrador mataria o processo antes, no meio.
   *
   * Então a corrida: dá uma folga para o que é curto terminar e sai. O que for
   * cortado no meio não recebe 2xx, e o Cloud Tasks reentrega — é exatamente a
   * garantia que o ack no fim comprou.
   */
  async function onSignal(signal: string) {
    app.log.info(`Received ${signal}, shutting down gracefully…`)
    beginShutdown()

    await Promise.race([app.close(), delay(env.SHUTDOWN_GRACE_MS)])

    app.log.info('Shutdown grace elapsed, exiting')
    process.exit(0)
  }

  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
