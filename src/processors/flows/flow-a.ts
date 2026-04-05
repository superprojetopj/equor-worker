import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { flowB } from './flow-b.js'
import type { ProcessorFlow } from '../planilha-review.processor.js'

export type FlowAResult = {
  pressupostos: {
    coisa_julgada: {
      status: boolean
      referencia: { peca: string; pagina: number; paragrafo: string | null; trecho_resumido: string } | null
      alegado_na_defesa: boolean
    }
    ilegitimidade: {
      status: boolean
      referencia: { peca: string; pagina: number; paragrafo: string | null; trecho_resumido: string } | null
      alegado_na_defesa: boolean
    }
    litispendencia: {
      status: boolean
      referencia: { peca: string; pagina: number; paragrafo: string | null; trecho_resumido: string } | null
      alegado_na_defesa: boolean
    }
    suspensao: {
      status: boolean
      motivo: string | null
      referencia: { peca: string; pagina: number; paragrafo: string | null; trecho_resumido: string } | null
    }
  }
  processado_em: string
  fase_processual: {
    instancia: 'primeira_instancia' | 'segunda_instancia' | 'terceira_instancia'
    ultima_movimentacao: string
    data_ultima_movimentacao: string | null
  }
  pendencias_identificadas: {
    tipo: string
    urgencia: 'alta' | 'media' | 'baixa'
    descricao: string
    referencia: { peca: string; pagina: number } | null
  }[]
  pendencias_estrategicas: string | null
  acoes_recomendadas: {
    tipo: string
    descricao: string
    prazo_estimado: string | null
  }[]
  analise_completa: boolean
  documentos_insuficientes: boolean
  requer_prompt_b: boolean
  historico: string
  is_litispendencia: boolean
  is_coisa_julgada: boolean
  is_ilegitimidade: boolean
  is_suspenso: boolean
  has_recurso_revista: boolean
  urgency: 'maxima' | 'alta' | 'media' | 'baixa'
  urgency_motivo: string
  prescricao: {
    status: 'ativa' | 'extinta' | 'risco'
    tipo: string
    data_limite_proxima: string | null
    motivo: string | null
  } | null
  count_tokens: number
}

