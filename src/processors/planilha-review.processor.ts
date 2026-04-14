import path from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fetchPlanilhaReviewList, updatePlanilhaReview } from '../services/backend.service.js'
import {
  uploadFileToGemini,
  callGeminiWithFiles,
  countTokensForFiles,
  GeminiTokenLimitError,
  type GeminiFileRef,
} from '../services/gemini.service.js'
import { flowMateria, type FlowMateriaResult } from './flows/flow-materia.js'
import {
  flowResumo,
  type FlowResumoGeminiResult,
  type FlowResumoPartsRunResult,
  type FlowResumoResult,
} from './flows/flow-resumo.js'
import { FlowMetadataResult } from './flows/flow-consolidacao.js'

const CONCURRENCY = 3

// -----------------------
// ProcessorFlow interface
// -----------------------
export interface ProcessorFlow {
  name: string
  prompt: string
  schema: object
  /** Returns partitioned file paths used as fallback when getFiles hits the token limit. */
  getFiles?: (numero_processo: string) => Promise<string[]>
  /** Returns the prompt for part N (index > 0), incorporating the accumulated result so far. */
  getIncrementalPrompt?: (
    previousResult: unknown,
    partIndex: number,
    totalParts: number,
    fileName?: string
  ) => string
  getConsolidacaoPrompt?: (previousResult: unknown) => string
  /** Chains to the next flow when the condition is true. */
  next?: {
    flow: ProcessorFlow
    when: (result: unknown) => boolean
  }
}

// ----------------
// Concurrency pool
// ----------------
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

// ----------------------
// Sequential part runner
// ----------------------

/** Primeira parte: sempre o prompt base. Demais: prompt incremental se o flow definir. */
function promptForPart(
  flow: ProcessorFlow,
  partIndex: number,
  totalParts: number,
  previousResult: unknown,
  fileName: string
): string {
  if (partIndex === 0 || !flow.getIncrementalPrompt) {
    return flow.prompt
  }
  return flow.getIncrementalPrompt(previousResult, partIndex, totalParts, fileName)
}

