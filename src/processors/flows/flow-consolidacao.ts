import type { ProcessorFlow } from '../planilha-review.processor.js'
import type { FlowResumoGeminiResult } from './flow-resumo.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const FLOW_CONSOLIDACAO_PROMPT = `
IDENTIDADE
Você é um Especialista em Estratégia Jurídica focado na defesa da COPEL (ré). Sua missão é analisar o Cumprimento de Sentença sob a ótica EXCLUSIVA da Ré (executada/COPEL).

FONTE DE DADOS
Você receberá um RESUMO FACTUAL dos autos gerado por análise prévia de todos os documentos do processo.
Baseie toda sua análise exclusivamente nos fatos contidos nesse resumo — não invente nem infira além do que está descrito.

REGRA CRÍTICA — DISTINGUIR FASES DO PROCESSO
Separe claramente dados de fases diferentes (conhecimento, liquidação, execução/cumprimento de sentença).
Use os valores e informações da fase ATUAL, não de fases anteriores.
Se for cumprimento individual de ação coletiva, mencione a substituição processual e o sindicato originário.

TAREFA
Com base no resumo factual fornecido, responda as seguintes questões, produzindo JSON conforme o schema:

1. RESUMO DA AÇÃO (campo "resumo_acao", máx. 8 linhas, em tópicos):
Sintetize o objeto da execução/cumprimento de sentença, as partes envolvidas e o valor da causa mencionado na petição inicial desta fase (não da ação originária).

2. TEMA / MATÉRIA CENTRAL (campo "materia_central"):
Identifique o direito principal reconhecido no título executivo (ex: verba "Dupla Função", reflexos, diferenças salariais por PCS, etc.).

3. DISCUSSÃO DAS PRELIMINARES (campo "preliminares"):
Para cada uma (ilegitimidade, litispendência, coisa julgada): houve contestação ou decisão? Informe o resultado (ACOLHIDA, REJEITADA ou null se não houve menção).

4. FASE E STATUS DO PROCESSO (campo "fase_status"):
Identifique o estágio atual dos autos (ex: "liquidação — aguardando perícia", "citação para pagamento", "embargos à execução pendentes", etc.).

5. SITUAÇÃO DO FEITO (campo "situacao_feito"):
Classifique como: EM_ANDAMENTO, SUSPENSO, FINALIZADO ou ARQUIVADO.

6. RESULTADO FINAL (campo "resultado_final", máx. 5 linhas):
Resuma o que foi decidido na última decisão relevante ou sentença de liquidação presente nos documentos. null se não houver decisão relevante identificada.

7. RECURSO DE REVISTA (campo "recurso_revista"):
Os documentos mencionam interposição de RR (fase de conhecimento ou execução)? Qual foi o desfecho mencionado?

8. INSTÂNCIA ATUAL (campo "instancia"):
Onde os autos tramitam HOJE, com base no resumo: PRIMEIRA_INSTANCIA (juízo de vara / primeira instância), SEGUNDA_INSTANCIA (TRT, relator, turma) ou TERCEIRA_INSTANCIA (TST).

