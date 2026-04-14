
import type { ProcessorFlow } from '../planilha-review.processor.js'
import { FlowResumoGeminiResult } from './flow-resumo.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const BASE_PROMPT = `
## Persona:
Você é um Analista Jurídico Sênior especializado em execuções trabalhistas e auditoria de passivos. Sua tarefa é consolidar o resultado HTML em atributos metadados do JSON.

## RESTRIÇÕES:
- Retorne EXCLUSIVAMENTE um objeto JSON.

## SAÍDA:
{
  "metadados": {
    "litispendencia": "TRUE se Arguido em X, FALSE se Não identificada.",
    "coisa_julgada": "TRUE se Arguida em X, FALSE se Não identificada.",
    "ilegitimidade": "TRUE se Arguida em X, FALSE se Não identificada.",
    "prescricao": "Tipo: Bienal/Quinquenal | Resumo do argumento",
    "conflito_sindical": "TRUE se divergência encontrada, FALSE se não encontrada.",
    "suspenso": "TRUE se suspenso, FALSE se não suspenso.",
  }
}
`.trim()

function buildPrompt(resumo: string): string {
  return `${BASE_PROMPT}\n\n## RESUMO CONSOLIDADO:\n${resumo}`
}

// ---------------------------------------------------------------------------
// Schema Gemini
// ---------------------------------------------------------------------------

const schema = {
  type: 'OBJECT',
  required: ['metadata'],
  properties: {
    metadata: {
      type: 'OBJECT',
      required: ['litispendencia', 'coisa_julgada', 'ilegitimidade', 'prescricao', 'conflito_sindical', 'suspenso'],
      properties: {
        litispendencia: {
          type: 'boolean',
          description: 'TRUE se Arguida em X, FALSE se Não identificada.',
        },
        coisa_julgada: {
          type: 'boolean',
          description: 'TRUE se Arguida em X, FALSE se Não identificada.',
        },
        ilegitimidade: {
          type: 'boolean',
          description: 'TRUE se Arguida em X, FALSE se Não identificada.',
        },
        prescricao: {
          type: 'boolean',
          description: 'TRUE se Arguida em X, FALSE se Não identificada.',
        },
        conflito_sindical: {
          type: 'boolean',
          description: 'TRUE se divergência encontrada, FALSE se não encontrada.',
        },
        suspenso: {
          type: 'boolean',
          description: 'TRUE se suspenso, FALSE se não suspenso.',
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** JSON parseado do Gemini (schema flow-resumo), antes de anexar count_tokens */
export type FlowMetadataGeminiResult = {
  metadata: {
    litispendencia: boolean
    coisa_julgada: boolean
    ilegitimidade: boolean
    prescricao: boolean
    conflito_sindical: boolean
    suspenso: boolean
  }
}

export type FlowMetadataResult = FlowMetadataGeminiResult & {
  /** Added at runtime by the processor — not part of the Gemini schema */
  count_tokens: number
}

/** Retorno de runParts quando o flow é flow-resumo (partes sequenciais do PDF) */
export type FlowResumoPartsRunResult = {
  result: FlowResumoGeminiResult
  totalTokens: number
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export const flowConsolidacao: ProcessorFlow = {
  name: 'flow-consolidacao',
  prompt: BASE_PROMPT,
  schema,
  getConsolidacaoPrompt: (previousResult: unknown) =>
    buildPrompt((previousResult as FlowResumoGeminiResult | null)?.resumo ?? ''),
}
