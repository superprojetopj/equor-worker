import { Storage, type Bucket } from '@google-cloud/storage'
import { getEnv } from '../config/env.js'

let _bucket: Bucket | null = null

function getBucket(): Bucket {
  if (!_bucket) {
    _bucket = new Storage().bucket(getEnv().GCS_BUCKET_NAME)
  }
  return _bucket
}

/**
 * Downloads a file from GCS into memory as base64.
 * No temp files — GC releases after processing.
 */
export async function downloadFromGCS(gcsPath: string): Promise<string> {
  const download = getBucket().file(gcsPath).download()
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`GCS download timed out: ${gcsPath}`)), 60_000)
  )
  const [contents] = await Promise.race([download, timeout])
  return contents.toString('base64')
}
