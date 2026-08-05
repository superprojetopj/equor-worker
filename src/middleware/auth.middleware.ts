import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'

import { getEnv } from '../config/env.js'

const FAIL_WINDOW_MS = 60_000
const FAIL_MAX = 20
const MAX_TRACKED_IPS = 10_000

/** Per-IP failed auth attempts within a rolling window (best-effort, in-memory). */
const authFailures = new Map<string, { count: number; resetAt: number }>()

function clientIp(request: FastifyRequest): string {
  return request.ip || 'unknown'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = authFailures.get(ip)
  if (!entry || now >= entry.resetAt) return false
  return entry.count >= FAIL_MAX
}

function recordAuthFailure(ip: string): void {
  const now = Date.now()
  const entry = authFailures.get(ip)
  if (!entry || now >= entry.resetAt) {
    pruneExpired(now)
    authFailures.set(ip, { count: 1, resetAt: now + FAIL_WINDOW_MS })
    return
  }
  entry.count += 1
}

/** Keeps the map from growing without bound when failures come from many IPs. */
function pruneExpired(now: number): void {
  if (authFailures.size < MAX_TRACKED_IPS) return
  for (const [ip, entry] of authFailures) {
    if (now >= entry.resetAt) authFailures.delete(ip)
  }
  // Still full of live entries (distributed flood): drop the oldest insertions.
  if (authFailures.size >= MAX_TRACKED_IPS) {
    for (const ip of authFailures.keys()) {
      authFailures.delete(ip)
      if (authFailures.size < MAX_TRACKED_IPS) break
    }
  }
}

/**
 * Constant-time comparison that always hashes the same number of bytes so
 * length differences do not short-circuit before timingSafeEqual.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  const len = Math.max(bufA.length, bufB.length)
  const paddedA = Buffer.alloc(len)
  const paddedB = Buffer.alloc(len)
  bufA.copy(paddedA)
  bufB.copy(paddedB)
  const lengthsMatch = bufA.length === bufB.length
  // timingSafeEqual requires equal-length buffers — both are `len` after padding
  return timingSafeEqual(paddedA, paddedB) && lengthsMatch
}

export async function verifyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = clientIp(request)

  if (isRateLimited(ip)) {
    return reply.code(429).send({ error: 'Too many failed auth attempts' })
  }

  const { WORKER_SECRET } = getEnv()
  const key = request.headers['x-worker-key']

  if (typeof key !== 'string' || !secureCompare(key, WORKER_SECRET)) {
    recordAuthFailure(ip)
    return reply.code(401).send({ error: 'Unauthorized' })
  }
}
