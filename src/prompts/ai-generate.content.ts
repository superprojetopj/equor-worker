import type { AIContentPart } from '../types/ai.types.js'
import type { ProcessMetadata, PromptItem } from '../types/backend.types.js'

// Documento inteiro = UM único prompt e quase nenhum texto fixo fora o marcador.
// Com vários prompts, cada um é uma seção — o conjunto compõe o documento.
const FULL_DOCUMENT_FIXED_TEXT_THRESHOLD = 200

export function isFullDocumentTemplate(
  skeleton: string | null | undefined,
  prompts: PromptItem[]
): boolean {
  if (!skeleton || prompts.length !== 1) {
    return false
  }
  const fixedText = skeleton.replaceAll(`[[${prompts[0].id}]]`, '')
  return fixedText.trim().length < FULL_DOCUMENT_FIXED_TEXT_THRESHOLD
}

const FULL_DOCUMENT_NOTE =
  'ATENÇÃO: este template praticamente não possui texto fixo — o conteúdo gerado constitui o DOCUMENTO INTEIRO. ' +
  'As regras de tamanho mínimo NÃO se aplicam: gere o conteúdo completo que cada prompt pede ' +
  '(documento completo com título, qualificação das partes, cláusulas numeradas e fecho, quando for o caso).'

/** Instruction for one prompt generated individually (fallback / no skeleton). */
export function buildPromptInstruction(
  prompt: PromptItem,
  skeleton: string | null | undefined,
  fullDocument: boolean
): string {
  const parts = [prompt.prompt]
  if (prompt.length) {
    parts.push(`Tamanho OBRIGATÓRIO do texto gerado: ${prompt.length}.`)
  }
  if (fullDocument) {
    parts.push(FULL_DOCUMENT_NOTE)
  } else if (skeleton) {
    parts.push(
      `O conteúdo gerado substituirá o marcador [[${prompt.id}]] no documento da tag <document_skeleton>. ` +
        'Dimensione o texto pelo contexto ao redor do marcador e não repita trechos fixos que já existem no documento.'
    )
  }
  return parts.join('\n\n')
}

/** Instruction for the compose call — all prompts generated in a single request. */
export function buildComposeInstruction(prompts: PromptItem[], fullDocument: boolean): string {
  const promptsXml = prompts
    .map((p) => {
      const lengthAttr = p.length ? ` tamanho="${p.length.replace(/"/g, '&quot;')}"` : ''
      return `<prompt id="${p.id}"${lengthAttr}>\n${p.prompt}\n</prompt>`
    })
    .join('\n')

  const scopeNote = fullDocument ? `\n\n${FULL_DOCUMENT_NOTE}` : ''

  return (
    'Gere o conteúdo de TODOS os prompts abaixo. Cada um substituirá o marcador [[id]] correspondente no esqueleto do documento. ' +
    `Retorne um bloco <prompt_result id="..."> para cada prompt, conforme as regras do sistema.${scopeNote}\n\n<prompts>\n${promptsXml}\n</prompts>`
  )
}

/**
 * Assembles the user-message content parts. Order matters for prompt caching:
 * the per-call instruction is last, so calls sharing the same document prefix
 * (files + metadata + skeleton) hit the cache.
 */
export function buildGenerationContent(
  fileParts: AIContentPart[],
  metadata: ProcessMetadata,
  skeleton: string | null | undefined,
  instruction: string
): AIContentPart[] {
  return [
    ...fileParts,
    {
      text: `<metadata role="structured-data">\n${JSON.stringify(metadata, null, 2)}\n</metadata>`,
    },
    ...(skeleton
      ? [{ text: `<document_skeleton role="reference-only">\n${skeleton}\n</document_skeleton>` }]
      : []),
    { text: `<instruction>\n${instruction}\n</instruction>` },
  ]
}
