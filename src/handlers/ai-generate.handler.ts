import pino from 'pino'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AiGeneratePayloadSchema } from '../schemas/ai-generate.schema.js'
import type { AiGeneratePayload } from '../schemas/ai-generate.schema.js'
import type { PromptResult, ProcessMetadata } from '../types/backend.types.js'
import type { ContextFile } from '../types/ai.types.js'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

function assertFileSizes(files: ContextFile[]): void {
  for (const file of files) {
    const bytes = Buffer.byteLength(file.base64Data, 'base64')
    if (bytes > MAX_FILE_SIZE) {
      const mb = (bytes / 1024 / 1024).toFixed(1)
      throw new Error(
        `File "${file.fileName ?? file.mediaType}" is ${mb}MB — exceeds the 20MB inline limit`
      )
    }
  }
}
import { fetchProcessDocumentData, reportAiGenerateResult } from '../services/backend.service.js'
import { callGemini, contextFileToPart, type GeminiPart } from '../services/gemini.service.js'
import { getBase64ContextFiles } from '../services/storage.service.js'
import { dispatch } from '../lib/shutdown.js'
import { systemPrompt } from '../prompts/system.prompt.js'
import { fillPlaceholdersPrompt } from '../prompts/fill-placeholders.prompt.js'

const log = pino({ name: 'ai-generate' })

const SYSTEM_INSTRUCTION = `${systemPrompt}\n\n---\n\n${fillPlaceholdersPrompt}`

function buildContent(
  fileParts: GeminiPart[],
  instruction: string,
  metadata: ProcessMetadata
): GeminiPart[] {
  return [
    ...fileParts,
    {
      text: `<metadata role="structured-data">\n${JSON.stringify(metadata, null, 2)}\n</metadata>`,
    },
    { text: `<instruction>\n${instruction}\n</instruction>` },
  ]
}

async function runAiGenerate(payload: AiGeneratePayload): Promise<void> {
  const { processDocumentId } = payload
  try {
    const { document, metadata } = await fetchProcessDocumentData(processDocumentId)
    const { prompts, context_files } = document

    if (prompts.length === 0) {
      await reportAiGenerateResult(processDocumentId, 'COMPLETED', [])
      return
    }

    const base64ContextFiles = await getBase64ContextFiles(context_files)
    assertFileSizes(base64ContextFiles)
    const fileParts = await Promise.all(base64ContextFiles.map(contextFileToPart))

    const results: PromptResult[] = []
    for (const prompt of prompts) {
      const content = buildContent(fileParts, prompt.prompt, metadata)
      const result_html = await callGemini({ content, systemInstruction: SYSTEM_INSTRUCTION })
      results.push({ prompt_id: prompt.id, result_html })
    }

    await reportAiGenerateResult(processDocumentId, 'COMPLETED', results)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ processDocumentId, error: message }, 'ai-generate failed')
    try {
      await reportAiGenerateResult(processDocumentId, 'FAILED', [], message)
    } catch (reportError) {
      log.error({ processDocumentId, reportError }, 'Failed to report FAILED status')
    }
  }
}

export async function aiGenerateHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = AiGeneratePayloadSchema.parse(request.body)

  reply.code(202).send({
    status: 'accepted',
    payload,
  })

  dispatch(runAiGenerate(payload), { payload })
}
