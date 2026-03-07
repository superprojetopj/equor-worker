let inFlight = 0
let shuttingDown = false
let drainResolve: (() => void) | null = null

export function isShuttingDown(): boolean {
  return shuttingDown
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
