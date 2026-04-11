import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { ProcessorFlow } from '../planilha-review.processor.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const FLOW_RESUMO_PROMPT = `
Você é um Especialista em Auditoria Jurídica Trabalhista Sênior. Sua tarefa é analisar o texto dos autos fornecidos (referentes a um cumprimento de sentença) e extrair informações cruciais para um relatório de auditoria.

INSTRUÇÕES DE ANÁLISE:
Identificação: 
Número do processo (formato CNJ).
Objeto da ação original.
Instância atual.
Última movimentação relevante e significativa (ignore despachos de mero expediente).

Análise Técnica:
Preliminares: Você DEVE listar as três preliminares abaixo, indicando se foram ou não arguídas. Se não houver menção ou argumentação nos autos, escreva "Não identificado nos documentos fornecidos":
Litispendência:
Coisa Julgada:
Ilegitimidade:
Conflito entre sindicatos: Informe se foi identificado conflito de representação sindical.
Tipo de Ação: Classifique como ação individual ou coletiva.
Prescrição: Identifique se há argumento de prescrição (especificando o tipo, se houver).
Matéria central do processo: Defina a matéria (ex: horas extras, verbas rescisórias, auxílio-alimentação, etc.).

Restrição: Seja estritamente factual. Baseie-se apenas nos documentos fornecidos.

FORMATO DE SAÍDA:
Retorne EXCLUSIVAMENTE um objeto JSON no formato: {"resumo": "conteúdo_html"}.
O "conteúdo_html" deve conter as informações organizadas em tags <h3>, <ul> e <li> para garantir a leitura estruturada.
`.trim();

const buildIncrementalSuffix = (
  previousResumo: string,
  currentPartNumber: number,
  totalParts: number,
  fileName: string,
 ) => {
   return `
 ---
 ### INSTRUÇÃO DE ATUALIZAÇÃO PARA A PARTE ${currentPartNumber} ###
 1. **ZONA DE SEGURANÇA:** Se a Seção 1 (Identificação) já tiver dados preenchidos, **PROIBIDO ALTERAR**. Copie-os exatamente do resumo anterior.
 2. **VARREDURA DEFENSIVA:** Se encontrar petições da Ré (Contestação, Impugnação ou Manifestação), verifique se ela ARGUIU preliminares. Se sim, preencha a Seção 3. **Não apague** preliminares já identificadas ("Não identificado" não se aplica) em partes anteriores; apenas adicione novas ou atualize o status se houver decisão.
 3. **FILTRO TEMPORAL:** Priorize documentos de 2025/2026. Se houver conflito entre uma decisão antiga e uma nova, registre a atualização explicando a alteração.
 
 RESUMO CONSOLIDADO ANTERIOR:
 ${previousResumo}
 
 Analise agora o arquivo: ${fileName} e devolva o JSON atualizado.`;
 };


// ---------------------------------------------------------------------------
// Schema Gemini
// ---------------------------------------------------------------------------

const schema = {
  type: 'OBJECT',
  required: ['resumo'],
  properties: {
    resumo: {
      type: 'STRING',
      description:
        'HTML com 7 seções obrigatórias usando h2, p, strong, ul, li. Todos os campos preenchidos ou "Não identificado."',
    },
  },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** JSON parseado do Gemini (schema flow-resumo), antes de anexar count_tokens */
export type FlowResumoGeminiResult = {
  resumo: string
}

export type FlowResumoResult = FlowResumoGeminiResult & {
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

export const flowResumo: ProcessorFlow = {
  name: 'flow-resumo',
  prompt: FLOW_RESUMO_PROMPT,
  schema,

  getIncrementalPrompt(
    previousResult: unknown,
    partIndex: number,
    totalParts: number,
    fileName = 'desconhecido',
  ): string {
    const previousResumo = (previousResult as FlowResumoGeminiResult | null)?.resumo ?? ''
    return `${FLOW_RESUMO_PROMPT}\n\n${buildIncrementalSuffix(previousResumo, partIndex + 1, totalParts, fileName)}`
  },

  // next: {
  //   flow: flowConsolidacao,
  //   when: () => true,
  // },

  async getFiles(numero_processo: string): Promise<string[]> {
    const label = `[flow-resumo:getFiles][${numero_processo}]`
    const filePath = path.join(
      os.homedir(), 'Downloads', 'EQUOR', 'Processos', '2024-2026', numero_processo, `${numero_processo}.pdf`,
    )
    console.log(`${label} Procurando PDF em ${filePath}`)
    try {
      await fs.access(filePath)
    } catch {
      console.warn(`${label} Arquivo não encontrado ou sem acesso — retornando lista vazia`)
      return []
    }
    return [filePath]
  },

  async getPartitionedFiles(numero_processo: string): Promise<string[]> {
    const label = `[flow-resumo:getPartitionedFiles][${numero_processo}]`
    const dir = path.join(os.homedir(), 'Downloads', 'EQUOR', 'Processos', '2024-2026', numero_processo)
    const filePath = path.join(dir, `${numero_processo}.pdf`)

    const pdfBytes = await fs.readFile(filePath)
    const srcDoc = await PDFDocument.load(pdfBytes)
    const totalPages = srcDoc.getPageCount()
    console.log(`${label} PDF carregado: ${totalPages} página(s)`)

    const MAX_CHUNK = 250
    const OVERLAP = 12

    const numParts = Math.ceil((totalPages - OVERLAP) / (MAX_CHUNK - OVERLAP))
    const netPerPart = Math.ceil((totalPages - OVERLAP) / numParts)
    const chunk = Math.min(netPerPart + OVERLAP, MAX_CHUNK)

    const partsDir = path.join(dir, 'parts')
    console.log(`${label} Dividindo em ${numParts} partes (chunk=${chunk}, overlap=${OVERLAP}, dir=${partsDir})`)
    await fs.mkdir(partsDir, { recursive: true })

    const parts: string[] = []
    for (let part = 0; part < numParts; part++) {
      const start = part === 0 ? 0 : part * (chunk - OVERLAP)
      const end = Math.min(start + chunk, totalPages)

      const partDoc = await PDFDocument.create()
      const copied = await partDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i))
      for (const page of copied) partDoc.addPage(page)

      const partPath = path.join(partsDir, `${numero_processo}_part${part + 1}.pdf`)
      await fs.writeFile(partPath, await partDoc.save())
      parts.push(partPath)
    }

    return parts
  },
}
