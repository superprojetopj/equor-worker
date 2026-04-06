import os from 'os'
import path from 'path'
import fs from 'fs/promises'
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
IDENTIDADE
Você é um analista jurídico especializado em execuções trabalhistas. O foco é a estratégia de defesa da parte ré (executada/COPEL).

OBJETIVO
Você deve considerar que havendo discussão em sentença a acordão acerca da legitimidade, litispendência, coisa julgada, prescrição, essas matérias foram alegadas em defesa.
Não havendo discussão nos autos sobre legitimidade, litispendência, coisa julgada, prescrição, você deve acusar como preliminares/prejudiciais de mérito não encontradas.

DEFINIÇÕES IMPORTANTES:
- Para identificar LITISPENDENCIA: analisar/identificar se o autor possuia ou possui ação com pedido idêntico à matéria discutida nesta ação objeto da análise e qual resultado disso? se isso foi observado e discutido em sentença de primeira instância e acordão de segunda instância ou terceira instancia, e qual foi o resultado final da discussão.
- Para identificar COISA JULGADA: analisar/identificar se o autor possuiu ação com pedido idêntico à matéria discutida nesta ação objeto da análise e qual resultado disso? se isso foi observado e discutido em sentença de primeira instância e acordão de segunda isntância ou terceira instancia, e qual foi o resultado final da discussão. Se na coisa julgada, se a primeria ação for arquivada ou continua ativa.

Seu trabalho:
1. Ler integralmente todos os documentos anexados.
2. Identificar a matéria principal discutida nos autos.
3. Identificar se há discussão sobre legitimidade, litispendência, coisa julgada, prescrição.
4. Identificar se as matérias (legitimidade, litispendência, coisa julgada, prescrição) foram discutidas em sentença de primeira instancia ou acordão de segunda instancia e qual o resultado desta discussão.
5. Identificar se as matérias foram reiteradas ao longo da discussão processual, em que momento elas cessaram e qual o resultado final da discussão acerca de legitimidade, litispendência, coisa julgada, prescrição.
6. Identificar se trata-se de ação individual ou se a parte autora é substituida pelo sindicato, identificando o sindicato originário da ação coletiva ou ação civil pública que deu origem ao direito, objeto da matéria principal, 
bem como o sindicato que representa o substituído nesta ação objeto de análise.
7. Retornar exclusivamente um objeto JSON válido, conforme o schema fornecido em paralelo.

Regras invioláveis:
- Nenhum texto fora do JSON. Nenhum markdown, comentário ou explicação.
- Se a informação não constar nos documentos, use null (para campos nullable) ou false (para booleanos). Nunca invente, infira ou complemente com conhecimento externo.
- Para cada campo, identifique mentalmente: qual peça, qual página e qual trecho fundamenta o análise sobre legitimidade, litispendência, coisa julgada, prescrição. Sem evidência documental → null.

CONTEXTO
- Tribunal: TRT-9 (9ª Região – Paraná)
- Parte reclamada: COPEL
- Período de interesse: 2014 a dezembro de 2023
- Fase esperada: execução trabalhista (individual ou coletiva)

HIERARQUIA DE FONTES
- Decisões judiciais prevalecem sobre petições das partes.
- Documento de maior hierarquia e data mais recente prevalece.
- Contradição entre documentos de mesma hierarquia → registre a contradição no campo relevante.

---

INSTRUÇÕES CAMPO A CAMPO

1. FASE PROCESSUAL (campo: fase_processual)
Determine onde os autos estão AGORA. Verifique se houve baixa/retorno antes de classificar.
- instancia: "primeira_instancia", "segunda_instancia" ou "terceira_instancia" — reflete onde os autos TRAMITAM hoje, não onde houve a última decisão.
- ultima_movimentacao: descreva brevemente o último ato processual relevante.
- data_ultima_movimentacao: YYYY-MM-DD. Se ambígua ou impossível (ex: 30/02), use null.

2. PRESSUPOSTOS PROCESSUAIS (campo: pressupostos)
Analise QUATRO pressupostos: coisa_julgada, ilegitimidade, litispendencia, suspensao.

Para cada um:
- alegado_na_defesa: true se a COPEL levantou essa tese em qualquer peça; false caso contrário.
- referencia: objeto com peca, pagina, paragrafo e trecho_resumido da decisão. Null se não houve decisão sobre o tema.

