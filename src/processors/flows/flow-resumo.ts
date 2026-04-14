import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { ProcessorFlow } from '../planilha-review.processor.js'
import { flowConsolidacao } from './flow-consolidacao.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const FLOW_RESUMO_PROMPT = `
## Persona:
Você é um Analista Jurídico Sênior especializado em execuções trabalhistas e auditoria de passivos. Sua tarefa é analisar os autos de um cumprimento de sentença e extrair informações cruciais, com foco em estratégia processual e cronologia.

## Onde encontrar as informações:
- Dados Básicos: Petição Inicial e Capa do Processo.
- Preliminares e Prejudiciais: Analise comparativamente a Petição Inicial (onde pode haver refutação antecipada), a Impugnação/Defesa da Executada e manifestações subsequentes.
- Conflito Sindical: Compare a representação mencionada na Inicial com os dados da Ficha Financeira/Histórico Funcional.

## INSTRUÇÕES DE ANÁLISE:

1. Cronologia e Status:
   - Determine a "Instância Atual" baseando-se na data da peça mais recente. 
   - Estabeleça a linha do tempo: se a última peça for um Recurso de Revista, o status é Instância Extraordinária (3ª Instância), e assim por diante.

2. Argumentação Indireta e Tácita:
   - Considere "Argumentação" não apenas a citação direta de artigos, mas qualquer esforço narrativo para excluir responsabilidade, questionar cálculos com base em premissas de prescrição ou atacar a legitimidade da parte.

3. Análise de Preliminares (Litispendência, Coisa Julgada, Ilegitimidade, Prescrição):
   - **IMPORTANTE (Antecipação do Exequente):** Verifique se o Exequente, na petição inicial/de cumprimento, já tentou refutar preventivamente uma preliminar (ex: "não há que se falar em prescrição pois..."). 
   - Se o Exequente antecipou o tema e a Executada (Copel) se manteve silente em sua defesa, classifique como "Não arguida pela ré (silêncio após antecipação do exequente)".
   - Para cada preliminar, indique: "Arguida", "Não identificada" ou "Refutada antecipadamente pelo autor sem oposição específica da ré".

4. Conflito entre Sindicatos:
   - Informe se há divergência entre o sindicato autor da ação e o sindicato que consta na ficha financeira. Se houver divergência e a Copel não arguiu ilegitimidade, destaque como "Omissão de tese defensiva".

## ESTRUTURA DO RESUMO (Técnica):
- **Identificação:** Número CNJ, Objeto, Instância (com base na última movimentação), Autor (nome completo do autor) e Tipo de Ação.
- **Análise Técnica:** - Liste Litispendência, Coisa Julgada, Ilegitimidade e Prescrição.
    - Para Prescrição, especifique o marco temporal e se é bienal ou quinquenal.
    - Descreva o comportamento da defesa: se houve enfrentamento direto, indireto ou falta de argumentação estratégica.

## RESTRIÇÕES:
- Seja estritamente factual.
- Retorne EXCLUSIVAMENTE um objeto JSON.
- Sempre que citar uma peça processual, utilize o ID alfanumérico (ex: 0ef0192) em vez do número da folha, ou não citar.

FORMATO DE SAÍDA:
{"resumo": "conteúdo_html"}
(Use tags <h3>, <ul> e <li> para estruturar o relatório).

O "conteúdo_html" deve seguir RIGOROSAMENTE este modelo de tags, sem variações:

<h3>Identificação</h3>
<ul>
  <li><strong>Número do Processo:</strong> [Número CNJ]</li>
  <li><strong>Objeto:</strong> [Objeto da ação]</li>
  <li><strong>Instância Atual:</strong> [Xª Instância]</li>
  <li><strong>Autor:</strong> [Nome Completo]</li>
  <li><strong>Matéria Central:</strong> [Matéria Central e verba principal]</li>
  <li><strong>Tipo de Ação/ Execução:</strong> [Individual ou Coletiva]</li>
</ul>

<h3>Análise Técnica</h3>
<p>Preliminares:</p>
<ul>
  <li><strong>Litispendência:</strong> ["Arguido em X" ou "Não identificada"]</li>
  <li><strong>Coisa Julgada:</strong> ["Arguida em X" ou "Não identificada"]</li>
  <li><strong>Ilegitimidade:</strong> ["Arguida em X" ou "Não identificada"]</li>
  <li><strong>Prescrição:</strong> [Tipo: Bienal/Quinquenal | Resumo do argumento]</li>
  <li><strong>Conflito Sindical:</strong> [Relatar divergências ou "Não identificada"]</li>
</ul>
`.trim();

const buildIncrementalSuffix = (
  previousResumo: string,
  currentPartNumber: number,
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
    return `${FLOW_RESUMO_PROMPT}\n\n${buildIncrementalSuffix(previousResumo, partIndex + 1, fileName)}`
  },

  next: {
    flow: flowConsolidacao,
    when: () => true,
  },

  async getFiles(numero_processo: string): Promise<string[]> {
    const label = `[flow-resumo:getPartitionedFiles][${numero_processo}]`
    const dir = path.join(os.homedir(), 'Downloads', 'EQUOR', 'Processos', 'julia', numero_processo)
    const filePath = path.join(dir, `${numero_processo}.pdf`)

    const pdfBytes = await fs.readFile(filePath)
    const srcDoc = await PDFDocument.load(pdfBytes)
    const totalPages = srcDoc.getPageCount()
    console.log(`${label} PDF carregado: ${totalPages} página(s)`)

    if (totalPages < 1000) {
      return [filePath]
    }

    const MAX_CHUNK = 250
    const OVERLAP = 12

    const numParts = Math.ceil((totalPages - OVERLAP) / (MAX_CHUNK - OVERLAP))
    const netPerPart = Math.ceil((totalPages - OVERLAP) / numParts)
    const chunk = Math.min(netPerPart + OVERLAP, MAX_CHUNK)

    const partsDir = path.join(dir, 'parts')
    console.log(`${label} Dividindo em ${numParts} partes (chunk=${chunk}, overlap=${OVERLAP}, dir=${partsDir})`)
    await fs.rm(partsDir, { recursive: true, force: true })
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