async function runParts(
  flow: ProcessorFlow,
  fileRefs: GeminiFileRef[],
  filePaths: string[],
  label: string
): Promise<FlowResumoPartsRunResult> {
  if (fileRefs.length === 0) {
    throw new Error('runParts: fileRefs must not be empty')
  }

  let result: FlowResumoGeminiResult | null = null
  let totalTokens = 0

  for (let i = 0; i < fileRefs.length; i++) {
    const fileName = path.basename(filePaths[i])
    const prompt = promptForPart(flow, i, fileRefs.length, result, fileName)

    console.log(`${label} [${i + 1}/${fileRefs.length}] ${fileName} — chamando Gemini...`)
    result = (await callGeminiWithFiles(
      [fileRefs[i]],
      prompt,
      flow.schema
    )) as FlowResumoGeminiResult

    const debugDir = 'logs/gemini-debug'
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const debugPath = path.join(debugDir, `${flow.name}_part${i + 1}_${ts}.txt`)
    writeFileSync(
      debugPath,
      `=== PROMPT ===\n${prompt}\n\n=== RESULT ===\n${JSON.stringify(result, null, 2)}\n`
    )

    const tokens = await countTokensForFiles([fileRefs[i]], prompt, flow.schema)
    totalTokens += tokens
    console.log(
      `${label} [${i + 1}/${fileRefs.length}] ${fileName} — ${tokens.toLocaleString()} tokens`
    )
  }

  if (result === null) {
    throw new Error('runParts: expected Gemini result after processing parts')
  }

  return { result, totalTokens }
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

function buildPayload(
  allResults: Record<string, unknown>,
  numero_processo: string
): Record<string, unknown> {
  const resultResumo = allResults['flow-resumo'] as FlowResumoResult | undefined
  const resultConsolidacao = allResults['flow-consolidacao'] as FlowMetadataResult | undefined

  if (!resultResumo) {
    console.warn(`[${numero_processo}] Nenhum resultado disponível`)
    return {}
  }

  const json_result: unknown[] = []
  if (resultResumo) json_result.push(resultResumo)
  if (resultConsolidacao) json_result.push(resultConsolidacao)

  return {
    numero_processo,
    resumo: resultResumo.resumo,
    is_litispendencia: resultConsolidacao?.metadata.litispendencia ?? null,
    is_coisa_julgada: resultConsolidacao?.metadata.coisa_julgada ?? null,
    is_ilegitimidade: resultConsolidacao?.metadata.ilegitimidade ?? null,
    is_prescricao: resultConsolidacao?.metadata.prescricao ?? null,
    is_conflito_sindical: resultConsolidacao?.metadata.conflito_sindical ?? null,
    is_suspenso: resultConsolidacao?.metadata.suspenso ?? null,
    json_result,
  }
}

// ---------------------------------------------------------------------------
// Item runner
// ---------------------------------------------------------------------------

async function runItem(
  entryFlow: ProcessorFlow,
  item: { id: number; numero_processo: string },
  index: number,
  total: number
): Promise<void> {
  const { id, numero_processo } = item
  const allResults: Record<string, unknown> = {}
  let current: ProcessorFlow | undefined = entryFlow
  let previousResult: unknown = null

  while (current) {
    const label = `[${current.name}][${index + 1}/${total}][${numero_processo}]`
    let result: unknown
    let totalTokens: number | undefined

    if (current.getConsolidacaoPrompt) {
      // Consolidation flow — no files, uses previous result only
      const resolvedPrompt = current.getConsolidacaoPrompt?.(previousResult)
      console.log(`${label} Consolidação (sem arquivos, usando resultado anterior)`)
      result = await callGeminiWithFiles([], resolvedPrompt, current.schema)
      totalTokens = await countTokensForFiles([], resolvedPrompt, current.schema)
      console.log(`${label} Consolidação concluída (${totalTokens?.toLocaleString()} tokens)`)
    } else {
      
      // Regular flow — files, uses current prompt
      const filePaths = await current.getFiles!(numero_processo)
      if (filePaths.length === 0) {
        console.warn(`${label} Nenhum arquivo encontrado — interrompendo encadeamento`)
        break
      }
      const partRefs = await Promise.all(filePaths.map((p) => uploadFileToGemini(p)))

      if (partRefs.length > 7) {
        console.log(`${label} ${partRefs.length} partes — indo direto para resumo incremental`)
        ;({ result, totalTokens } = await runParts(current, partRefs, filePaths, label))
      } else {
        console.log(
          `${label} Tentando ${partRefs.length} parte(s) em chamada única: ${filePaths.map((p) => path.basename(p)).join(', ')}`
        )
        try {
          result = await callGeminiWithFiles(partRefs, current.prompt, current.schema)
          totalTokens = await countTokensForFiles(partRefs, current.prompt, current.schema)
          console.log(`${label} Concluído (${totalTokens.toLocaleString()} tokens)`)
        } catch (err) {
          if (!(err instanceof GeminiTokenLimitError)) throw err
          console.warn(`${label} Token limit na chamada única — usando resumo incremental...`)
          ;({ result, totalTokens } = await runParts(current, partRefs, filePaths, label))
        }
      }
    }

    allResults[current.name] = { ...(result as Record<string, unknown>), count_tokens: totalTokens ?? 0 }
    previousResult = result

    if (current.next?.when(result)) {
      console.log(`${label} Encadeando para "${current.next.flow.name}"...`)
      current = current.next.flow
    } else {
      current = undefined
    }
  }

  if (Object.keys(allResults).length === 0) {
    console.warn(
      `[${entryFlow.name}][${index + 1}/${total}][${numero_processo}] Nenhum resultado — pulando atualização`
    )
    return
  }

  const payload = buildPayload(allResults, numero_processo)
  await updatePlanilhaReview(id, payload)
  console.log(
    `[${entryFlow.name}][${index + 1}/${total}][${numero_processo}] Salvo (flows: ${Object.keys(allResults).join(', ')})`
  )
}

// ---------------------------------------------------------------------------
// Flow runner
// ---------------------------------------------------------------------------

async function runFlow(
  flow: ProcessorFlow,
  items: { id: number; numero_processo: string }[]
): Promise<void> {
  console.log(`[${flow.name}] Iniciando — ${items.length} processos, concorrência ${CONCURRENCY}`)
  let done = 0
  let failed = 0

  await runWithConcurrency(items, CONCURRENCY, async (item, index) => {
    try {
      await runItem(flow, item, index, items.length)
      done++
    } catch (err) {
      failed++
      console.error(
        `[${flow.name}] ERRO ${item.numero_processo} (id=${item.id}): ${err instanceof Error ? err.message : String(err)}`
      )
    }
    console.log(`[${flow.name}] ${done + failed}/${items.length} (ok=${done} err=${failed})`)
  })

  console.log(`[${flow.name}] Concluído — ok=${done} err=${failed} total=${items.length}`)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runPlanilhaReviewProcessor(): Promise<void> {
  const items = await fetchPlanilhaReviewList()
  console.log(`[PlanilhaReview] ${items.length} processos encontrados`)
  console.log(items)

  if (items.length === 0) return

  await runFlow(flowResumo, items)
  // await runFlow(flowMateria, items)

  console.log('[PlanilhaReview] Concluído')
}