IMPORTANTE:
- "Suspensão" refere-se a qualquer determinação de suspensão do feito (IRDR, tema repetitivo, efeito suspensivo, acordo). Preencha "motivo" quando disponível.

3. PRESCRIÇÃO (campo: prescricao)
- status: "ativa" (prazo correndo sem risco), "extinta" (declarada judicialmente), "risco" (paralisação que pode configurar intercorrente, mas ainda não declarada).
- tipo: "quinquenal", "bienal" ou "intercorrente". Cite o de maior risco.
- data_limite_proxima: para intercorrente, calcule 2 anos da última intimação sem resposta do exequente. YYYY-MM-DD. Null se não aplicável.
- motivo: fundamento detalhado. Ex: "Exequente intimado em 15/03/2022 sem manifestação; prazo do art. 11-A CLT vence em 15/03/2024."
- Null para o objeto inteiro somente se não houver qualquer elemento nos autos para avaliar prescrição.

4. REPRESENTAÇÃO SINDICAL, PEDIDOS E ALVARÁS
Estas informações NÃO têm campo próprio no schema. Distribua assim:
- HISTÓRICO (campo: historico): inclua no resumo cronológico: nome do sindicato e tipo de atuação (se houver), principais pedidos e seus resultados (deferido/indeferido), e alvarás expedidos (valor, beneficiário, se levantado).
- PENDÊNCIAS (campo: pendencias_identificadas): se houver alvará pendente de levantamento, prazo relativo a sindicato, ou pedido com risco, crie um item com tipo apropriado (ex: "alvara", "legitimidade_sindical", "outro").
- ESTRATÉGIA (campo: pendencias_estrategicas): se houver tese defensiva não explorada relativa a sindicato (legitimidade questionável, substituídos sem vínculo) ou pedidos (base de cálculo, índice de correção), registre aqui.

5. RECURSO DE REVISTA (campo: has_recurso_revista)
true SOMENTE se houver nos documentos petição ou decisão admitindo/inadmitindo/processando Recurso de Revista. Não presuma.
Identificar matéria objeto do recurso de revista e petição ou despacho admitindo/inadmitindo/processando Recurso de Revista.

6. PENDÊNCIAS IDENTIFICADAS (campo: pendencias_identificadas)
Liste pendências concretas. Para cada uma:
- tipo: use preferencialmente "prazo_recursal", "impugnacao_calculos", "penhora_iminente", "sisbajud", "omissao_defesa", "diligencia_pendente", "intimacao_pendente", "alvara", "legitimidade_sindical" ou "outro".
- urgencia: "alta" (risco financeiro iminente), "media" (requer ação sem prazo imediato), "baixa" (monitoramento).
- descricao: O QUE é a pendência + O QUE fazer. Seja específico.
- referencia: peca e pagina. Null se não localizável.

7. PENDÊNCIAS ESTRATÉGICAS (campo: pendencias_estrategicas)
Texto livre. Teses não exploradas pela defesa: índice de correção (IPCA-E vs TR vs SELIC pós EC 113/2021), base de cálculo, limitação temporal, compensação, excesso de execução, legitimidade de substituídos, contribuição sindical. Null se não houver.

8. AÇÕES RECOMENDADAS (campo: acoes_recomendadas)
Próximas ações concretas, em ordem de prioridade:
- tipo: "recurso", "peticao", "impugnacao", "embargo", "manifestacao", "diligencia" ou "monitoramento".
- descricao: O QUE fazer + fundamento + objetivo estratégico.
- prazo_estimado: se identificável nos autos. Null caso contrário — NUNCA invente prazos.

9. URGÊNCIA (campos: urgency e urgency_motivo)
Aplique o nível mais alto verificado COM EVIDÊNCIA DOCUMENTAL.

"maxima" → DOIS critérios SIMULTÂNEOS e documentados:
  (a) falha defensiva em preliminar essencial; E
  (b) risco financeiro imediato (penhora/SISBAJUD iminente, prazo aberto, pagamento indevido).
  Ex: "Despacho determinou pagamento de valores inferior ou igual a 15 dias."

"alta" → QUALQUER UM, evidenciado nos autos:
  - Prazo processual em curso (recurso, embargos, impugnação);
  - Risco iminente de penhora ou SISBAJUD;
  - Falha defensiva em preliminar essencial.
  Ex: "Intimação para impugnar cálculos com prazo de 8 dias a partir de 20/12/2023."

