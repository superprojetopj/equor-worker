import pino from 'pino'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { getEnv } from '../config/env.js'

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function createLogger(): pino.Logger {
  const { LOG_FILE, LOG_LEVEL } = getEnv()
  ensureDir(LOG_FILE)

  return pino(
    { level: LOG_LEVEL },
    pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination(LOG_FILE) },
    ])
  )
}
