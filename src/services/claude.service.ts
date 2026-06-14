import Anthropic from '@anthropic-ai/sdk'
import { getEnv } from '../config/env.js'
import { stripMarkdownFences } from '../lib/ai-response.js'
import type { AIContentPart, AIProviderRequest } from '../types/ai.types.js'

type Block = Anthropic.Messages.ContentBlockParam

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

export async function callClaude(req: AIProviderRequest): Promise<string> {
  const { content, systemInstruction, generationConfig = { maxOutputTokens: 16000 } } = req
  const maxTokens = (generationConfig.maxOutputTokens as number | undefined) ?? 16000
  const abort = AbortSignal.timeout(600_000)

  const response = await getClient().messages.create(
    {
      model: getEnv().CLAUDE_MODEL,
      max_tokens: maxTokens,
      ...(systemInstruction && { system: systemInstruction }),
      messages: [{ role: 'user', content: content.map(partToBlock) }],
    },
    { signal: abort }
  )

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude did not return text content')
  }

  return stripMarkdownFences(textBlock.text)
}