"media" → Execução ativa sem prazo aberto. Inclui: fase de cálculos, aguardando decisão, defesa adequada.
  REGRA: execução ativa NUNCA recebe "baixa" — mínimo é "media".

"baixa" → Processo suspenso, encerrado, arquivado, sem providência possível.

urgency_motivo: OBRIGATÓRIO. Cite peça e trecho documental concreto. Justificativas genéricas são insuficientes.

10. RESULTADO ESPERADO BOOLEANOS
Estes campos DEVEM SER CONSISTENTES com os objetos detalhados:
- is_coisa_julgada → TRUE SOMENTE se foi discutida em sentença de primeira instância ou acordão de segunda instância ou terceira instancia e qual o resultado final da discussão.
- is_litispendencia → se foi discutida em sentença de primeira instância ou acordão de segunda instância ou terceira instancia e qual o resultado final da discussão.
- is_ilegitimidade → se foi discutida em sentença de primeira instância ou acordão de segunda instância ou terceira instancia e qual o resultado final da discussão.
- is_suspenso → se foi discutida em sentença de primeira instância ou acordão de segunda instância ou terceira instancia e qual o resultado final da discussão.

11. CONTROLE DE QUALIDADE
- analise_completa: true se TODOS os documentos foram lidos integralmente sem truncamento ou erro. false se algum falhou (detalhar no historico).
- documentos_insuficientes: true se faltam peças essenciais para determinar fase ou pedidos. false se permitem análise razoável.
- requer_prompt_b: true se a complexidade exige segunda rodada (muitos substituídos, cálculos complexos, fases sobrepostas). false caso contrário.

