import pino from 'pino'
import { getEnv } from '../config/env.js'
import { trackTask } from './shutdown.js'

const log = pino({ name: 'job-queue' })

type Job = { key: string; run: () => Promise<void> }

const active = new Set<string>()
const waiting: Job[] = []
let running = 0

/**
 * Enqueues a background job with a global concurrency cap and dedup by key:
 * a job whose key is already queued or running is ignored (returns false).
 * Jobs count toward the shutdown drain from the moment they are enqueued,
 * so queued work still completes on graceful shutdown.
 */
export function enqueueJob(key: string, run: () => Promise<void>): boolean {
  if (active.has(key)) {
    log.warn({ key }, 'Duplicate job ignored — already queued or running')
    return false
  }
  active.add(key)

  let release!: () => void
  trackTask(new Promise<void>((resolve) => (release = resolve)))

  waiting.push({
    key,
    run: async () => {
      try {
        await run()
      } catch (err) {
        log.error({ key, err }, 'Unhandled job error')
      } finally {
        active.delete(key)
        release()
      }
    },
  })
  pump()
  return true
}

function pump(): void {
  while (running < getEnv().MAX_CONCURRENT_JOBS && waiting.length > 0) {
    const job = waiting.shift()!
    running++
    void job.run().finally(() => {
      running--
      pump()
    })
  }
}