const FLOW_A_PROMPT = `
Você é advogado de defesa da EMPRESA COPEL S/A e buscará defender os interesses da empresa em todos os processos trabalhistas em curso.
Analise os documentos processuais anexados e retorne exclusivamente um objeto JSON válido, sem qualquer texto, markdown, comentário ou explicação fora do JSON.

CONTEXTO DO PROCESSO:
- Tribunal: TRT-9 (9ª Região – Paraná)
- Parte reclamada: COPEL
- Período de interesse: 2014 a dezembro de 2023
- Fase esperada: execução trabalhista (individual ou coletiva)

DOCUMENTOS FORNECIDOS:
Os documentos estão anexados nesta mensagem em formato PDF ou HTML bruto. Leia integralmente cada documento antes de produzir qualquer conclusão. Não presuma — apenas conclua com base em evidência documental direta.

HIERARQUIA DE FONTES:
Priorize decisões judiciais (sentenças, acórdãos, despachos) sobre petições das partes. Em caso de contradição entre documentos, prevaleça o documento de maior hierarquia e data mais recente.

INSTRUÇÕES DE ANÁLISE:

1. FASE E STATUS PROCESSUAL
Identifique onde o processo realmente está. A presença de movimentação em instância superior não significa que o processo ainda lá se encontra. Verifique se houve baixa dos autos, retorno ao TRT ou à Vara. Classifique o status como: execucao_vara | execucao_trt | execucao_tst | arquivado | apto_arquivamento.

2. PRESSUPOSTOS PROCESSUAIS
Para cada um dos quatro pressupostos abaixo, identifique:
(a) se foi alegado pela defesa; (b) se foi analisado por alguma instância; (c) o resultado: acolhido, rejeitado, pendente ou não_analisado; (d) o trecho resumido da decisão relevante com referência (peça, página, parágrafo se disponível).
Pressupostos: coisa_julgada | ilegitimidade | litispendencia | prescricao

3. REPRESENTAÇÃO SINDICAL
Identifique se há substituição processual por sindicato. Se houver: nome do sindicato, tipo de atuação (substituto_processual | assistente | parte_ativa), período reivindicado por cada substituído, se houve reconhecimento de legitimidade (total | parcial | rejeitada), fundamento da decisão e se havia contribuição sindical.

4. PEDIDOS E RESULTADO
Liste as matérias discutidas. Para cada matéria, indique se foi deferida integralmente, parcialmente ou indeferida, e em qual instância houve a última decisão sobre ela.

5. ALVARÁS
Se houver alvarás expedidos: valor, data de expedição, beneficiário e se já foi levantado.

6. PRESCRIÇÃO INTERCORRENTE
Verifique se há risco de prescrição intercorrente (art. 11-A da CLT). Identifique se houve paralisação superior a 2 anos por inércia do exequente, se o juízo notificou, e se há data-limite de risco mapeável.

7. PENDÊNCIAS E AÇÕES RECOMENDADAS
Identifique: (a) omissões da defesa que geraram ou podem gerar preclusão; (b) teses não exploradas com potencial estratégico; (c) próxima ação concreta com prazo estimado se identificável.

8. URGÊNCIA
Classifique o campo "urgency" com um dos níveis abaixo. Aplique o nível mais alto verificado. Em caso de dúvida entre dois níveis, aplique o mais alto.

NÍVEIS (do maior para o menor):

"maxima" → falha defensiva em preliminar essencial (ilegitimidade, litispendência, coisa julgada ou prescrição) E risco financeiro imediato (penhora/SISBAJUD iminente, prazo aberto, risco de pagamento indevido) — ambos simultâneos.

"alta" → qualquer uma das situações: prazo processual em curso (recurso, embargos, impugnação de cálculos); risco iminente de penhora ou bloqueio SISBAJUD; falha identificada na defesa quanto a preliminar essencial — mesmo sem prazo aberto.

"media" → processo em andamento sem prazo aberto: fase de cálculos/liquidação, aguardando decisão ou homologação, defesa adequada sem falhas relevantes. Execução ativa nunca recebe "baixa" — mínimo é "media".

"baixa" → processo suspenso, encerrado (trânsito em julgado confirmado) ou sem qualquer prazo, risco ou providência possível no momento.

Justifique o nível escolhido no campo "urgency_motivo".

9. RECURSO DE REVISTA
Verifique se há Recurso de Revista interposto (TST). Preencha has_recurso_revista como true somente se houver petição ou decisão admitindo ou processando Recurso de Revista nos documentos.

10. HISTÓRICO
Produza um resumo simplificado do processo contendo apenas os pontos e eventos principais (ajuizamento, decisões relevantes, recursos, fase atual). Seja direto e objetivo — no máximo 10 linhas. Não repita informações já detalhadas nos demais campos; o objetivo é dar uma visão geral rápida da trajetória processual.

REGRA ABSOLUTA:
Retorne apenas o objeto JSON conforme o schema fornecido. Nenhum campo pode ser omitido — use null quando a informação não estiver disponível nos documentos. Não invente dados.

DATAS YYYY-MM-DD:
Os campos data_ultima_movimentacao e prescricao.data_limite_proxima, quando preenchidos, devem ser datas que existam no calendário (respeitar anos bissextos: 29/02 só em ano bissexto). Se a data nos autos estiver errada, ambígua ou você não puder confirmar o dia correto, use null — nunca envie uma data de calendário impossível.

`.trim()

/**
 * Fluxo A
 */
