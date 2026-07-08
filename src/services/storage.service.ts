import { Storage, type Bucket } from '@google-cloud/storage'
import { getEnv } from '../config/env.js'
import type { ContextFileRef, ContextFile } from '../types/storage.types.js'

let _bucket: Bucket | null = null

/**
 * Transient network errors that should be retried. These surface from the
 * Google auth/token fetch (undici) and from flaky connections to googleapis,
 * e.g. "Premature close" when an idle connection is dropped on Cloud Run.
 */
const TRANSIENT_ERROR_PATTERNS = [
  'premature close',
  'econnreset',
  'socket hang up',
  'epipe',
  'etimedout',
  'enetunreach',
  'enotfound',
  'eai_again',
  'und_err',
  'fetch failed',
  'network',
]

function isTransientError(err: unknown): boolean {
  const haystacks: string[] = []
  let current: unknown = err
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      haystacks.push(current.message)
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string') haystacks.push(code)
      current = (current as { cause?: unknown }).cause
    } else {
      haystacks.push(String(current))
      break
    }
  }
  const text = haystacks.join(' ').toLowerCase()
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

async function withRetry<T>(label: string, fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries || !isTransientError(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
    }
  }
  throw new Error(`unreachable retry state for ${label}`)
}

function getBucket(): Bucket {
  if (!_bucket) {
    _bucket = new Storage({
      retryOptions: {
        autoRetry: true,
        maxRetries: 3,
        retryableErrorFn: isTransientError,
      },
    }).bucket(getEnv().GCS_BUCKET_NAME)
  }
  return _bucket
}

/**
 * Downloads a file from GCS into memory as base64.
 * No temp files — GC releases after processing.
 */
async function downloadFromGCS(gcsPath: string): Promise<string> {
  return withRetry(`download ${gcsPath}`, async () => {
    const download = getBucket().file(gcsPath).download()
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`GCS download timed out: ${gcsPath}`)), 60_000)
    )
    const [contents] = await Promise.race([download, timeout])
    return contents.toString('base64')
  })
}

export async function uploadToGCS(gcsPath: string, buffer: Buffer): Promise<string> {
  return withRetry(`upload ${gcsPath}`, async () => {
    const file = getBucket().file(gcsPath)
    await file.save(buffer, { contentType: 'application/pdf', resumable: false })
    return gcsPath
  })
}

export async function getBase64ContextFiles(files: ContextFileRef[]): Promise<ContextFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      base64Data: await downloadFromGCS(f.gcs_path),
      mediaType: f.media_type,
      fileName: f.file_name,
    }))
  )
}
