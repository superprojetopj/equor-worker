import Anthropic from '@anthropic-ai/sdk'
import { createRequire } from 'module'
const mammoth = createRequire(import.meta.url)('mammoth') as typeof import('mammoth')
import { getEnv } from '../config/env.js'
import type { ClaudeRequest, ContextFile } from '../types/claude.types.js'
import { systemPrompt } from '../prompts/system.prompt.js'
import { fillPlaceholdersPrompt } from '../prompts/fill-placeholders.prompt.js'

type Block = Anthropic.Messages.ContentBlockParam

const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const TEXT_MEDIA_TYPES = new Set([
  'text/plain',
  'text/html',
  'text/csv',
  'text/xml',
  'application/json',
  'application/xml',
])

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY })
  }
  return _client
}

async function fileToBlock(file: ContextFile): Promise<Block> {
  if (file.mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: file.base64Data,
      },
    }
  }

  if (TEXT_MEDIA_TYPES.has(file.mediaType) || file.mediaType.startsWith('text/')) {
    const text = Buffer.from(file.base64Data, 'base64').toString('utf-8')
    return { type: 'text', text }
  }

  if (file.mediaType === DOCX_MEDIA_TYPE) {
    const buffer = Buffer.from(file.base64Data, 'base64')
    const { value: text } = await mammoth.extractRawText({ buffer })
    const label = file.fileName ?? 'documento.docx'
    return { type: 'text', text: `[${label}]\n${text}` }
  }

  const label = file.fileName ?? file.mediaType
  return {
    type: 'text',
    text: `[Arquivo de contexto: ${label} — formato não suportado]`,
  }
}

async function buildUserContent(req: ClaudeRequest): Promise<Block[]> {
  const fileBlocks = await Promise.all(req.contextFiles.map(fileToBlock))

  const blocks: Block[] = [...fileBlocks]

  if (req.metadata) {
    blocks.push({
      type: 'text',
      text: `METADADOS:\n${JSON.stringify(req.metadata, null, 2)}`,
    })
  }

  blocks.push({
    type: 'text',
    text: req.instruction,
  })

  return blocks
}

export async function callClaude(req: ClaudeRequest): Promise<string> {
  const abort = AbortSignal.timeout(600_000)

  const response = await getClient().messages.create(
    {
      model: getEnv().CLAUDE_MODEL,
      max_tokens: 16000,
      system: `${systemPrompt}\n\n---\n\n${fillPlaceholdersPrompt}`,
      messages: [{ role: 'user', content: await buildUserContent(req) }],
    },
    { signal: abort }
  )

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude did not return text content')
  }

  return textBlock.text
}