export const flowA: ProcessorFlow = {
  name: 'flow-a',
  prompt: FLOW_A_PROMPT,
  schema: {
    type: 'OBJECT',
    required: [
      'pressupostos', 'processado_em', 'fase_processual',
      'pendencias_identificadas', 'pendencias_estrategicas', 'acoes_recomendadas',
      'analise_completa', 'documentos_insuficientes', 'requer_prompt_b',
      'historico', 'is_litispendencia', 'is_coisa_julgada',
      'is_ilegitimidade', 'is_suspenso', 'has_recurso_revista',
      'urgency', 'urgency_motivo', 'prescricao',
    ],
    properties: {
      pressupostos: {
        type: 'OBJECT',
        required: ['coisa_julgada', 'ilegitimidade', 'litispendencia', 'suspensao'],
        properties: {
          coisa_julgada: {
            type: 'OBJECT',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: { type: 'BOOLEAN', description: 'true se acolhida; false se rejeitada ou não identificada.' },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING' },
                  pagina: { type: 'NUMBER' },
                  paragrafo: { type: 'STRING', nullable: true },
                  trecho_resumido: { type: 'STRING' },
                },
              },
              alegado_na_defesa: { type: 'BOOLEAN' },
            },
          },
          ilegitimidade: {
            type: 'OBJECT',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: { type: 'BOOLEAN' },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING' },
                  pagina: { type: 'NUMBER' },
                  paragrafo: { type: 'STRING', nullable: true },
                  trecho_resumido: { type: 'STRING' },
                },
              },
              alegado_na_defesa: { type: 'BOOLEAN' },
            },
          },
          litispendencia: {
            type: 'OBJECT',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: { type: 'BOOLEAN' },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING' },
                  pagina: { type: 'NUMBER' },
                  paragrafo: { type: 'STRING', nullable: true },
                  trecho_resumido: { type: 'STRING' },
                },
              },
              alegado_na_defesa: { type: 'BOOLEAN' },
            },
          },
          suspensao: {
            type: 'OBJECT',
            required: ['status'],
            properties: {
              status: { type: 'BOOLEAN' },
              motivo: { type: 'STRING', nullable: true },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING' },
                  pagina: { type: 'NUMBER' },
                  paragrafo: { type: 'STRING', nullable: true },
                  trecho_resumido: { type: 'STRING' },
                },
              },
            },
          },
        },
      },
      processado_em: {
        type: 'STRING',
        description: 'ISO 8601 datetime.',
      },
      fase_processual: {
        type: 'OBJECT',
        required: ['instancia', 'ultima_movimentacao'],
        properties: {
          instancia: {
            type: 'STRING',
            enum: ['primeira_instancia', 'segunda_instancia', 'terceira_instancia'],
          },
          ultima_movimentacao: { type: 'STRING' },
          data_ultima_movimentacao: { type: 'STRING', nullable: true, description: 'Data válida da última movimentação no calendário e no formato YYYY-MM-DD ou null' },
        },
      },
      pendencias_identificadas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['tipo', 'urgencia', 'descricao'],
          properties: {
            tipo: { type: 'STRING' },
            urgencia: { type: 'STRING', enum: ['alta', 'media', 'baixa'] },
            descricao: { type: 'STRING' },
            referencia: {
              type: 'OBJECT',
              nullable: true,
              required: ['peca', 'pagina'],
              properties: {
                peca: { type: 'STRING' },
                pagina: { type: 'NUMBER' },
              },
            },
          },
        },
      },
      pendencias_estrategicas: {
        type: 'STRING',
        nullable: true,
      },
      acoes_recomendadas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: ['tipo', 'descricao'],
          properties: {
            tipo: { type: 'STRING' },
            descricao: { type: 'STRING' },
            prazo_estimado: { type: 'STRING', nullable: true },
          },
        },
      },
      analise_completa: { type: 'BOOLEAN' },
      documentos_insuficientes: { type: 'BOOLEAN' },
      requer_prompt_b: { type: 'BOOLEAN' },
      historico: {
        type: 'STRING',
        description: 'Resumo cronológico simplificado (máx. 10 linhas).',
      },
      is_litispendencia: { type: 'BOOLEAN' },
      is_coisa_julgada: { type: 'BOOLEAN' },
      is_ilegitimidade: { type: 'BOOLEAN' },
      is_suspenso: { type: 'BOOLEAN' },
      has_recurso_revista: { type: 'BOOLEAN' },
      urgency: {
        type: 'STRING',
        enum: ['maxima', 'alta', 'media', 'baixa'],
      },
      urgency_motivo: { type: 'STRING' },
      prescricao: {
        type: 'OBJECT',
        nullable: true,
        required: ['status', 'tipo'],
        properties: {
          status: { type: 'STRING', enum: ['ativa', 'extinta', 'risco'] },
          tipo: { type: 'STRING' },
          data_limite_proxima: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
          motivo: { type: 'STRING', nullable: true },
        },
      },
    },
  },
  async getFiles(numero_processo: string): Promise<string[]> {
    const dir = path.join(os.homedir(), 'Downloads', 'EQUOR', 'Processos', '2014-2023', numero_processo)
    const supported = new Set([
      '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
      '.mp4', '.txt', '.html', '.csv', '.json', '.docx', '.xlsx',
    ])
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && supported.has(path.extname(e.name).toLowerCase()))
        .map((e) => path.join(dir, e.name))
    } catch {
      return []
    }
  },
  // next: {
  //   flow: flowB,
  //   when: (result) => (result as { requer_prompt_b?: boolean }).requer_prompt_b === true,
  // },
}
