import Anthropic from '@anthropic-ai/sdk'
import pino from 'pino'
import { getEnv } from '../config/env.js'
import { stripMarkdownFences } from '../lib/ai-response.js'
import type { AIContentPart, AIProviderRequest, AIResult, AIUsage } from '../types/ai.types.js'

type Block = Anthropic.Messages.ContentBlockParam

const log = pino({ name: 'claude' })

// Modelos que rejeitam temperature/top_p/top_k com 400
const SAMPLING_PARAMS_REMOVED = /opus-4-[7-9]|sonnet-5|fable/

// USD por milhão de tokens; cache write = 1.25x input, cache read = 0.1x input
const MODEL_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 3, output: 15 },
}

function estimateCostUsd(model: string, usage: Anthropic.Messages.Usage): number | undefined {
  const prices = Object.entries(MODEL_PRICES_PER_MTOK).find(([prefix]) =>
    model.startsWith(prefix)
  )?.[1]
  if (!prices) return undefined

  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cost =
    (usage.input_tokens * prices.input +
      cacheWrite * prices.input * 1.25 +
      cacheRead * prices.input * 0.1 +
      usage.output_tokens * prices.output) /
    1_000_000

  return Number(cost.toFixed(6))
}

const IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY })
  }
  return _client
}

function partToBlock(part: AIContentPart): Block {
  if ('text' in part) {
    return { type: 'text', text: part.text }
  }

  const { mime_type, data } = part.inline_data

  if (mime_type === 'application/pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data,
      },
    }
  }

  if (IMAGE_MEDIA_TYPES.has(mime_type)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mime_type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data,
      },
    }
  }

  return {
    type: 'text',
    text: `[Arquivo de contexto: ${mime_type} — formato não suportado pelo Claude]`,
  }
}

function withCacheControl(block: Block): Block {
  if (block.type === 'text' || block.type === 'document' || block.type === 'image') {
    return { ...block, cache_control: { type: 'ephemeral' } }
  }
  return block
}

export async function callClaude(req: AIProviderRequest): Promise<AIResult> {
  const { content, systemInstruction, generationConfig = { maxOutputTokens: 16000 } } = req
  const maxTokens = (generationConfig.maxOutputTokens as number | undefined) ?? 16000
  const abort = AbortSignal.timeout(600_000)

  // Cache breakpoints: system prompt + everything up to the penultimate content
  // block (context files, metadata, skeleton). The last block is the per-call
  // instruction, so calls sharing the same document prefix hit the cache.
  const blocks = content.map((part, i) =>
    i === content.length - 2 ? withCacheControl(partToBlock(part)) : partToBlock(part)
  )

  const model = getEnv().CLAUDE_MODEL
  const response = await getClient().messages
    .stream(
      {
        model,
        max_tokens: maxTokens,
        ...(!SAMPLING_PARAMS_REMOVED.test(model) && {
          temperature: getEnv().CLAUDE_TEMPERATURE,
        }),
        ...(systemInstruction && {
          system: [
            {
              type: 'text' as const,
              text: systemInstruction,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
        }),
        messages: [{ role: 'user', content: blocks }],
      },
      { signal: abort }
    )
    .finalMessage()

  const aiUsage: AIUsage = {
    provider: 'claude',
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    estimatedCostUsd: estimateCostUsd(response.model, response.usage) ?? null,
  }
  log.info(aiUsage, 'Claude generation usage')

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude did not return text content')
  }

  return { text: stripMarkdownFences(textBlock.text), usage: aiUsage }
}

