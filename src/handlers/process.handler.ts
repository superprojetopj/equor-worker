import pino from 'pino'
import type { TaskPayload } from '../schemas/task.schema.js'
import type { ProcessDocumentData, ProcessMetadata, PromptResult } from '../types/backend.types.js'
import type { ContextFile } from '../types/claude.types.js'
import { fetchProcessData, reportDocumentResult } from '../services/backend.service.js'
import { callClaude } from '../services/claude.service.js'
import { downloadFromGCS } from '../services/storage.service.js'

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
  metadata: ProcessMetadata | undefined
): Promise<void> {
  const { process_document_id, prompts } = doc

  //await reportDocumentResult(process_document_id, 'PROCESSING')

  try {
    if (prompts.length === 0) {
      // await reportDocumentResult(process_document_id, 'COMPLETED')
      return
    }

    const contextFiles: ContextFile[] = [] //await downloadContextFiles(doc.context_files ?? [])
    const results: PromptResult[] = []

    for (const prompt of prompts) {
      const resultHtml = await callClaude({
        instruction: prompt.prompt,
        contextFiles,
        metadata,
      })
      results.push({ prompt_id: prompt.id, result_html: resultHtml })
    }

    await reportDocumentResult(process_document_id, 'COMPLETED', results)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ process_document_id, error: message }, 'Document processing failed')
    try {
      await reportDocumentResult(process_document_id, 'FAILED', [], message)
    } catch (reportError) {
      log.error(
        { process_document_id, originalError: message, reportError },
        'Failed to report error to backend'
      )
    }
  }
}

export async function processTask(payload: TaskPayload): Promise<void> {
  const { process: proc, metadata } = await fetchProcessData(payload.processId)

  await Promise.allSettled(proc.documents.map((doc) => resolveDocument(doc, metadata)))
}
