import pino from 'pino'
import type { AiGeneratePayload } from '../schemas/ai-generate.schema.js'
import type {
  AiUsageReport,
  PromptItem,
  PromptResult,
  ProcessMetadata,
} from '../types/backend.types.js'
import type { AIContentPart, AIResult, AIUsage, ContextFile } from '../types/ai.types.js'
import type { AIProviderRequest } from '../types/ai.types.js'
import { fetchProcessDocumentData, reportAiGenerateResult } from './backend.service.js'
import { contextFileToPart } from './context.service.js'
import { getBase64ContextFiles } from './storage.service.js'
import { callClaude } from './claude.service.js'
import { callGemini } from './gemini.service.js'
import { parsePromptResults } from '../lib/ai-response.js'
import {
  aiGenerateSystemInstruction,
  composeDocumentSystemInstruction,
} from '../prompts/ai-generate.prompt.js'
import {
  buildComposeInstruction,
  buildGenerationContent,
  buildPromptInstruction,
  isFullDocumentTemplate,
} from '../prompts/ai-generate.content.js'
import { getEnv } from '../config/env.js'

const log = pino({ name: 'ai-generate' })

function callAI(req: AIProviderRequest): Promise<AIResult> {
  return getEnv().AI_PROVIDER === 'claude' ? callClaude(req) : callGemini(req)
}

function aggregateUsage(usages: AIUsage[]): AiUsageReport | null {
  if (usages.length === 0) {
    return null
  }

  const costs = usages
    .map((u) => u.estimatedCostUsd)
    .filter((cost): cost is number => cost !== null)

  return {
    provider: usages[0].provider,
    model: usages[0].model,
    ai_calls: usages.length,
    input_tokens: usages.reduce((sum, u) => sum + u.inputTokens, 0),
    output_tokens: usages.reduce((sum, u) => sum + u.outputTokens, 0),
    cache_write_tokens: usages.reduce((sum, u) => sum + u.cacheWriteTokens, 0),
    cache_read_tokens: usages.reduce((sum, u) => sum + u.cacheReadTokens, 0),
    estimated_cost_usd:
      costs.length > 0 ? Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(6)) : null,
  }
}

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

const COMPOSE_MAX_OUTPUT_TOKENS = 32000

async function composeAllPrompts(
  fileParts: AIContentPart[],
  skeleton: string,
  prompts: PromptItem[],
  metadata: ProcessMetadata,
  fullDocument: boolean
): Promise<{ results: Map<string, string>; usage: AIUsage }> {
  const instruction = buildComposeInstruction(prompts, fullDocument)
  const content = buildGenerationContent(fileParts, metadata, skeleton, instruction)
  const { text, usage } = await callAI({
    content,
    systemInstruction: composeDocumentSystemInstruction,
    generationConfig: { maxOutputTokens: COMPOSE_MAX_OUTPUT_TOKENS },
  })

  return { results: parsePromptResults(text), usage }
}

export async function runAiGenerate(payload: AiGeneratePayload): Promise<void> {
  const { processDocumentId } = payload
  const usages: AIUsage[] = []

  try {
    const { document, metadata } = await fetchProcessDocumentData(processDocumentId)
    const { prompts, context_files, skeleton } = document

    if (prompts.length === 0) {
      await reportAiGenerateResult(processDocumentId, 'GENERATED', [])
      return
    }

    const base64ContextFiles = await getBase64ContextFiles(context_files)
    assertFileSizes(base64ContextFiles)

    log.info(
      {
        processDocumentId,
        contextFiles: base64ContextFiles.map((f) => ({
          fileName: f.fileName,
          mediaType: f.mediaType,
          sizeKb: Math.round(Buffer.byteLength(f.base64Data, 'base64') / 1024),
        })),
      },
      'Context files loaded'
    )

    const fileParts = await Promise.all(base64ContextFiles.map(contextFileToPart))

    const results: PromptResult[] = []
    let pending = prompts
    const fullDocument = isFullDocumentTemplate(skeleton, prompts)

    if (skeleton) {
      try {
        const composed = await composeAllPrompts(fileParts, skeleton, prompts, metadata, fullDocument)
        usages.push(composed.usage)
        for (const prompt of prompts) {
          const result_html = composed.results.get(prompt.id)
          if (result_html !== undefined) {
            results.push({ prompt_id: prompt.id, result_html })
          }
        }
        pending = prompts.filter((p) => !composed.results.has(p.id))
        if (pending.length > 0) {
          log.warn(
            { processDocumentId, missing: pending.map((p) => p.id) },
            'Compose call missing prompt results — falling back per prompt'
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(
          { processDocumentId, error: message },
          'Compose call failed — falling back to per-prompt generation'
        )
      }
    }

    for (const prompt of pending) {
      const instruction = buildPromptInstruction(prompt, skeleton, fullDocument)
      const content = buildGenerationContent(fileParts, metadata, skeleton, instruction)
      const { text, usage } = await callAI({
        content,
        systemInstruction: aiGenerateSystemInstruction,
      })
      usages.push(usage)
      results.push({ prompt_id: prompt.id, result_html: text })
    }

    await reportAiGenerateResult(
      processDocumentId,
      'GENERATED',
      results,
      undefined,
      aggregateUsage(usages)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await reportAiGenerateResult(processDocumentId, 'FAILED', [], message, aggregateUsage(usages))
    } catch {
      // backend unreachable — nothing else to do
    }
  }
}