12. HISTÓRICO (campo: historico)
Resumo cronológico em no máximo 10 linhas. Inclua:
- Data de ajuizamento e partes
- Sindicato (nome e papel, se houver)
- Principais pedidos e resultados (deferido/indeferido/parcial)
- Decisões relevantes e recursos
- Alvarás expedidos (valor, beneficiário, status)
- Fase atual
- Documentos ilegíveis/truncados (se houver
O formato de apresentação do histórico deve ser feita em forma de tópicos e sub-tópicos seguindo a seguinte estrutura:
- Data de ajuizamento e partes
- Sindicato (nome e papel, se houver)
- Principais pedidos e resultados (deferido/indeferido/parcial)
- Decisões relevantes e recursos
- Alvarás expedidos (valor, beneficiário, status)
- Fase atual
- Documentos ilegíveis/truncados (se houver)

---

FORMATO DE SAÍDA
Retorne APENAS o objeto JSON conforme o schema fornecido em paralelo. Nenhum campo pode ser omitido.

DATAS: YYYY-MM-DD. Devem existir no calendário. Se ambígua → null.
ARRAYS: use [] (vazio) quando não houver itens — não use null para arrays.
BOOLEANOS: na dúvida entre true e false, use false (princípio conservador).
`.trim()

/**
 * Fluxo A
 */
export const flowA: ProcessorFlow = {
  name: 'flow-a',
  prompt: FLOW_A_PROMPT,
  /** Schema alinhado às instruções do FLOW_A_PROMPT (descriptions e enums; mesma estrutura de campos). */
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
      fase_processual: {
        type: 'OBJECT',
        description:
          'Situação atual do processo. Determine onde os autos estão AGORA: verifique se houve baixa/retorno antes de classificar a instância — a presença de decisão em instância superior não significa que os autos ainda lá estão.',
        required: ['instancia', 'ultima_movimentacao'],
        properties: {
          instancia: {
            type: 'STRING',
            enum: ['primeira_instancia', 'segunda_instancia', 'terceira_instancia'],
            description:
              'Instância onde os autos se encontram ATUALMENTE (não onde houve a última decisão, mas onde tramitam agora). Se houve baixa do TST ao TRT, use "segunda_instancia". Se retornaram à Vara de origem, use "primeira_instancia".',
          },
          ultima_movimentacao: {
            type: 'STRING',
            description:
              'Descrição breve do último ato processual relevante encontrado nos documentos. Ex: "Despacho determinando cálculos de liquidação" ou "Acórdão negando provimento ao agravo de petição".',
          },
          data_ultima_movimentacao: {
            type: 'STRING',
            nullable: true,
            description:
              'Data do último ato processual no formato YYYY-MM-DD. Deve ser uma data válida no calendário (29/02 apenas em anos bissextos). Se ambígua ou impossível (ex: 30/02), use null.',
          },
        },
      },
      pressupostos: {
        type: 'OBJECT',
        description:
          'Análise dos quatro pressupostos: coisa_julgada, ilegitimidade, litispendencia, suspensao. NÃO inclui prescrição (campo raiz "prescricao"). Hierarquia: decisões judiciais prevalecem sobre petições; documento de maior hierarquia e data mais recente prevalece; se houver contradição entre documentos de mesma hierarquia, registre no trecho_resumido da referência ou no campo "historico". Havendo discussão em sentença de 1ª instância ou em acórdão de 2ª instância sobre legitimidade, litispendência ou coisa julgada, considere que a matéria foi alegada em defesa pela COPEL. Sem discussão nos autos sobre essas matérias nas decisões de mérito, trate como preliminares/prejudiciais de mérito não encontradas (status false salvo acolhimento judicial demonstrado; alegado_na_defesa conforme peças da COPEL). Para cada tema (exceto suspensão quanto a alegado), verifique se foi discutido em sentença e/ou acórdão, se foi reiterado ao longo do processo, e qual o resultado final.',
        required: ['coisa_julgada', 'ilegitimidade', 'litispendencia', 'suspensao'],
        properties: {
          coisa_julgada: {
            type: 'OBJECT',
            description:
              'Identifique se o autor possuiu ação com pedido idêntico à matéria desta ação e qual o resultado. Verifique se isso foi discutido em sentença de 1ª instância e/ou acórdão de 2ª/3ª instância, o resultado em cada estágio, reiterações e resultado final. Quando identificada, verifique também se a primeira ação foi arquivada ou ainda continua ativa. referencia: decisão que analisou o tema (peça, página, parágrafo se houver, trecho_resumido); null se não houve decisão sobre o tema.',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: {
                type: 'BOOLEAN',
                description:
                  'true = coisa julgada foi ACOLHIDA por decisão judicial. false = rejeitada, não analisada nos autos, ou preliminar não encontrada/discutida em decisão de mérito. Na dúvida, use false (princípio conservador).',
              },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                description: 'Referência à decisão judicial que analisou a coisa julgada. Null se não houve decisão sobre o tema.',
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: {
                    type: 'STRING',
                    description: 'Nome da peça processual (ex: "Sentença", "Acórdão TRT", "Decisão monocrática TST").',
                  },
                  pagina: { type: 'NUMBER', description: 'Número da página do documento PDF onde consta a análise.' },
                  paragrafo: {
                    type: 'STRING',
                    nullable: true,
                    description: 'Identificação do parágrafo ou item, se possível (ex: "§3º", "item 2.1"). Null se não identificável.',
                  },
                  trecho_resumido: {
                    type: 'STRING',
                    description:
                      'Resumo de 1-2 frases do fundamento da decisão. Não copie o texto literal — resuma o raciocínio do julgador.',
                  },
                },
              },
              alegado_na_defesa: {
                type: 'BOOLEAN',
                description:
                  'true se a COPEL levantou coisa julgada em qualquer peça processual (contestação, embargos, recurso, petição). false caso contrário.',
              },
            },
          },
          ilegitimidade: {
            type: 'OBJECT',
            description:
              'Legitimidade (passiva da COPEL ou ativa do exequente). Mesma linha de análise que coisa_julgada: discussão em sentença/acórdão, reiteração e resultado final. referencia com peca, pagina, paragrafo (se houver), trecho_resumido; null se não houve análise judicial.',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: {
                type: 'BOOLEAN',
                description:
                  'true = ilegitimidade foi ACOLHIDA por decisão judicial. false = rejeitada, não analisada nos autos, ou matéria não encontrada em decisão de mérito. Na dúvida, use false.',
              },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                description: 'Referência à decisão que analisou a ilegitimidade. Null se não houve análise judicial.',
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING', description: 'Nome da peça processual (ex: "Sentença", "Acórdão TRT").' },
                  pagina: { type: 'NUMBER', description: 'Página do documento PDF.' },
                  paragrafo: {
                    type: 'STRING',
                    nullable: true,
                    description: 'Parágrafo ou item, se identificável. Null caso contrário.',
                  },
                  trecho_resumido: { type: 'STRING', description: 'Resumo de 1-2 frases do fundamento da decisão.' },
                },
              },
              alegado_na_defesa: {
                type: 'BOOLEAN',
                description: 'true se a COPEL alegou ilegitimidade em qualquer peça processual.',
              },
            },
          },
          litispendencia: {
            type: 'OBJECT',
            description:
              'Identifique se o autor possuía ou possui ação com pedido idêntico à matéria desta ação (processo em curso) e qual o resultado. Verifique se isso foi discutido em sentença de 1ª instância e/ou acórdão de 2ª/3ª instância, reiteração e resultado final. referencia; null se não houve análise judicial.',
            required: ['status', 'alegado_na_defesa'],
            properties: {
              status: {
                type: 'BOOLEAN',
                description:
                  'true = litispendência ACOLHIDA por decisão judicial. false = rejeitada, não analisada nos autos, ou matéria não encontrada em decisão de mérito. Na dúvida, use false.',
              },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                description: 'Referência à decisão sobre litispendência. Null se não houve análise judicial.',
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING', description: 'Nome da peça processual.' },
                  pagina: { type: 'NUMBER', description: 'Página do documento PDF.' },
                  paragrafo: { type: 'STRING', nullable: true, description: 'Parágrafo ou item, se identificável.' },
                  trecho_resumido: { type: 'STRING', description: 'Resumo de 1-2 frases do fundamento.' },
                },
              },
              alegado_na_defesa: {
                type: 'BOOLEAN',
                description: 'true se a COPEL alegou litispendência em qualquer peça.',
              },
            },
          },
          suspensao: {
            type: 'OBJECT',
            description:
              'Suspensão do feito: IRDR, tema repetitivo no TST, efeito suspensivo de recurso, acordo de suspensão, determinação judicial ou outro motivo legal. Preencha motivo quando disponível. referencia à decisão ou despacho que determinou a suspensão; null se status=false ou não localizável.',
            required: ['status'],
            properties: {
              status: {
                type: 'BOOLEAN',
                description:
                  'true = processo está ATUALMENTE suspenso por determinação judicial ou legal. false = tramitação normal.',
              },
              motivo: {
                type: 'STRING',
                nullable: true,
                description:
                  'Motivo da suspensão. Obrigatório quando status=true (ex: "Aguardando julgamento do Tema 1046 do TST", "Suspensão por acordo entre as partes"). Null quando status=false.',
              },
              referencia: {
                type: 'OBJECT',
                nullable: true,
                description: 'Referência à decisão ou despacho que determinou a suspensão. Null se status=false.',
                required: ['peca', 'pagina', 'trecho_resumido'],
                properties: {
                  peca: { type: 'STRING', description: 'Nome da peça processual.' },
                  pagina: { type: 'NUMBER', description: 'Página do documento PDF.' },
                  paragrafo: { type: 'STRING', nullable: true, description: 'Parágrafo, se identificável.' },
                  trecho_resumido: { type: 'STRING', description: 'Resumo do fundamento da suspensão.' },
                },
              },
            },
          },
        },
      },
      prescricao: {
        type: 'OBJECT',
        nullable: true,
        description:
          'Análise de prescrição (quinquenal, bienal ou intercorrente). Avalie especialmente risco de prescrição intercorrente por paralisação superior a 2 anos por inércia do exequente (art. 11-A CLT). Null SOMENTE se não houver qualquer elemento nos autos para avaliar prescrição.',
        required: ['status', 'tipo'],
        properties: {
          status: {
            type: 'STRING',
            enum: ['ativa', 'extinta', 'risco'],
            description:
              '"ativa" = prazo prescricional correndo sem risco (no sentido do prompt: sem risco imediato de intercorrente). "extinta" = declarada judicialmente. "risco" = paralisação/inércia que pode configurar prescrição intercorrente, ainda não declarada.',
          },
          tipo: {
            type: 'STRING',
            enum: ['quinquenal', 'bienal', 'intercorrente'],
            description:
              'Tipo aplicável. Se mais de um for relevante, use o de maior risco para a defesa.',
          },
          data_limite_proxima: {
            type: 'STRING',
            nullable: true,
            description:
              'Para intercorrente: data em que se completam 2 anos da última intimação sem resposta do exequente (art. 11-A CLT), formato YYYY-MM-DD. Null se não aplicável ou não calculável. A data deve existir no calendário.',
          },
          motivo: {
            type: 'STRING',
            nullable: true,
            description:
              'Fundamento detalhado. Ex: "Exequente intimado em 15/03/2022 sem manifestação; prazo do art. 11-A CLT vence em 15/03/2024." Null se status="ativa" sem risco especial.',
          },
        },
      },
      pendencias_identificadas: {
        type: 'ARRAY',
        description:
          'Lista de pendências concretas encontradas nos autos que demandam ação ou atenção da defesa. Inclua aqui também pendências relativas a alvarás, sindicatos e pedidos quando relevante. Array vazio [] se não houver pendências.',
        items: {
          type: 'OBJECT',
          required: ['tipo', 'urgencia', 'descricao'],
          properties: {
            tipo: {
              type: 'STRING',
              enum: [
                'prazo_recursal',
                'impugnacao_calculos',
                'penhora_iminente',
                'sisbajud',
                'omissao_defesa',
                'diligencia_pendente',
                'intimacao_pendente',
                'alvara',
                'legitimidade_sindical',
                'outro',
              ],
              description:
                'Categoria da pendência. Use "outro" apenas quando nenhuma categoria se aplica; detalhe no campo descricao.',
            },
            urgencia: {
              type: 'STRING',
              enum: ['alta', 'media', 'baixa'],
              description:
                '"alta" = risco financeiro iminente (penhora, SISBAJUD, bloqueio, alvará crítico). "media" = requer ação sem prazo imediato. "baixa" = monitoramento. Prazo processual em curso sem risco financeiro iminente tende a "media" salvo urgência documentada.',
            },
            descricao: {
              type: 'STRING',
              description:
                'Descrição objetiva: O QUE é a pendência + O QUE precisa ser feito. Ex: "Impugnar cálculos do exequente — prazo de 8 dias úteis a partir da intimação de 10/01/2024" ou "Alvará de R$ 50.000 expedido em favor do reclamante em 05/12/2023 — verificar se já foi levantado".',
            },
            referencia: {
              type: 'OBJECT',
              nullable: true,
              description: 'Localização nos documentos onde a pendência foi identificada. Null se não localizável em peça específica.',
              required: ['peca', 'pagina'],
              properties: {
                peca: { type: 'STRING', description: 'Nome da peça processual.' },
                pagina: { type: 'NUMBER', description: 'Página do documento PDF.' },
              },
            },
          },
        },
      },
      pendencias_estrategicas: {
        type: 'STRING',
        nullable: true,
        description:
          'Texto livre: teses de defesa NÃO exploradas pela COPEL que ainda poderiam ser sustentadas. Exemplos: discussão sobre índice de correção monetária (IPCA-E vs TR vs SELIC após EC 113/2021), base de cálculo, limitação temporal da condenação, compensação de valores pagos, excesso de execução, ilegitimidade de substituídos específicos, ausência de contribuição sindical. Inclua aqui também observações sobre representação sindical (legitimidade questionável, substituídos sem vínculo no período) e pedidos com teses defensivas viáveis. Null se não houver teses adicionais identificadas.',
      },
      acoes_recomendadas: {
        type: 'ARRAY',
        description:
          'Próximas ações concretas recomendadas para a defesa da COPEL, em ordem de prioridade (mais urgente primeiro). Array vazio [] se não houver ação recomendada.',
        items: {
          type: 'OBJECT',
          required: ['tipo', 'descricao'],
          properties: {
            tipo: {
              type: 'STRING',
              enum: ['recurso', 'peticao', 'impugnacao', 'embargo', 'manifestacao', 'diligencia', 'monitoramento', 'outro'],
              description:
                'Tipo da ação. Use "outro" somente se nenhum valor se aplicar; detalhe no campo descricao.',
            },
            descricao: {
              type: 'STRING',
              description:
                'Descrição específica: O QUE fazer, COM BASE EM QUÊ (fundamento legal ou processual), e QUAL O OBJETIVO estratégico. Ex: "Interpor agravo de petição contra decisão de fl. 200 que homologou cálculos com IPCA-E — sustentar aplicação da TR até 11/2017 conforme tese da COPEL."',
            },
            prazo_estimado: {
              type: 'STRING',
              nullable: true,
              description:
                'Prazo identificado nos autos para esta ação (ex: "8 dias úteis a partir de 10/01/2024", "antes da audiência de 15/02/2024"). Null se não identificável — NUNCA invente prazos.',
            },
          },
        },
      },
      urgency: {
        type: 'STRING',
        enum: ['maxima', 'alta', 'media', 'baixa'],
        description:
          'Nível mais alto com EVIDÊNCIA DOCUMENTAL. "maxima" = DOIS critérios SIMULTÂNEOS: (a) falha defensiva em preliminar essencial; E (b) risco financeiro imediato (penhora/SISBAJUD iminente, prazo aberto, pagamento indevido — ex.: despacho determinou pagamento de valores em até 15 dias). "alta" = qualquer um: prazo processual em curso; risco iminente de penhora/SISBAJUD; falha defensiva em preliminar essencial. "media" = execução ativa sem prazo aberto (cálculos, aguardando decisão, defesa adequada). "baixa" = suspenso, encerrado, arquivado, sem providência possível. REGRA: execução ativa nunca recebe "baixa" — mínimo é "media".',
      },
      urgency_motivo: {
        type: 'STRING',
        description:
          'OBRIGATÓRIO. Justificativa com evidência documental concreta: cite peça, página e trecho. Ex: "Alta — Despacho de fl. 180 intima a executada para impugnar cálculos em 8 dias (prazo em curso)." Justificativas genéricas como "processo em andamento" são insuficientes.',
      },
      is_coisa_julgada: {
        type: 'BOOLEAN',
        description:
          'true SOMENTE se coisa julgada foi discutida em sentença de 1ª instância ou acórdão de 2ª/3ª instância e houve resultado final da discussão. Deve ser consistente com pressupostos.coisa_julgada.status.',
      },
      is_litispendencia: {
        type: 'BOOLEAN',
        description:
          'true SOMENTE se litispendência foi discutida em sentença de 1ª instância ou acórdão de 2ª/3ª instância e houve resultado final da discussão. Deve ser consistente com pressupostos.litispendencia.status.',
      },
      is_ilegitimidade: {
        type: 'BOOLEAN',
        description:
          'true SOMENTE se ilegitimidade foi discutida em sentença de 1ª instância ou acórdão de 2ª/3ª instância e houve resultado final da discussão. Deve ser consistente com pressupostos.ilegitimidade.status.',
      },
      is_suspenso: {
        type: 'BOOLEAN',
        description:
          'true SOMENTE se o processo está atualmente suspenso por determinação judicial ou legal. Deve ser consistente com pressupostos.suspensao.status.',
      },
      has_recurso_revista: {
        type: 'BOOLEAN',
        description:
          'true SOMENTE com petição de Recurso de Revista ou decisão/despacho admitindo, inadmitindo ou processando RR no TST. false sem evidência documental. Quando true, registre no campo "historico" a matéria objeto do RR e a peça ou despacho correspondente.',
      },
      analise_completa: {
        type: 'BOOLEAN',
        description:
          'true se TODOS os documentos fornecidos foram lidos integralmente sem truncamento, erro de leitura ou corrupção. false se algum documento não pôde ser processado completamente (neste caso, detalhar o problema no campo "historico").',
      },
      documentos_insuficientes: {
        type: 'BOOLEAN',
        description:
          'true se os documentos fornecidos NÃO são suficientes para determinar a fase processual atual ou os principais pedidos/resultados do processo (ex: faltam peças essenciais como sentença ou acórdão). false se permitem análise razoável.',
      },
      requer_prompt_b: {
        type: 'BOOLEAN',
        description:
          'true se a complexidade do processo exige segunda rodada de análise (ex: dezenas de substituídos processuais, cálculos com múltiplos índices e períodos, múltiplas fases recursais sobrepostas). false para complexidade normal.',
      },
      historico: {
        type: 'STRING',
        description:
          'Resumo cronológico em no máximo 10 linhas, apresentado em formato de tópicos e sub-tópicos com a seguinte estrutura: data de ajuizamento e partes; sindicato (nome e papel, se houver — incluindo sindicato originário da ação coletiva/ACP que gerou o direito e sindicato que representa o substituído nesta execução); principais pedidos e resultados (deferido/indeferido/parcial); decisões relevantes e recursos; alvarás expedidos (valor, beneficiário, status de levantamento); fase atual; se has_recurso_revista=true, matéria do RR e peça/despacho correspondente; documentos ilegíveis/truncados (se houver).',
      },
      processado_em: {
        type: 'STRING',
        description: 'Data e hora do processamento no formato ISO 8601 (ex: "2024-01-15T14:30:00Z").',
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
