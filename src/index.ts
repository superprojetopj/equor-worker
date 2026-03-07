import 'dotenv/config'
import { getEnv } from './config/env.js'
import { buildServer } from './server.js'
import { beginShutdown, waitForDrain } from './lib/shutdown.js'

async function main() {
  const { PORT } = getEnv()
  const app = await buildServer()

  await app.listen({ port: PORT, host: '0.0.0.0' })
  app.log.info(`Equor Worker listening on port ${PORT}`)

  async function onSignal(signal: string) {
    app.log.info(`Received ${signal}, shutting down gracefully…`)
    beginShutdown()
    await app.close()
    await waitForDrain(25_000)
    app.log.info('All tasks drained, exiting')
    process.exit(0)
  }

  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
