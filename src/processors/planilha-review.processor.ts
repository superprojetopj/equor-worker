import path from 'path'
import { fetchPlanilhaReviewList, updatePlanilhaReview } from '../services/backend.service.js'
import { uploadFileToGemini, callGeminiWithFiles, countTokensForFiles, MAX_TOKENS } from '../services/gemini.service.js'
import { flowA, type FlowAResult } from './flows/flow-a.js'

const CONCURRENCY = 5

export interface ProcessorFlow {
  name: string
  prompt: string
  schema: object
  getFiles: (numero_processo: string) => Promise<string[]>
  /** Se definido, encadeia para o próximo flow quando a condição for verdadeira */
  next?: {
    flow: ProcessorFlow
    when: (result: unknown) => boolean
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const current = next++
      await fn(items[current], current)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

function buildPayload(allResults: Record<string, unknown>, numero_processo: string): Record<string, unknown> {
  const flowA = allResults['flow-a'] as FlowAResult
  const flowB = allResults['flow-b']

  const { fase_processual, analise_estrategica_copel, gestao_de_risco } = flowA
  const prelim = analise_estrategica_copel.preliminares_e_prejudiciais

  const json_result: unknown[] = [flowA]
  if (flowB) json_result.push(flowB)

  return {
    instancia: fase_processual.instancia,
    ultima_movimentacao: fase_processual.ultima_movimentacao,
    data_ultima_movimentacao: fase_processual.data_movimentacao,
    numero_processo,
    is_litispendencia: prelim.litispendencia.resultado_atual !== null,
    is_coisa_julgada: prelim.coisa_julgada.resultado_atual !== null,
    is_ilegitimidade: prelim.ilegitimidade.resultado_atual !== null,
    is_suspenso: fase_processual.suspensao.is_suspenso,
    has_recurso_revista: analise_estrategica_copel.recurso_revista.existe,
    urgency: gestao_de_risco.urgencia,
    json_result,
  }
}

async function runItem(
  entryFlow: ProcessorFlow,
  item: { id: number; numero_processo: string },
  index: number,
  total: number
): Promise<void> {
  const { id, numero_processo } = item

  const allResults: Record<string, unknown> = {}
  let current: ProcessorFlow | undefined = entryFlow

  while (current) {
    const label = `[${current.name}][${index + 1}/${total}][${numero_processo}]`

    const filePaths = await current.getFiles(numero_processo)
    if (filePaths.length === 0) {
      console.warn(`${label} Nenhum arquivo encontrado — interrompendo encadeamento`)
      break
    }

    console.log(`${label} Enviando ${filePaths.length} arquivo(s): ${filePaths.map((p) => path.basename(p)).join(', ')}`)
    const fileRefs = await Promise.all(filePaths.map((p) => uploadFileToGemini(p)))

    // Valida tokens reais antes de chamar o Gemini
    const totalTokens = await countTokensForFiles(fileRefs, current.prompt)
    console.log(`${label} Tokens estimados: ${totalTokens.toLocaleString()} / ${MAX_TOKENS.toLocaleString()}`)
    if (totalTokens > MAX_TOKENS) {
      console.warn(`${label} Contexto excedido — registrando como pendente`)
      allResults[current.name] = {
        status: 'pendente_sem_contexto',
        erro: `Conteúdo ocupa ${totalTokens.toLocaleString()} tokens, acima do limite de ${MAX_TOKENS.toLocaleString()} do Gemini 1.5 Flash`,
      }
      break
    }

    console.log(`${label} Chamando Gemini...`)
    const result = await callGeminiWithFiles(fileRefs, current.prompt, current.schema)
    allResults[current.name] = { ...(result as Record<string, unknown>), count_tokens: totalTokens }
    console.log(`${label} Gemini respondeu`)

    if (current.next && current.next.when(result)) {
      console.log(`${label} Encadeando para "${current.next.flow.name}"...`)
      current = current.next.flow
    } else {
      current = undefined
    }
  }

  if (Object.keys(allResults).length === 0) {
    console.warn(`[${entryFlow.name}][${index + 1}/${total}][${numero_processo}] Nenhum resultado — pulando atualização do backend`)
    return
  }

  const payload = buildPayload(allResults, numero_processo)
  await updatePlanilhaReview(id, payload)
  console.log(`[${entryFlow.name}][${index + 1}/${total}][${numero_processo}] Salvo no backend (flows: ${Object.keys(allResults).join(', ')})`)
}

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
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${flow.name}] ERRO ${item.numero_processo} (id=${item.id}): ${msg}`)
    }
    console.log(`[${flow.name}] ${done + failed}/${items.length} (ok=${done} err=${failed})`)
  })

  console.log(`[${flow.name}] Concluído — ok=${done} err=${failed} total=${items.length}`)
}

export async function runPlanilhaReviewProcessor(): Promise<void> {
  console.log('[PlanilhaReview] Iniciando fluxo a partir de flow-a...')

  const items = await fetchPlanilhaReviewList()
  console.log(`[PlanilhaReview] ${items.length} processos encontrados`)
  console.log(items)

  if (items.length === 0) return

  await runFlow(flowA, items)

  console.log('[PlanilhaReview] Concluído')
}
