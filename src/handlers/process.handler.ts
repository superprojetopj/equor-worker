import pino from 'pino'
import type { TaskPayload } from '../schemas/task.schema.js'
import type { ProcessDocumentData, ContextFile } from '../types/index.js'
import { fetchProcessData, reportDocumentResult } from '../services/backend.service.js'
import { callClaude } from '../services/claude.service.js'
import { downloadFromGCS } from '../services/storage.service.js'
import { extractPromptPlaceholders, replacePlaceholder, replaceVariables } from '../lib/html-parser.js'

const log = pino({ name: 'process-handler' })

async function downloadContextFiles(
  files: ProcessDocumentData['context_files']
): Promise<ContextFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      base64Data: await downloadFromGCS(f.gcs_path),
      mediaType: f.media_type,
      fileName: f.file_name,
    }))
  )
}

async function resolveDocument(
  doc: ProcessDocumentData,
  metadata: Record<string, unknown> | undefined
): Promise<void> {
  const { process_document_id } = doc

  await reportDocumentResult(process_document_id, 'processing')

  try {
    let html = metadata ? replaceVariables(doc.html_template, metadata) : doc.html_template

    const placeholders = extractPromptPlaceholders(html)

    if (placeholders.length === 0) {
      await reportDocumentResult(process_document_id, 'completed', html)
      return
    }

    const contextFiles = await downloadContextFiles(doc.context_files ?? [])

    for (const placeholder of placeholders) {
      const result = await callClaude({
        instruction: placeholder.instruction,
        htmlTemplate: html,
        contextFiles,
        metadata,
      })
      html = replacePlaceholder(html, placeholder, result)
    }

    await reportDocumentResult(process_document_id, 'completed', html)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await reportDocumentResult(process_document_id, 'failed', undefined, message)
    } catch (reportError) {
      log.error(
        { process_document_id, originalError: message, reportError },
        'Failed to report document error to backend'
      )
    }
  }
}

export async function processTask(payload: TaskPayload): Promise<void> {
  const { process: proc, metadata } = await fetchProcessData(payload.processId)

  await Promise.allSettled(
    proc.documents.map((doc) => resolveDocument(doc, metadata))
  )
}
