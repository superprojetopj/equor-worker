import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { ProcessorFlow } from '../planilha-review.processor.js'

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type Tese = 'ILEGITIMIDADE' | 'COISA_JULGADA' | 'LITISPENDENCIA'
type ResultadoTese<T extends Tese> = `${T}_ACOLHIDA` | `${T}_REJEITADA` | `${T}_PENDENTE`

type ResultadoInstancia<T extends Tese> = {
  instancia: 'PRIMEIRA_INSTANCIA' | 'SEGUNDA_INSTANCIA' | 'TERCEIRA_INSTANCIA'
  resultado: ResultadoTese<T>
  referencia: {
    peca: string | null
    pagina: number | null
    trecho_resumido: string | null
  }
}

type Preliminar<T extends Tese> = {
  resultado_atual: ResultadoTese<T> | null
  resultados_por_instancia: ResultadoInstancia<T>[]
  detalhes: string | null
}

// ---------------------------------------------------------------------------
// FlowAResult — estrutura retornada pelo Gemini + count_tokens (runtime)
// ---------------------------------------------------------------------------

export type FlowAResult = {
  fase_processual: {
    instancia: 'PRIMEIRA_INSTANCIA' | 'SEGUNDA_INSTANCIA' | 'TERCEIRA_INSTANCIA'
    ultima_movimentacao: string
    data_movimentacao: string | null
    suspensao: {
      is_suspenso: boolean
      motivo: string | null
      referencia: {
        peca: string | null
        pagina: number | null
        trecho_resumido: string | null
      }
    }
  }
  analise_estrategica_copel: {
    materia_principal: string
    preliminares_e_prejudiciais: {
      ilegitimidade: Preliminar<'ILEGITIMIDADE'>
      coisa_julgada: Preliminar<'COISA_JULGADA'>
      litispendencia: Preliminar<'LITISPENDENCIA'>
      prescricao: {
        status: 'ATIVA' | 'EXTINTA' | 'RISCO'
        tipo: 'QUINQUENAL' | 'BIENAL' | 'INTERCORRENTE'
        data_limite: string | null
        fundamentacao: string | null
      } | null
    }
    contexto_sindical: {
      is_substituido: boolean
      sindicato_autor: string | null
      sindicato_origem_acp: string | null
      conflito_representatividade: boolean
    }
    recurso_revista: {
      existe: boolean
      status_admissibilidade: 'ADMITIDO' | 'INADMITIDO' | 'PENDENTE' | null
      materia_objeto: string | null
      referencia: { peca: string; pagina: number } | null
    }
  }
  gestao_de_risco: {
    urgencia: 'ALTA' | 'MEDIA' | 'BAIXA'
    motivo_urgencia: string
    pendencias_identificadas: {
      tipo: string
      urgencia: 'ALTA' | 'MEDIA' | 'BAIXA'
      descricao: string
      referencia: { peca: string; pagina: number } | null
    }[]
    acoes_recomendadas: {
      tipo: string
      descricao: string
      objetivo_estrategico: string
      prazo_estimado: string | null
    }[]
    teses_oportunidades: string | null
  }
  historico: string
  metadados: {
    analise_completa: boolean
    documentos_insuficientes: boolean
    requer_prompt_b: boolean
    processado_em: string
  }
  /** Adicionado em runtime pelo processor — não faz parte do schema Gemini */
  count_tokens: number
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const FLOW_A_PROMPT = `
IDENTIDADE
Você é um Especialista em Estratégia Jurídica focado na defesa da COPEL. Sua missão é analisar os documentos anexados sob a ótica EXCLUSIVA da Ré (executada/COPEL). Toda interpretação, classificação e recomendação deve ser feita do ponto de vista dos interesses defensivos da COPEL.

CONTEXTO
- Tribunal: TRT-9 (9ª Região – Paraná)
- Parte reclamada: COPEL
- Período de interesse: 2014 a dezembro de 2023
- Fase esperada: execução trabalhista (individual ou coletiva)

OBJETIVO
O objetivo principal é avaliar e responder se há/houve discussão a respeito das preliminares e prejudiciais de mérito: Ilegitimidade, Litispendência, Coisa Julgada e Prescrição.

INSTRUÇÕES
Leia integralmente todos os documentos anexados e extraia uma análise estratégica estruturada em JSON, seguindo rigorosamente o schema fornecido.
1. Identificar a matéria principal discutida nos autos.
2. Mapear as preliminares e prejudiciais de mérito: Ilegitimidade, Litispendência, Coisa Julgada e Prescrição.
3. Para cada preliminar/prejudicial, rastrear a discussão em sentença (1ª instância), acórdão (2ª/3ª instância) e resultado final.
4. Identificar contexto sindical (substituição processual, sindicato originário, representatividade).
5. Verificar existência de Recurso de Revista (petição, despacho, admissibilidade).
6. Avaliar gestão de risco: urgência, pendências, ações recomendadas e teses não exploradas.
7. Retornar exclusivamente um objeto JSON válido conforme o schema do Flow A.

CHECKLIST OBRIGATÓRIO — APLICAR A CADA CAMPO PREENCHIDO:
- Se ultima_movimentacao menciona "TRT", "Relator" ou "redistribuído" → instancia = "SEGUNDA_INSTANCIA"
- Se trecho_resumido menciona "pendente de julgamento" → resultado_atual = "*_PENDENTE"
- Se a sentença REJEITOU os pedidos do AUTOR → a tese da COPEL foi ACOLHIDA (não REJEITADA)
- Se pendencias tem item MEDIA/ALTA → acoes_recomendadas precisa de ação além de MONITORAMENTO

REGRAS INVIOLÁVEIS
- Se a informação não constar nos documentos: use null (campos nullable). Nunca invente, infira ou complemente com conhecimento externo.
- Para cada campo, identifique exatamente qual a peça, qual a página e qual trecho fundamenta a análise e registre isso no campo "referencia" quando aplicável. Sem evidência documental use null.
- Rigor: nunca utilize justificativas genéricas; cite sempre peça, página e trecho documental concreto.
---

REGRAS DE ANÁLISE

1. REGRA DE PRESUNÇÃO (Processos 2014-2023)
Se houver menção a Ilegitimidade, Litispendência ou Coisa Julgada em sentenças ou acórdãos, considere que a defesa da COPEL os alegou oportunamente e registre isso em "detalhes" (não exija peça de defesa nos autos para reconhecer a discussão).
Caso NÃO encontre essas discussões em nenhuma peça, use em "detalhes": "Preliminar não encontrada nos autos.", resultado_judicial = null e referencia com todos os campos null: { "peca": null, "pagina": null, "trecho_resumido": null }.

2. RASTREAMENTO DE TESES — para cada preliminar/prejudicial
- Foi discutida em sentença de 1ª instância? Qual o resultado?
- Foi discutida em acórdão de 2ª ou 3ª instância? Qual o resultado?
- A matéria foi reiterada pela defesa ao longo do processo ou houve preclusão/cessação?
- Determine o resultado final usando o valor autodescritivo (ex: ILEGITIMIDADE_ACOLHIDA, COISA_JULGADA_REJEITADA, LITISPENDENCIA_PENDENTE — ver regra 3).
- Registre toda essa trajetória no campo "detalhes".

3. CLASSIFICAÇÃO DE resultado_atual e resultados_por_instancia — PERSPECTIVA DA DEFESA DA COPEL
Os campos de resultado refletem o sucesso ou insucesso das TESES DEFENSIVAS da COPEL e usam valores autodescritivos com o nome da tese como prefixo:
- Ilegitimidade: "ILEGITIMIDADE_ACOLHIDA" | "ILEGITIMIDADE_REJEITADA" | "ILEGITIMIDADE_PENDENTE"
- Coisa Julgada: "COISA_JULGADA_ACOLHIDA" | "COISA_JULGADA_REJEITADA" | "COISA_JULGADA_PENDENTE"
- Litispendência: "LITISPENDENCIA_ACOLHIDA" | "LITISPENDENCIA_REJEITADA" | "LITISPENDENCIA_PENDENTE"

LÓGICA DE ESPELHO DA DEFESA — aplique SEMPRE ao classificar resultados:
O objeto da classificação é a TESE DA COPEL, não o pedido do autor. As seguintes situações são SEMPRE vitória para a COPEL e devem ser classificadas como _ACOLHIDA:
- "Acolheu a ilegitimidade ativa / passiva"
- "Rejeitou as pretensões do autor"
- "Extinguiu o processo sem resolução do mérito"
- "Reconheceu a ilegitimidade do exequente"
- "Declarou a coisa julgada / litispendência"
Nunca use _REJEITADA para uma tese que a COPEL venceu. O sufixo _REJEITADA significa que a tese defensiva da COPEL foi afastada (o autor venceu aquele ponto). Quando a COPEL vencer, registre no campo detalhes: "Tese [nome] acolhida — pedidos do autor rejeitados neste ponto."

REPETIÇÃO DE SEGURANÇA: Ao classificar os resultados, aplique a perspectiva da Executada (COPEL). Se a decisão judicial indicar que os pedidos do Exequente foram REJEITADOS ou que o processo foi EXTINTO em razão de uma preliminar arguida pela Ré, o campo resultado_judicial deve ser obrigatoriamente marcado como ACOLHIDA (referindo-se ao acolhimento da tese defensiva). A tese só deve ser marcada como REJEITADA se o juiz afastar expressamente o argumento da COPEL e der seguimento ao pedido do autor naquele ponto específico.

Semântica:
- *_ACOLHIDA: A tese da COPEL foi aceita pelo tribunal — E NÃO HÁ RECURSO PENDENTE contra essa decisão.
- *_REJEITADA: A tese defensiva da COPEL foi expressamente afastada (o autor venceu o ponto) — E NÃO HÁ RECURSO PENDENTE contra essa decisão.
- *_PENDENTE: A tese foi alegada e está aguardando decisão, OU já foi decidida mas há recurso recebido contra essa decisão pendente de julgamento (ex: agravo de petição recebido e remetido ao TRT).
- null: Não houve alegação nem análise judicial sobre o tema nos documentos (somente para resultado_atual).

PRIORIDADE DE INSTÂNCIA: resultado_atual deve sempre refletir a instância mais alta que decidiu. Se a sentença rejeitou mas o acórdão acolheu → resultado_atual = "ILEGITIMIDADE_ACOLHIDA". O array resultados_por_instancia registra a trajetória completa (ambas as entradas). Se a decisão favorável à COPEL é objeto de recurso recebido e pendente, use *_PENDENTE, não *_ACOLHIDA.
VALIDAÇÃO CRUZADA: Após preencher resultado_atual, releia detalhes e trecho_resumido do último item de resultados_por_instancia. Se mencionarem "pendente de julgamento" ou "recurso pendente", resultado_atual NÃO pode ser *_ACOLHIDA — deve ser *_PENDENTE.

REGRA DE PENDÊNCIA RECURSAL — APLICAÇÃO OBRIGATÓRIA:
Quando a decisão mais recente favorável à COPEL for objeto de recurso RECEBIDO e pendente de julgamento, resultado_atual DEVE ser "*_PENDENTE", NUNCA "*_ACOLHIDA". O sufixo _ACOLHIDA só pode ser usado quando a decisão favorável à COPEL transitou em julgado OU quando não há recurso pendente contra ela.

EXEMPLO CONCRETO: Se a sentença de 1ª instância reconheceu a ilegitimidade ativa do autor (vitória da COPEL), MAS o autor interpôs agravo de petição que foi recebido e remetido ao TRT → resultado_atual = "ILEGITIMIDADE_PENDENTE" (não ACOLHIDA). Em resultados_por_instancia, a entrada da 1ª instância registra "ILEGITIMIDADE_ACOLHIDA". Em detalhes, registre: "Tese de ilegitimidade acolhida em 1ª instância (Sentença de [data], fl. X), porém pendente de confirmação em 2ª instância em razão de agravo de petição do autor recebido em [data] (fl. Y)."

CONTRAEXEMPLO: Se a sentença de 1ª instância reconheceu a ilegitimidade e NÃO houve recurso (prazo escoou sem manifestação) → resultado_atual = "ILEGITIMIDADE_ACOLHIDA".

CHECKLIST DE VALIDAÇÃO: Antes de definir resultado_atual, responda: (1) Existe recurso recebido contra a última decisão sobre esta tese? Se SIM → _PENDENTE. Se NÃO → _ACOLHIDA ou _REJEITADA conforme o resultado.

4. DEFINIÇÕES-CHAVE
- LITISPENDÊNCIA: O autor possui/possuía ação COM PEDIDO IDÊNTICO em curso simultâneo? Se sim, isso foi discutido judicialmente? Qual o resultado?
- COISA JULGADA: O autor possuiu ação COM PEDIDO IDÊNTICO já transitada em julgado? Se sim, a primeira ação foi arquivada ou continua ativa? Isso foi discutido judicialmente?
- ILEGITIMIDADE: Legitimidade passiva da COPEL ou ativa do exequente. Foi questionada? Em qual peça? Resultado judicial?
- PRESCRIÇÃO: Quinquenal, bienal ou intercorrente? Para intercorrente, calcule 2 anos da última intimação sem resposta do exequente (art. 11-A CLT).

5. FILTRO DE LEGITIMIDADE SINDICAL
- Determine se a ação é individual ou se há substituição processual pelo sindicato.
- Identifique o sindicato que deu origem ao direito (na ACP/Ação Coletiva) E qual sindicato atua nesta ação.
- Avalie se o autor é realmente substituído pelo sindicato ou se há ilegitimidade por falta de vínculo/representatividade (conflito_representatividade = true nesse caso).
- CONFLITO SINTEC/STEEM: Verifique especificamente se há conflito entre SINTEC e STEEM. Se o autor pertence ao SINTEC mas a execução deriva de ACP do STEEM (ou vice-versa), isso configura ilegitimidade ativa — verifique se a tese de ilegitimidade arguida pela COPEL foi acolhida pelo TRT-9 e registre o resultado em ilegitimidade.resultado_atual como "ILEGITIMIDADE_ACOLHIDA" caso o tribunal tenha concordado com a defesa da COPEL.

DISTINÇÃO ENTRE SUBSTITUIÇÃO E EXECUÇÃO INDIVIDUAL: is_substituido = true SOMENTE quando o sindicato atua NESTA ação como substituto processual (polo ativo). Se o autor é pessoa física agindo individualmente em cumprimento de sentença coletiva, is_substituido = false, mesmo que a ACP originária tenha sido proposta por sindicato. O campo sindicato_autor refere-se ao sindicato que representa o autor nesta ação específica (não na ACP originária). Se o autor age sozinho com advogado particular, sindicato_autor = null.

6. CLASSIFICAÇÃO DE URGÊNCIA
- "ALTA": Prazos em curso (especialmente < 15 dias), risco de penhora/SISBAJUD imediato, ou falha em preliminar essencial. Cite peça e trecho.
- "MEDIA": Execução ativa aguardando cálculos ou decisões sem prazo imediato. REGRA: execução ativa NUNCA recebe "BAIXA" — mínimo é "MEDIA".
- "BAIXA": Processos suspensos, encerrados ou arquivados sem providência possível.

REGRA COMPLEMENTAR DE URGÊNCIA: Um processo com recurso pendente de julgamento em instância superior, no qual há prazo de contraminuta ou manifestação determinada por despacho, NUNCA recebe "BAIXA". Se houver despacho determinando intimação da COPEL para contraminuta ou resposta, a urgência mínima é "MEDIA". Se o prazo for identificável e inferior a 15 dias, a urgência é "ALTA".

REGRA DE URGÊNCIA — DISTINÇÃO ALTA vs MEDIA: "ALTA" exige evidência documental de prazo concreto inferior a 15 dias OU risco financeiro iminente (penhora, SISBAJUD, bloqueio). Se o despacho determina intimação para contraminuta mas não há como identificar nos autos a data exata de intimação nem o prazo remanescente, a urgência é "MEDIA", não "ALTA". Para classificar como "ALTA", cite no motivo_urgencia: (a) a peça que fixa o prazo, (b) a data de início do prazo, (c) a data de vencimento. Se qualquer desses três elementos for desconhecido, use "MEDIA".

7. PROTOCOLO DE IDENTIFICAÇÃO DE AUTORIDADE E PEÇA
A identificação da instância deve basear-se na autoridade que assina o documento e não apenas no papel timbrado. Documentos assinados por "Juiz do Trabalho" ou "Juiz Titular" devem ser classificados como PRIMEIRA_INSTANCIA (Sentenças ou Despachos). Documentos assinados por "Relator" ou "Desembargador" devem ser classificados como SEGUNDA_INSTANCIA (Acórdãos ou Decisões Monocráticas). Em caso de conflito entre o timbre e a assinatura, a autoridade assinante prevalece para fins de classificação de instância. 
Para resultados_por_instancia: verifique quem ASSINOU cada decisão antes de classificar. Sentença de fl. 34 assinada por "Juiz Titular de Vara" = PRIMEIRA_INSTANCIA / Sentença, nunca SEGUNDA_INSTANCIA / Acórdão.

REGRA DE AUTUAÇÃO EM SEGUNDA INSTÂNCIA: Quando existir nos documentos uma capa de processo com "Agravo de Petição" autuado no TRT com data posterior à última sentença de 1ª instância, E/OU despacho de redistribuição assinado por Desembargador, os autos TRAMITAM HOJE na segunda instância, independentemente de a sentença ter sido proferida por juiz de vara. Verifique sempre se há documento de segundo grau posterior à sentença antes de definir a instância.

REGRA CRÍTICA — SENTENÇA ≠ ACÓRDÃO:
Uma decisão assinada por "Juiz do Trabalho" ou "Juiz Titular de Vara do Trabalho" é SEMPRE uma SENTENÇA de PRIMEIRA_INSTANCIA, mesmo que:
- Tenha sido proferida APÓS um acórdão que determinou o retorno dos autos à origem;
- Esteja em página posterior a um acórdão no PDF;
- Aborde tese que já foi analisada em 2ª instância.

Uma decisão só é ACÓRDÃO se assinada por "Relator", "Desembargador" ou colegiado de Desembargadores.

EXEMPLO CONCRETO DE ERRO A EVITAR: Se o acórdão de 24/01/2025 (assinado pelo Relator Des. Marcus Aurelio Lopes) determinou o retorno dos autos à origem, e em 28/01/2026 o Juiz Paulo Henrique Kretzschmar e Conti proferiu nova sentença → essa decisão de 28/01/2026 é SENTENÇA de PRIMEIRA_INSTANCIA, NÃO acórdão de segunda instância. Em resultados_por_instancia, registre como { "instancia": "PRIMEIRA_INSTANCIA", "resultado": "...", "referencia": { "peca": "Sentença", ... } }.

TESTE DE VALIDAÇÃO: Para cada entrada em resultados_por_instancia, verifique: (1) Qual autoridade assinou? (2) É juiz de vara → PRIMEIRA_INSTANCIA + peça "Sentença" ou "Despacho". É desembargador/relator → SEGUNDA_INSTANCIA + peça "Acórdão" ou "Decisão Monocrática". Se a classificação não passar nesse teste, corrija antes de gerar o JSON.
---

INSTRUÇÕES CAMPO A CAMPO (mesma ordem do schema)

1. fase_processual
- instancia: Onde os autos TRAMITAM HOJE (não onde houve a última decisão). Se houve baixa do TST ao TRT → "SEGUNDA_INSTANCIA". Se retornaram à Vara → "PRIMEIRA_INSTANCIA". Para determinar a instância onde os autos tramitam HOJE, realize uma varredura em todos os arquivos anexados e identifique o protocolo ou autuação mais recente. Se houver movimentação em tribunal superior (TRT ou TST) posterior à última sentença da Vara, a instância atual deve ser atualizada para a instância superior, mesmo que o arquivo anterior mostre o processo na origem. A data_movimentacao deve ser a do evento jurídico mais recente identificado no conjunto total de documentos.

VERIFICAÇÃO OBRIGATÓRIA DE INSTÂNCIA: Após definir a instância, confirme que não existe nenhum documento posterior (em qualquer arquivo anexado) que indique tramitação em instância diferente. Se existir um segundo PDF com capa de "Agravo de Petição" no TRT com data de autuação posterior à sentença, a instância DEVE ser SEGUNDA_INSTANCIA. Esta verificação é obrigatória e deve ser realizada cruzando TODOS os documentos antes de gerar o JSON.
VALIDAÇÃO CRUZADA: Após preencher instancia, releia motivo_urgencia e ultima_movimentacao. Se esses campos mencionarem "2ª instância" ou "TRT", instancia NÃO pode ser "PRIMEIRA_INSTANCIA".

- ultima_movimentacao: Informe o ESTADO JURÍDICO atual do processo, não o ato burocrático. Priorize eventos com impacto jurídico real:
  ✓ USE: "Sentença Proferida", "Execução Extinta", "Acórdão Proferido", "Recurso de Revista Inadmitido", "Sentença Homologatória de Cálculos", "Determinação de Retorno à Origem", "Penhora Efetivada", "Agravo de Petição redistribuído ao Relator prevento".
  ✗ EVITE: "Aguardando manifestação da União", "Juntada de Guia", "Expedição de Notificação", atos de secretaria ou intimações automáticas do sistema.
  Se o último ato jurídico relevante preceder atos burocráticos mais recentes, informe o ato jurídico e ignore os burocráticos.

EXCEÇÃO — REDISTRIBUIÇÃO COMO ATO RELEVANTE: Quando a redistribuição for determinada por Desembargador em razão de prevenção (art. 930 CPC), ela constitui ato com impacto jurídico (define o relator que julgará o recurso) e deve ser considerada como movimentação relevante, não meramente burocrática.

- data_movimentacao: Campo de data (schema: string com format date). Use somente ISO 8601 date YYYY-MM-DD. Data em que o juiz ASSINOU o despacho/sentença ou em que a parte PROTOCOLOU a petição — carimbos de protocolo ou assinaturas digitais. NÃO utilize previsão de intimação, prazos automáticos do sistema ou datas de ciência da parte. Se incongruente (OCR) ou ambígua → null.
- suspensao.is_suspenso: true APENAS se o processo está ATUALMENTE suspenso (IRDR, tema repetitivo, efeito suspensivo, acordo, determinação judicial).
- suspensao.motivo: Obrigatório quando is_suspenso = true. null quando is_suspenso = false.
- suspensao.referencia: Decisão/despacho que determinou a suspensão. null quando is_suspenso = false.

2. analise_estrategica_copel.materia_principal
Descreva em 1-2 frases a matéria central do processo. Ex: "Diferenças salariais decorrentes do Plano de Cargos e Salários da COPEL, período 2010-2018".

3. analise_estrategica_copel.preliminares_e_prejudiciais

Para ILEGITIMIDADE, COISA_JULGADA, LITISPENDÊNCIA (mesma estrutura):
- resultado_atual: resultado da instância mais alta que já se pronunciou (ver regra 3). Use o valor autodescritivo correspondente (ex: "ILEGITIMIDADE_ACOLHIDA"). null se nunca analisada judicialmente.
- resultados_por_instancia: array com uma entrada por instância que analisou a tese, em ordem cronológica. Inclua apenas instâncias com decisão documentada nos autos.
  Ex para ilegitimidade: [{ "instancia": "PRIMEIRA_INSTANCIA", "resultado": "ILEGITIMIDADE_REJEITADA", "referencia": { "peca": "Sentença", "pagina": 12, "trecho_resumido": "..." } },
                          { "instancia": "SEGUNDA_INSTANCIA",  "resultado": "ILEGITIMIDADE_ACOLHIDA",  "referencia": { "peca": "Acórdão", "pagina": 3, "trecho_resumido": "..." } }]
  Array vazio [] se a tese nunca foi analisada judicialmente.
- detalhes: Trajetória completa da discussão processual. Descreva: em que peça foi alegada (quando identificável), o resultado em cada instância, e qual o resultado final (resultado_atual). Ao final, inclua obrigatoriamente uma frase de RESUMO ESTRATÉGICO indicando se a decisão atual protege ou expõe o passivo da COPEL (ex: "A tese de ilegitimidade foi vitoriosa no TRT-9, protegendo o passivo da COPEL neste processo."). Se não encontrada: "Preliminar não encontrada nos autos."

REGRA DE TRAJETÓRIA COMPLETA: Quando uma tese percorreu múltiplas decisões (ex: sentença inicial favorável ao autor → acórdão devolvendo para nova análise → nova sentença favorável à COPEL → novo agravo de petição pendente), TODAS as etapas devem constar em resultados_por_instancia, incluindo decisões intermediárias que foram posteriormente anuladas ou reformadas. Isso permite rastrear a evolução da tese. Use o campo "trecho_resumido" para indicar quando uma decisão foi posteriormente anulada (ex: "Sentença acolheu pretensões do autor — posteriormente anulada pelo acórdão de 24/01/2025").

EXEMPLO CONCRETO DE TRAJETÓRIA COMPLETA (cenário vai-e-vem entre instâncias):
Se o processo teve: (1) Sentença de 26/03/2024 rejeitando ilegitimidade → (2) Acórdão de 24/01/2025 determinando retorno à origem → (3) Nova sentença de 28/01/2026 acolhendo ilegitimidade → (4) Agravo de petição do autor recebido em 23/02/2026, o array resultados_por_instancia deve ter TRÊS entradas:
[
  { "instancia": "PRIMEIRA_INSTANCIA", "resultado": "ILEGITIMIDADE_REJEITADA", "referencia": { "peca": "Sentença", "pagina": 10, "trecho_resumido": "Acolheu pretensões do autor e reconheceu legitimidade ativa — posteriormente anulada pelo acórdão de 24/01/2025" } },
  { "instancia": "SEGUNDA_INSTANCIA", "resultado": "ILEGITIMIDADE_PENDENTE", "referencia": { "peca": "Acórdão", "pagina": 24, "trecho_resumido": "Determinou retorno dos autos à origem para análise dos embargos à execução — não decidiu mérito da ilegitimidade" } },
  { "instancia": "PRIMEIRA_INSTANCIA", "resultado": "ILEGITIMIDADE_ACOLHIDA", "referencia": { "peca": "Sentença", "pagina": 34, "trecho_resumido": "Rejeitou pretensões do autor reconhecendo ilegitimidade ativa — agravo de petição do autor pendente de julgamento" } }
]
E resultado_atual = "ILEGITIMIDADE_PENDENTE" (porque há agravo recebido pendente).

Para PRESCRIÇÃO:
- status: ATIVA (prazo correndo sem risco imediato), EXTINTA (declarada judicialmente), RISCO (paralisação que pode configurar intercorrente, ainda não declarada).
- tipo: QUINQUENAL, BIENAL ou INTERCORRENTE — cite o de maior risco.
- data_limite: Para intercorrente, calcule 2 anos da última intimação sem resposta do exequente (art. 11-A CLT). YYYY-MM-DD. null se não aplicável.
- fundamentacao: Fundamento detalhado. Ex: "Exequente intimado em 15/03/2022 sem manifestação; prazo do art. 11-A CLT vence em 15/03/2024." null se status = ATIVA sem risco especial.
- null para o objeto inteiro SOMENTE se não houver qualquer elemento nos autos para avaliar prescrição.

4. analise_estrategica_copel.contexto_sindical
- is_substituido: true se há substituição processual pelo sindicato NESTA AÇÃO (sindicato no polo ativo como substituto). false para ação individual, mesmo que a ACP originária tenha sido proposta por sindicato.
- sindicato_autor: Nome do sindicato que atua NESTA ação NO POLO ATIVO como substituto. null se o autor é pessoa física agindo individualmente (mesmo que representado por advogado particular e filiado a algum sindicato).
- sindicato_origem_acp: Sindicato originário da ACP/Ação Coletiva que gerou o direito. null se não aplicável.
- conflito_representatividade: true se há divergência entre o sindicato da ACP originária e o sindicato/categoria a que pertence o autor nesta ação, independentemente de is_substituido.

5. analise_estrategica_copel.recurso_revista
- existe: true SOMENTE com petição de RR ou decisão/despacho admitindo/inadmitindo/processando RR nos documentos.
- status_admissibilidade: ADMITIDO, INADMITIDO, PENDENTE. null se existe = false.
- materia_objeto: Matéria específica objeto do RR. null se existe = false.
- referencia: Peça e página do RR ou despacho de admissibilidade. null se existe = false.

6. gestao_de_risco.urgencia e motivo_urgencia
- urgencia: Nível mais alto com EVIDÊNCIA DOCUMENTAL (ALTA / MEDIA / BAIXA — ver regra 6).
- motivo_urgencia: OBRIGATÓRIO. Cite peça, página e trecho documental concreto. Justificativas genéricas como "processo em andamento" são INSUFICIENTES.

7. gestao_de_risco.pendencias_identificadas
Pendências concretas encontradas nos autos. Para cada:
- tipo: PRAZO_RECURSAL, IMPUGNACAO_CALCULOS, PENHORA_IMINENTE, SISBAJUD, OMISSAO_DEFESA, DILIGENCIA_PENDENTE, INTIMACAO_PENDENTE, ALVARA, LEGITIMIDADE_SINDICAL, OUTRO.
- urgencia: ALTA (risco financeiro iminente), MEDIA (ação necessária sem prazo imediato), BAIXA (monitoramento).
- descricao: O QUE é a pendência + O QUE fazer. Seja específico.
- referencia: peca e pagina. null se não localizável.
Array vazio [] se não houver pendências.

REGRA DE DETECÇÃO DE PENDÊNCIAS: Sempre que um despacho ou decisão determinar intimação de parte para manifestação, resposta ou contraminuta, isso configura pendência identificada se não houver nos autos peça posterior demonstrando o cumprimento. Verifique especificamente: (a) despachos que determinam "intime-se a parte contrária para resposta/contraminuta"; (b) se há peça posterior da parte intimada cumprindo a determinação. Se não houver, registre como pendência.

REGRA DE TIPIFICAÇÃO DE PENDÊNCIAS: Use o tipo que melhor descreve a NATUREZA da pendência, não o contexto processual genérico. Especificamente:
- PRAZO_RECURSAL: quando a COPEL precisa INTERPOR recurso (prazo para recorrer em curso).
- INTIMACAO_PENDENTE: quando a COPEL foi ou será intimada para RESPONDER a recurso/petição da parte contrária (contraminuta, resposta, manifestação).
Não use PRAZO_RECURSAL para descrever uma contraminuta — contraminuta é resposta a recurso alheio, não interposição de recurso próprio.

8. gestao_de_risco.acoes_recomendadas
Ações concretas cabíveis com base NOS AUTOS, em ordem de prioridade (mais urgente primeiro). Só inclua itens quando houver fundamento documental (prazo aberto, decisão que impõe manifestação, pendência que exige resposta, etc.).
- tipo: RECURSO, PETICAO, IMPUGNACAO, EMBARGO, MANIFESTACAO, DILIGENCIA, MONITORAMENTO, OUTRO.
- descricao: O QUE fazer + COM BASE EM QUÊ (fundamento legal/processual).
- objetivo_estrategico: QUAL O OBJETIVO para a defesa da COPEL.
- prazo_estimado: Se identificável nos autos. null — NUNCA invente prazos.
Array vazio [] quando não houver próxima ação a recomendar — situação frequente (ex.: processo suspenso sem medida imediata, execução em curso sem prazo ou provocação para a COPEL, defesa já adequada aos documentos). Não preencha com recomendações genéricas ou especulativas só para não deixar o array vazio.

REGRA DE COERÊNCIA PENDÊNCIA ↔ AÇÃO: Se pendencias_identificadas contiver ao menos um item com urgencia MEDIA ou ALTA, acoes_recomendadas NÃO pode ser array vazio — deve conter ao menos uma ação correspondente à pendência. Inversamente, se pendencias_identificadas for [] e não houver despacho pendente de cumprimento, acoes_recomendadas pode ser [].

REGRA DE PRIORIDADE DE AÇÕES: Quando houver tanto uma ação de MANIFESTACAO (contraminuta/resposta) quanto MONITORAMENTO, a MANIFESTACAO deve vir PRIMEIRO no array (é mais urgente — exige atuação da COPEL), e MONITORAMENTO depois (é passivo — apenas acompanhamento).

9. gestao_de_risco.teses_oportunidades
Texto em parágrafo descrevendo medidas defensivas já protocoladas ou teses ainda não exploradas. Para cada item identificado, o parágrafo deve informar obrigatoriamente os quatro elementos abaixo:
  (a) A MEDIDA ESPECÍFICA: identifique a peça já protocolada ou a medida cabível (ex: "Exceção de Pré-executividade protocolada em fl. 88", "Embargos à Execução opostos em fl. 120", "Agravo de Petição pendente de julgamento", "Impugnação aos cálculos ainda não apresentada").
  (b) A TESE JURÍDICA: fundamento da defesa (ex: "ilegitimidade passiva por sindicato diverso do originário da ACP", "prescrição intercorrente por inércia do exequente", "excesso de execução por aplicação de IPCA-E em vez de SELIC pós EC 113/2021", "base de cálculo incorreta").
  (c) O STATUS: situação atual da medida (ex: "aguardando decisão judicial", "rejeitada em sentença — reiterada em recurso pendente", "ainda não protocolada — prazo em aberto").

REGRA DE JURISPRUDÊNCIA INTERNA: Quando os documentos mencionarem precedentes do próprio TRT-9 (acórdãos em processos semelhantes envolvendo as mesmas partes e a mesma ACP), cite-os como reforço da tese, indicando número do processo, relator e resultado. Esses precedentes são evidência documental (constam nos autos) e não conhecimento externo.

REGRA DE COERÊNCIA INSTÂNCIA ↔ TESES: O texto de teses_oportunidades deve ser coerente com a classificação de instância em resultados_por_instancia. Se a sentença de fls. 34 foi classificada como PRIMEIRA_INSTANCIA no array, não a descreva como "acórdão de 2ª instância" no texto de teses. Antes de redigir, releia os campos já preenchidos para garantir consistência.

10. HISTORIO
PROTOCOLO DE ANÁLISE DE FLUXO: Antes de redigir, mapeie o fluxo de "ida e volta" entre as instâncias. Identifique se houve acórdãos que anularam atos anteriores e determinaram o retorno dos autos à origem (baixa). O histórico deve refletir essa sequência real de eventos, garantindo que a última decisão citada seja a que define o estado atual do passivo e da legitimidade das partes.

ATENÇÃO A FLUXOS NÃO-LINEARES: processos trabalhistas frequentemente têm "vai e vem" entre instâncias (ex.: acórdão que devolve os autos à origem para julgamento de embargos, seguido de nova sentença em 1ª instância). Identifique esse fluxo e registre cada etapa na ordem real em que ocorreu, não na ordem em que as peças aparecem no PDF.

VALIDAÇÃO DE INSTÂNCIA: se o documento mais recente nos autos for de um Tribunal (TRT/TST), a instancia atual deve corresponder a essa instância, independentemente da fase anterior. Verifique coerência antes de gerar o JSON.

REGRA DE COMPLETUDE DO HISTÓRICO: O histórico deve incluir TODAS as decisões judiciais (sentenças, despachos com conteúdo decisório, acórdãos) encontradas nos documentos, em ordem cronológica estrita pela data de assinatura. NÃO omita decisões intermediárias mesmo que tenham sido posteriormente reformadas ou anuladas — indique nesse caso que foram superadas. Se uma decisão aparece em mais de um documento (ex: sentença reproduzida no relatório do acórdão), registre-a apenas uma vez, pela data de assinatura original. A DATA de assinatura do documento prevalece sobre a ordem em que os documentos aparecem nos PDFs.

Gere o histórico em tópicos, formatando cada item como:
<li>[Data ISO] — [Evento jurídico relevante] — [Peça / Página]</li>
O último item deve ser obrigatoriamente a movimentação mais recente nos autos.

Estrutura obrigatória dos tópicos (nessa ordem):
- Ajuizamento: data, partes, matéria principal
- Sindicato: nome, papel e sindicato originário da ACP (se houver)
- Principais decisões de mérito/liquidação em ordem cronológica (cite resultado defensivo da COPEL quando relevante)
- Recursos interpostos e seus resultados
- Alvarás expedidos (valor, beneficiário, status de levantamento), se houver
- Fase atual e instância
- Matéria do Recurso de Revista e despacho, se recurso_revista.existe = true
- Documentos ilegíveis ou truncados, se houver

11. metadados
- analise_completa: true se TODOS documentos lidos integralmente sem truncamento. false se algum falhou (detalhar no historico).
- documentos_insuficientes: true se faltam peças essenciais para determinar fase ou pedidos.
- requer_prompt_b: true se complexidade exige segunda rodada (dezenas de substituídos, cálculos complexos).
- processado_em: Data/hora ISO 8601.

CHECKLIST FINAL — EXECUTE ANTES DE GERAR O JSON:
1. Se ultima_movimentacao menciona "TRT", "Relator", "Desembargador" ou "redistribuído" → instancia DEVE ser "SEGUNDA_INSTANCIA".
2. Se detalhes ou trecho_resumido menciona "pendente de julgamento" ou "recurso pendente" → resultado_atual DEVE conter "_PENDENTE".
3. Se pendencias_identificadas contém item MEDIA/ALTA → acoes_recomendadas NÃO pode ser só MONITORAMENTO.
Se qualquer item falhar, corrija ANTES de retornar o JSON.

FORMATO DE SAÍDA
Retorne APENAS o objeto JSON conforme o schema fornecido em paralelo. Nenhum campo pode ser omitido.

DATAS: YYYY-MM-DD. Devem existir no calendário (29/02 apenas em anos bissextos). Se ambígua → null.
ARRAYS: use [] (vazio) quando não houver itens — nunca use null para arrays.
BOOLEANOS: na dúvida entre true e false, use false (princípio conservador).
ENUMS: use EXATAMENTE os valores listados no schema (UPPERCASE).
`.trim()

// ---------------------------------------------------------------------------
// Schema helpers (reutilizados nos 3 pressupostos)
// ---------------------------------------------------------------------------

const referenciaPecaSchema = {
  type: 'OBJECT' as const,
  nullable: true,
  description: 'Localização nos documentos. null se não localizável.',
  required: ['peca', 'pagina'],
  properties: {
    peca: { type: 'STRING', description: 'Nome da peça processual.' },
    pagina: { type: 'NUMBER', description: 'Página do documento PDF.' },
  },
}

function preliminarSchema(nome: string, definicao: string, tese: 'ILEGITIMIDADE' | 'COISA_JULGADA' | 'LITISPENDENCIA') {
  const enumValues = [`${tese}_ACOLHIDA`, `${tese}_REJEITADA`, `${tese}_PENDENTE`] as const

  const resultadoInstanciaSchema = {
    type: 'OBJECT' as const,
    required: ['instancia', 'resultado', 'referencia'],
    properties: {
      instancia: {
        type: 'STRING',
        enum: ['PRIMEIRA_INSTANCIA', 'SEGUNDA_INSTANCIA', 'TERCEIRA_INSTANCIA'],
        description: 'Instância que proferiu a decisão.',
      },
      resultado: {
        type: 'STRING',
        enum: enumValues,
        description: `Resultado da tese defensiva da COPEL nesta instância. ${enumValues[0]} = tese aceita. ${enumValues[1]} = tese afastada. ${enumValues[2]} = aguardando decisão.`,
      },
      referencia: {
        type: 'OBJECT' as const,
        required: ['peca', 'pagina', 'trecho_resumido'],
        properties: {
          peca: { type: 'STRING', nullable: true, description: 'Nome da peça processual.' },
          pagina: { type: 'NUMBER', nullable: true, description: 'Página do documento PDF.' },
          trecho_resumido: { type: 'STRING', nullable: true, description: 'Resumo de 1-2 frases do fundamento da decisão.' },
        },
      },
    },
  }

  return {
    type: 'OBJECT' as const,
    description: definicao,
    required: ['resultado_atual', 'resultados_por_instancia', 'detalhes'],
    properties: {
      resultado_atual: {
        type: 'STRING',
        nullable: true,
        enum: enumValues,
        description: `Resultado da instância mais alta que já decidiu (perspectiva da defesa da COPEL). ${enumValues[0]} = tese aceita. ${enumValues[1]} = tese afastada. ${enumValues[2]} = aguardando decisão. null = nunca analisada judicialmente. Prevalece sempre a instância mais alta sobre decisões de grau inferior.`,
      },
      resultados_por_instancia: {
        type: 'ARRAY' as const,
        description: 'Trajetória da tese por instância, em ordem cronológica. Inclua apenas instâncias com decisão documentada nos autos. Array vazio [] se nunca analisada.',
        items: resultadoInstanciaSchema,
      },
      detalhes: {
        type: 'STRING',
        description: `Trajetória completa da discussão processual sobre ${nome}: em que peça foi alegada (quando identificável), resultado em cada instância, resultado final (resultado_atual). Ao final, inclua uma frase de RESUMO ESTRATÉGICO indicando se a decisão atual protege ou expõe o passivo da COPEL. Se não encontrada: "Preliminar não encontrada nos autos."`,
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
    'fase_processual',
    'analise_estrategica_copel',
    'gestao_de_risco',
    'historico',
    'metadados',
  ],
  properties: {
    // -----------------------------------------------------------------------
    // 1. FASE PROCESSUAL
    // -----------------------------------------------------------------------
    fase_processual: {
      type: 'OBJECT',
      description: 'Situação processual atual. Determine onde os autos tramitam AGORA — verifique se houve baixa/retorno antes de classificar a instância.',
      required: ['instancia', 'ultima_movimentacao', 'suspensao'],
      properties: {
        instancia: {
          type: 'STRING',
          enum: ['PRIMEIRA_INSTANCIA', 'SEGUNDA_INSTANCIA', 'TERCEIRA_INSTANCIA'],
          description: 'Instância onde os autos se encontram ATUALMENTE. Se houve baixa do TST ao TRT → SEGUNDA_INSTANCIA. Se retornaram à Vara → PRIMEIRA_INSTANCIA.',
        },
        ultima_movimentacao: {
          type: 'STRING',
          description: 'ESTADO JURÍDICO atual do processo — não o ato burocrático mais recente. Prefira eventos com impacto jurídico real. Ex: "Sentença Proferida", "Execução Extinta", "Acórdão Proferido", "Recurso de Revista Inadmitido", "Sentença Homologatória de Cálculos", "Determinação de Retorno à Origem". Ignore atos de secretaria, juntadas de guia ou intimações automáticas do sistema.',
        },
        data_movimentacao: {
          type: 'STRING',
          format: 'date',
          nullable: true,
          description:
            'Tipo lógico: data civil. Valor obrigatoriamente no formato ISO 8601 date (YYYY-MM-DD), ex.: 2023-11-15. Data em que o juiz assinou o despacho/sentença ou em que a parte protocolou a petição — extraída de carimbos de protocolo ou assinatura digital. NÃO use previsão de intimação ou prazos automáticos do sistema. A data deve existir no calendário (29/02 só em ano bissexto). Se incongruente (OCR) ou ambígua → null.',
        },
        suspensao: {
          type: 'OBJECT',
          description: 'Estado de suspensão do processo. Não é preliminar — é estado processual corrente.',
          required: ['is_suspenso'],
          properties: {
            is_suspenso: {
              type: 'BOOLEAN',
              description: 'true = processo ATUALMENTE suspenso por determinação judicial ou legal (IRDR, tema repetitivo, efeito suspensivo, acordo). false = tramitação normal.',
            },
            motivo: {
              type: 'STRING',
              nullable: true,
              description: 'Motivo da suspensão. Obrigatório quando is_suspenso = true. null quando is_suspenso = false.',
            },
            referencia: {
              type: 'OBJECT',
              description: 'Referência à decisão que determinou a suspensão. O objeto é sempre presente — use null nos campos internos quando is_suspenso = false.',
              required: ['peca', 'pagina', 'trecho_resumido'],
              properties: {
                peca: { type: 'STRING', nullable: true, description: 'Nome da peça processual. null quando is_suspenso = false.' },
                pagina: { type: 'NUMBER', nullable: true, description: 'Página do documento PDF. null quando is_suspenso = false.' },
                trecho_resumido: { type: 'STRING', nullable: true, description: 'Resumo do fundamento da suspensão. null quando is_suspenso = false.' },
              },
            },
          },
        },
      },
    },

    // -----------------------------------------------------------------------
    // 2. ANÁLISE ESTRATÉGICA COPEL
    // -----------------------------------------------------------------------
    analise_estrategica_copel: {
      type: 'OBJECT',
      description: 'Análise completa para a estratégia de defesa da COPEL: matéria principal, preliminares, contexto sindical e recurso de revista.',
      required: ['materia_principal', 'preliminares_e_prejudiciais', 'contexto_sindical', 'recurso_revista'],
      properties: {
        materia_principal: {
          type: 'STRING',
          description: 'Matéria central do processo em 1-2 frases. Ex: "Diferenças salariais decorrentes do Plano de Cargos e Salários da COPEL, período 2010-2018".',
        },
        preliminares_e_prejudiciais: {
          type: 'OBJECT',
          description: 'Mapeamento das quatro matérias preliminares/prejudiciais: ilegitimidade, coisa_julgada, litispendencia e prescricao. Aplique a regra de presunção (2014-2023) e rastreie a trajetória de cada tese em cada instância.',
          required: ['ilegitimidade', 'coisa_julgada', 'litispendencia'],
          properties: {
            ilegitimidade: preliminarSchema(
              'ilegitimidade',
              'Legitimidade passiva da COPEL ou ativa do exequente. Verifique se foi questionada, analisada em sentença/acórdão, reiterada e qual o resultado final.',
              'ILEGITIMIDADE',
            ),
            coisa_julgada: preliminarSchema(
              'coisa julgada',
              'Identifique se o autor possuiu ação com pedido idêntico já transitada em julgado. Se identificada, verifique se a primeira ação foi arquivada ou continua ativa. Rastreie discussão em sentença e acórdão.',
              'COISA_JULGADA',
            ),
            litispendencia: preliminarSchema(
              'litispendência',
              'Identifique se o autor possui/possuía ação com pedido idêntico em curso simultâneo. Rastreie discussão em sentença e acórdão e resultado final.',
              'LITISPENDENCIA',
            ),
            prescricao: {
              type: 'OBJECT',
              nullable: true,
              description: 'Análise de prescrição (quinquenal, bienal ou intercorrente). Avalie especialmente risco de prescrição intercorrente por inércia do exequente superior a 2 anos (art. 11-A CLT). null SOMENTE se não houver qualquer elemento nos autos.',
              required: ['status', 'tipo'],
              properties: {
                status: {
                  type: 'STRING',
                  enum: ['ATIVA', 'EXTINTA', 'RISCO'],
                  description: 'ATIVA = prazo correndo sem risco imediato. EXTINTA = declarada judicialmente. RISCO = paralisação/inércia que pode configurar intercorrente, ainda não declarada.',
                },
                tipo: {
                  type: 'STRING',
                  enum: ['QUINQUENAL', 'BIENAL', 'INTERCORRENTE'],
                  description: 'Tipo aplicável. Se mais de um for relevante, use o de maior risco.',
                },
                data_limite: {
                  type: 'STRING',
                  nullable: true,
                  description: 'Para intercorrente: data em que se completam 2 anos da última intimação sem resposta (art. 11-A CLT). YYYY-MM-DD. null se não aplicável.',
                },
                fundamentacao: {
                  type: 'STRING',
                  nullable: true,
                  description: 'Fundamento detalhado. Ex: "Exequente intimado em 15/03/2022 sem manifestação; prazo do art. 11-A CLT vence em 15/03/2024." null se status = ATIVA sem risco.',
                },
              },
            },
          },
        },
        contexto_sindical: {
          type: 'OBJECT',
          description: 'Identifique se a ação é individual ou coletiva com substituição processual. Quando houver, identifique sindicato originário da ACP e sindicato que atua nesta ação.',
          required: ['is_substituido', 'conflito_representatividade'],
          properties: {
            is_substituido: {
              type: 'BOOLEAN',
              description: 'true se há substituição processual pelo sindicato. false para ação individual.',
            },
            sindicato_autor: {
              type: 'STRING',
              nullable: true,
              description: 'Nome do sindicato que atua NESTA ação. null se ação individual.',
            },
            sindicato_origem_acp: {
              type: 'STRING',
              nullable: true,
              description: 'Sindicato originário da ACP/Ação Coletiva que gerou o direito. null se não aplicável.',
            },
            conflito_representatividade: {
              type: 'BOOLEAN',
              description: 'true se há divergência entre sindicatos, questionamento de representatividade, ou substituído sem vínculo comprovado. false caso contrário.',
            },
          },
        },
        recurso_revista: {
          type: 'OBJECT',
          description: 'Existência e status de Recurso de Revista. Só marque existe = true com evidência documental (petição ou despacho).',
          required: ['existe'],
          properties: {
            existe: {
              type: 'BOOLEAN',
              description: 'true SOMENTE com petição de RR ou decisão/despacho admitindo/inadmitindo/processando RR nos documentos. Não presuma.',
            },
            status_admissibilidade: {
              type: 'STRING',
              nullable: true,
              enum: ['ADMITIDO', 'INADMITIDO', 'PENDENTE'],
              description: 'Status da admissibilidade do RR. null se existe = false.',
            },
            materia_objeto: {
              type: 'STRING',
              nullable: true,
              description: 'Matéria específica objeto do recurso de revista. null se existe = false.',
            },
            referencia: referenciaPecaSchema,
          },
        },
      },
    },

    // -----------------------------------------------------------------------
    // 3. GESTÃO DE RISCO
    // -----------------------------------------------------------------------
    gestao_de_risco: {
      type: 'OBJECT',
      description: 'Avaliação de risco, pendências concretas, ações recomendadas e teses não exploradas.',
      required: ['urgencia', 'motivo_urgencia', 'pendencias_identificadas', 'acoes_recomendadas'],
      properties: {
        urgencia: {
          type: 'STRING',
          enum: ['ALTA', 'MEDIA', 'BAIXA'],
          description: 'Nível mais alto com EVIDÊNCIA DOCUMENTAL. ALTA = prazo em curso / penhora iminente / falha em preliminar. MEDIA = execução ativa sem prazo aberto. BAIXA = suspenso/encerrado/arquivado. Execução ativa NUNCA recebe BAIXA.',
        },
        motivo_urgencia: {
          type: 'STRING',
          description: 'OBRIGATÓRIO. Justificativa com evidência documental concreta: cite peça, página e trecho. Justificativas genéricas são insuficientes.',
        },
        pendencias_identificadas: {
          type: 'ARRAY',
          description: 'Lista de pendências concretas que demandam ação ou atenção. Array vazio [] se não houver.',
          items: {
            type: 'OBJECT',
            required: ['tipo', 'urgencia', 'descricao'],
            properties: {
              tipo: {
                type: 'STRING',
                enum: [
                  'PRAZO_RECURSAL', 'IMPUGNACAO_CALCULOS', 'PENHORA_IMINENTE',
                  'SISBAJUD', 'OMISSAO_DEFESA', 'DILIGENCIA_PENDENTE',
                  'INTIMACAO_PENDENTE', 'ALVARA', 'LEGITIMIDADE_SINDICAL', 'OUTRO',
                ],
                description: 'Categoria da pendência. Use OUTRO apenas quando nenhuma se aplica.',
              },
              urgencia: {
                type: 'STRING',
                enum: ['ALTA', 'MEDIA', 'BAIXA'],
                description: 'ALTA = risco financeiro iminente. MEDIA = ação necessária sem prazo imediato. BAIXA = monitoramento.',
              },
              descricao: {
                type: 'STRING',
                description: 'O QUE é a pendência + O QUE precisa ser feito. Seja específico e cite referências.',
              },
              referencia: referenciaPecaSchema,
            },
          },
        },
        acoes_recomendadas: {
          type: 'ARRAY',
          description:
            'Ações concretas cabíveis com evidência nos autos, ordenadas por prioridade. É esperado e correto retornar [] em muitos casos (sem prazo aberto, sem determinação que exija manifestação, processo suspenso/arquivado sem providência, ou defesa já alinhada aos documentos). Não invente itens genéricos para preencher o array. Itens só quando houver base documental clara.',
          items: {
            type: 'OBJECT',
            required: ['tipo', 'descricao', 'objetivo_estrategico'],
            properties: {
              tipo: {
                type: 'STRING',
                enum: ['RECURSO', 'PETICAO', 'IMPUGNACAO', 'EMBARGO', 'MANIFESTACAO', 'DILIGENCIA', 'MONITORAMENTO', 'OUTRO'],
                description: 'Tipo da ação. Use OUTRO somente quando nenhum valor se aplica.',
              },
              descricao: {
                type: 'STRING',
                description: 'O QUE fazer + COM BASE EM QUÊ (fundamento legal ou processual).',
              },
              objetivo_estrategico: {
                type: 'STRING',
                description: 'QUAL O OBJETIVO para a defesa da COPEL. Ex: "Reverter homologação de cálculos com IPCA-E, sustentando TR até 11/2017".',
              },
              prazo_estimado: {
                type: 'STRING',
                nullable: true,
                description: 'Prazo identificado nos autos. null se não identificável — NUNCA invente prazos.',
              },
            },
          },
        },
        teses_oportunidades: {
          type: 'STRING',
          nullable: true,
          description: 'Parágrafo descrevendo medidas defensivas já protocoladas ou teses ainda não exploradas. Para cada item, informe: (a) a medida específica (peça já protocolada ou cabível, ex: "Exceção de Pré-executividade protocolada em fl. 88"); (b) a tese jurídica usada (ex: "ilegitimidade por sindicato diverso", "SELIC pós EC 113/2021"); (c) o status atual (ex: "aguardando decisão", "ainda não protocolada"); (d) o alerta de risco financeiro imediato (ex: "risco de bloqueio via SISBAJUD", "processo parado sem risco imediato"). null se não houver teses ou medidas defensivas a registrar.',
        },
      },
    },

    // -----------------------------------------------------------------------
    // 4. HISTÓRICO
    // -----------------------------------------------------------------------
    historico: {
      type: 'STRING',
      description:
        'Resumo cronológico em tópicos com os principais eventos. Use tags HTML <ul> e <li> para cada tópico. Estrutura obrigatória: data de ajuizamento e partes; sindicato (nome e papel, se houver — incluindo sindicato originário da ACP); principais pedidos e resultados (deferido/indeferido/parcial); decisões relevantes e recursos; alvarás expedidos (valor, beneficiário, status de levantamento); fase atual; se analise_estrategica_copel.recurso_revista.existe = true, matéria do RR e despacho correspondente; documentos ilegíveis ou truncados (se houver).',
    },

    // -----------------------------------------------------------------------
    // 5. METADADOS
    // -----------------------------------------------------------------------
    metadados: {
      type: 'OBJECT',
      description: 'Indicadores de completude e qualidade da análise.',
      required: ['analise_completa', 'documentos_insuficientes', 'requer_prompt_b', 'processado_em'],
      properties: {
        analise_completa: {
          type: 'BOOLEAN',
          description: 'true se TODOS documentos foram lidos integralmente sem truncamento. false se algum falhou (detalhar no historico).',
        },
        documentos_insuficientes: {
          type: 'BOOLEAN',
          description: 'true se faltam peças essenciais para determinar fase ou pedidos. false se permitem análise razoável.',
        },
        requer_prompt_b: {
          type: 'BOOLEAN',
          description: 'true se complexidade exige segunda rodada (dezenas de substituídos, cálculos complexos). false para complexidade normal.',
        },
        processado_em: {
          type: 'STRING',
          description: 'Data/hora do processamento no formato ISO 8601. Ex: "2024-01-15T14:30:00Z".',
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export const flowA: ProcessorFlow = {
  name: 'flow-a',
  prompt: FLOW_A_PROMPT,
  schema,
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
}