9. DATA DA ÚLTIMA MOVIMENTAÇÃO RELEVANTE (campo "data_movimentacao"):
Data no formato YYYY-MM-DD do evento jurídico mais recente descrito no resumo (decisão, acórdão, despacho de mérito). null se não houver data clara ou for ambígua.
`.trim()

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function preliminarSchema(definicao: string) {
  return {
    type: 'OBJECT' as const,
    description: definicao,
    required: ['discutido', 'resultado'],
    properties: {
      discutido: {
        type: 'BOOLEAN',
        description: 'true se houve contestação, menção ou decisão sobre o tema nos autos. false se o tema não aparece.',
      },
      resultado: {
        type: 'STRING' as const,
        nullable: true,
        enum: ['ACOLHIDA', 'REJEITADA'],
        description: 'ACOLHIDA = aceita pelo juízo. REJEITADA = afastada. null se discutido = false ou sem decisão de mérito.',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Schema Gemini
// ---------------------------------------------------------------------------

const schema = {
  type: 'OBJECT',
  required: [
    'resumo_acao',
    'materia_central',
    'preliminares',
    'instancia',
    'data_movimentacao',
    'fase_status',
    'situacao_feito',
    'resultado_final',
    'recurso_revista',
  ],
  properties: {
    resumo_acao: {
      type: 'STRING',
      description: 'Síntese do objeto da execução, partes envolvidas e valor da causa desta fase. Máximo 8 linhas, em tópicos.',
    },
    materia_central: {
      type: 'STRING',
      description: 'Direito principal reconhecido no título executivo (ex: verba "Dupla Função", reflexos, diferenças salariais por PCS).',
    },
    preliminares: {
      type: 'OBJECT',
      required: ['ilegitimidade', 'litispendencia', 'coisa_julgada'],
      properties: {
        ilegitimidade: preliminarSchema('Legitimidade passiva da COPEL ou ativa do exequente.'),
        litispendencia: preliminarSchema('Ação com pedido idêntico em curso simultâneo.'),
        coisa_julgada: preliminarSchema('Ação com pedido idêntico já transitada em julgado.'),
      },
    },
    instancia: {
      type: 'STRING',
      enum: ['PRIMEIRA_INSTANCIA', 'SEGUNDA_INSTANCIA', 'TERCEIRA_INSTANCIA'],
      description:
        'Instância em que o processo tramita no momento, conforme o resumo (vara/juízo → PRIMEIRA; TRT/relator → SEGUNDA; TST → TERCEIRA).',
    },
    data_movimentacao: {
      type: 'STRING',
      format: 'date',
      nullable: true,
      description: 'Data YYYY-MM-DD da última movimentação jurídica relevante. null se ausente ou ambígua no resumo.',
    },
    fase_status: {
      type: 'STRING',
      description: 'Estágio atual dos autos (ex: "liquidação — aguardando perícia", "citação para pagamento", "embargos pendentes").',
    },
    situacao_feito: {
      type: 'STRING',
      enum: ['EM_ANDAMENTO', 'SUSPENSO', 'FINALIZADO', 'ARQUIVADO'],
      description: 'Classificação da situação atual do feito.',
    },
    resultado_final: {
      type: 'STRING',
      nullable: true,
      description: 'Resumo do que foi decidido na última decisão relevante ou sentença de liquidação. Máximo 5 linhas. null se não identificado.',
    },
    recurso_revista: {
      type: 'OBJECT',
      required: ['mencionado'],
      properties: {
        mencionado: {
          type: 'BOOLEAN',
          description: 'true se há menção a Recurso de Revista (conhecimento ou execução) nos documentos.',
        },
        desfecho: {
          type: 'STRING',
          nullable: true,
          description: 'Desfecho mencionado (ex: "inadmitido pelo TRT", "admitido — pendente no TST"). null se mencionado = false ou sem desfecho identificado.',
        },
        referencia: {
          type: 'OBJECT',
          nullable: true,
          required: ['peca', 'pagina'],
          properties: {
            peca: { type: 'STRING', nullable: true },
            pagina: { type: 'NUMBER', nullable: true },
          },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// FlowConsolidacaoResult
// ---------------------------------------------------------------------------

type Preliminar = {
  discutido: boolean
  resultado: 'ACOLHIDA' | 'REJEITADA' | null
}

export type FlowConsolidacaoResult = {
  resumo_acao: string
  materia_central: string
  preliminares: {
    ilegitimidade: Preliminar
    litispendencia: Preliminar
    coisa_julgada: Preliminar
  }
  instancia: 'PRIMEIRA_INSTANCIA' | 'SEGUNDA_INSTANCIA' | 'TERCEIRA_INSTANCIA'
  /** YYYY-MM-DD ou null — alinhado ao payload `data_ultima_movimentacao` */
  data_movimentacao: string | null
  fase_status: string
  situacao_feito: 'EM_ANDAMENTO' | 'SUSPENSO' | 'FINALIZADO' | 'ARQUIVADO'
  resultado_final: string | null
  recurso_revista: {
    mencionado: boolean
    desfecho: string | null
    referencia: { peca: string | null; pagina: number | null } | null
  }
  /** Added at runtime by the processor — not part of the Gemini schema */
  count_tokens: number
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export const flowConsolidacao: ProcessorFlow = {
  name: 'flow-consolidacao',
  prompt: FLOW_CONSOLIDACAO_PROMPT,
  schema,

  buildPromptFromContext(previousResult: unknown): string {
    const resumo = (previousResult as FlowResumoGeminiResult | null)?.resumo ?? ''
    return `${FLOW_CONSOLIDACAO_PROMPT}

---
RESUMO DO PROCESSO (gerado por análise prévia de todos os documentos):
${resumo}

Com base exclusivamente no resumo acima, produza o JSON conforme o schema.`
  },
}
