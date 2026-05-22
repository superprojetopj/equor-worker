import { Storage, type Bucket } from '@google-cloud/storage'
import { getEnv } from '../config/env.js'
import type { ContextFileRef, ContextFile } from '../types/storage.types.js'

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
async function downloadFromGCS(gcsPath: string): Promise<string> {
  const download = getBucket().file(gcsPath).download()
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`GCS download timed out: ${gcsPath}`)), 60_000)
  )
  const [contents] = await Promise.race([download, timeout])
  return contents.toString('base64')
}

export async function uploadToGCS(gcsPath: string, buffer: Buffer): Promise<string> {
  const file = getBucket().file(gcsPath)
  await file.save(buffer, { contentType: 'application/pdf', resumable: false })
  return gcsPath
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
