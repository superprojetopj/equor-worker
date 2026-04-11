import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { ProcessorFlow } from '../planilha-review.processor.js'

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type Preliminar = {
  discutido: boolean
  referencias: {
    peca: string | null
    pagina: number | null
    trecho_resumido: string | null
  }[]
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
      ilegitimidade: Preliminar
      coisa_julgada: Preliminar
      litispendencia: Preliminar
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
3. Para cada preliminar (Ilegitimidade, Coisa Julgada, Litispendência), determinar de forma BOOLEANA se o tema foi DISCUTIDO nos autos (discutido = true/false). Se discutido, fornecer as referências documentais (peça, página, trecho resumido) em um array de referências.
4. Identificar contexto sindical (substituição processual, sindicato originário, representatividade).
5. Verificar existência de Recurso de Revista (petição, despacho, admissibilidade).
6. Avaliar gestão de risco: urgência, pendências, ações recomendadas e teses não exploradas.
7. Retornar exclusivamente um objeto JSON válido conforme o schema do Flow A.

CHECKLIST OBRIGATÓRIO — APLICAR A CADA CAMPO PREENCHIDO:
- Se ultima_movimentacao menciona "TRT", "Relator" ou "redistribuído" → instancia = "SEGUNDA_INSTANCIA"
- Para cada preliminar (ilegitimidade, coisa_julgada, litispendencia): discutido = true se há QUALQUER menção, discussão ou decisão sobre o tema nos autos. discutido = false se o tema não aparece em nenhuma peça.
- Se discutido = true, o array de referencias DEVE conter ao menos uma entrada com peça, página e trecho resumido.
- Se discutido = false, o array de referencias DEVE ser vazio [].
- Se pendencias tem item MEDIA/ALTA → acoes_recomendadas precisa de ação além de MONITORAMENTO

REGRAS INVIOLÁVEIS
- Se a informação não constar nos documentos: use null (campos nullable). Nunca invente, infira ou complemente com conhecimento externo.
- Para cada campo, identifique exatamente qual a peça, qual a página e qual trecho fundamenta a análise e registre isso no campo "referencia" quando aplicável. Sem evidência documental use null.
- Rigor: nunca utilize justificativas genéricas; cite sempre peça, página e trecho documental concreto.
---

REGRAS DE ANÁLISE

1. REGRA DE PRESUNÇÃO (Processos 2014-2023)
Se houver menção a Ilegitimidade, Litispendência ou Coisa Julgada em sentenças ou acórdãos, considere que o tema foi DISCUTIDO nos autos (discutido = true) e registre as referências documentais no array de referencias.
Caso NÃO encontre essas discussões em nenhuma peça, use discutido = false e referencias = [].

2. VERIFICAÇÃO DE DISCUSSÃO — para cada preliminar/prejudicial
Para cada uma das três preliminares (ilegitimidade, coisa_julgada, litispendencia), determine de forma BOOLEANA:
- discutido = true: Se há QUALQUER menção, alegação, análise ou decisão judicial sobre o tema nos documentos (em sentença, acórdão, petição, despacho ou qualquer outra peça).
- discutido = false: Se o tema não aparece em nenhuma peça dos autos.
- Para cada menção ou decisão encontrada, adicione uma entrada no array "referencias" com: peca (nome da peça), pagina (página do PDF), trecho_resumido (resumo de 1-2 frases do trecho relevante).

4. DEFINIÇÕES-CHAVE
- LITISPENDÊNCIA: O autor possui/possuía ação COM PEDIDO IDÊNTICO em curso simultâneo? Se sim, isso foi discutido judicialmente? Qual o resultado?
- COISA JULGADA: O autor possuiu ação COM PEDIDO IDÊNTICO já transitada em julgado? Se sim, a primeira ação foi arquivada ou continua ativa? Isso foi discutido judicialmente?
- ILEGITIMIDADE: Legitimidade passiva da COPEL ou ativa do exequente. Foi questionada? Em qual peça? Resultado judicial?
- PRESCRIÇÃO: Quinquenal, bienal ou intercorrente? Para intercorrente, calcule 2 anos da última intimação sem resposta do exequente (art. 11-A CLT).

5. FILTRO DE LEGITIMIDADE SINDICAL
- Determine se a ação é individual ou se há substituição processual pelo sindicato.
- Identifique o sindicato que deu origem ao direito (na ACP/Ação Coletiva) E qual sindicato atua nesta ação.
- Avalie se o autor é realmente substituído pelo sindicato ou se há ilegitimidade por falta de vínculo/representatividade (conflito_representatividade = true nesse caso).
- CONFLITO SINTEC/STEEM: Verifique especificamente se há conflito entre SINTEC e STEEM. Se o autor pertence ao SINTEC mas a execução deriva de ACP do STEEM (ou vice-versa), isso configura ilegitimidade ativa — marque ilegitimidade.discutido = true e registre a referência documental no array de referencias.

DISTINÇÃO ENTRE SUBSTITUIÇÃO E EXECUÇÃO INDIVIDUAL: is_substituido = true SOMENTE quando o sindicato atua NESTA ação como substituto processual (polo ativo). Se o autor é pessoa física agindo individualmente em cumprimento de sentença coletiva, is_substituido = false, mesmo que a ACP originária tenha sido proposta por sindicato. O campo sindicato_autor refere-se ao sindicato que representa o autor nesta ação específica (não na ACP originária). Se o autor age sozinho com advogado particular, sindicato_autor = null.

6. CLASSIFICAÇÃO DE URGÊNCIA
- "ALTA": Prazos em curso (especialmente < 15 dias), risco de penhora/SISBAJUD imediato, ou falha em preliminar essencial. Cite peça e trecho.
- "MEDIA": Execução ativa aguardando cálculos ou decisões sem prazo imediato. REGRA: execução ativa NUNCA recebe "BAIXA" — mínimo é "MEDIA".
- "BAIXA": Processos suspensos, encerrados ou arquivados sem providência possível.

REGRA COMPLEMENTAR DE URGÊNCIA: Um processo com recurso pendente de julgamento em instância superior, no qual há prazo de contraminuta ou manifestação determinada por despacho, NUNCA recebe "BAIXA". Se houver despacho determinando intimação da COPEL para contraminuta ou resposta, a urgência mínima é "MEDIA". Se o prazo for identificável e inferior a 15 dias, a urgência é "ALTA".

REGRA DE URGÊNCIA — DISTINÇÃO ALTA vs MEDIA: "ALTA" exige evidência documental de prazo concreto inferior a 15 dias OU risco financeiro iminente (penhora, SISBAJUD, bloqueio). Se o despacho determina intimação para contraminuta mas não há como identificar nos autos a data exata de intimação nem o prazo remanescente, a urgência é "MEDIA", não "ALTA". Para classificar como "ALTA", cite no motivo_urgencia: (a) a peça que fixa o prazo, (b) a data de início do prazo, (c) a data de vencimento. Se qualquer desses três elementos for desconhecido, use "MEDIA".

7. PROTOCOLO DE IDENTIFICAÇÃO DE AUTORIDADE E PEÇA
A identificação da instância deve basear-se na autoridade que assina o documento e não apenas no papel timbrado. Documentos assinados por "Juiz do Trabalho" ou "Juiz Titular" devem ser classificados como PRIMEIRA_INSTANCIA (Sentenças ou Despachos). Documentos assinados por "Relator" ou "Desembargador" devem ser classificados como SEGUNDA_INSTANCIA (Acórdãos ou Decisões Monocráticas). Em caso de conflito entre o timbre e a assinatura, a autoridade assinante prevalece para fins de classificação de instância. 
Para identificação de instância: verifique quem ASSINOU cada decisão antes de classificar. Sentença de fl. 34 assinada por "Juiz Titular de Vara" = PRIMEIRA_INSTANCIA / Sentença, nunca SEGUNDA_INSTANCIA / Acórdão.

REGRA DE AUTUAÇÃO EM SEGUNDA INSTÂNCIA: Quando existir nos documentos uma capa de processo com "Agravo de Petição" autuado no TRT com data posterior à última sentença de 1ª instância, E/OU despacho de redistribuição assinado por Desembargador, os autos TRAMITAM HOJE na segunda instância, independentemente de a sentença ter sido proferida por juiz de vara. Verifique sempre se há documento de segundo grau posterior à sentença antes de definir a instância.

REGRA CRÍTICA — SENTENÇA ≠ ACÓRDÃO:
Uma decisão assinada por "Juiz do Trabalho" ou "Juiz Titular de Vara do Trabalho" é SEMPRE uma SENTENÇA de PRIMEIRA_INSTANCIA, mesmo que:
- Tenha sido proferida APÓS um acórdão que determinou o retorno dos autos à origem;
- Esteja em página posterior a um acórdão no PDF;
- Aborde tese que já foi analisada em 2ª instância.

Uma decisão só é ACÓRDÃO se assinada por "Relator", "Desembargador" ou colegiado de Desembargadores.

EXEMPLO CONCRETO DE ERRO A EVITAR: Se o acórdão de 24/01/2025 (assinado pelo Relator Des. Marcus Aurelio Lopes) determinou o retorno dos autos à origem, e em 28/01/2026 o Juiz Paulo Henrique Kretzschmar e Conti proferiu nova sentença → essa decisão de 28/01/2026 é SENTENÇA de PRIMEIRA_INSTANCIA, NÃO acórdão de segunda instância.

TESTE DE VALIDAÇÃO DE INSTÂNCIA: Para cada referência documental, verifique: (1) Qual autoridade assinou? (2) É juiz de vara → PRIMEIRA_INSTANCIA + peça "Sentença" ou "Despacho". É desembargador/relator → SEGUNDA_INSTANCIA + peça "Acórdão" ou "Decisão Monocrática". Se a classificação não passar nesse teste, corrija antes de gerar o JSON.

8. PROTOCOLO DE PREVALÊNCIA CRONOLÓGICA
Ancoragem Temporal: Antes de definir qualquer classificação de risco, identifique a data da ÚLTIMA decisão de mérito em TODOS os documentos anexados. Decisões mais recentes PREVALECEM sobre decisões anteriores — se uma sentença de 2026 extingue o processo por ilegitimidade, essa decisão anula os efeitos de cálculos homologados ou valores apurados em decisões de 2024/2025.
Impacto no Passivo: Se a decisão mais recente (independentemente de instância) rejeitou as pretensões do autor ou extinguiu o processo por preliminar acolhida em favor da COPEL, o passivo deve ser reportado como PROTEGIDO/EXTINTO na análise de risco. Nunca reporte passivo financeiro como exposição ativa se a última sentença foi de improcedência/extinção para o autor. Registre em teses_oportunidades o valor anteriormente calculado como referência histórica, indicando que está protegido pela decisão vigente.
Varredura Obrigatória: Leia TODOS os PDFs anexados até o final antes de definir qualquer campo. Não defina instancia, urgencia ou discutido com base apenas no primeiro documento — a decisão determinante pode estar nas páginas finais do último PDF.
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
  Deve refletir o ato mais recente de TODOS os documentos, não apenas do primeiro PDF.

EXCEÇÃO — REDISTRIBUIÇÃO COMO ATO RELEVANTE: Quando a redistribuição for determinada por Desembargador em razão de prevenção (art. 930 CPC), ela constitui ato com impacto jurídico (define o relator que julgará o recurso) e deve ser considerada como movimentação relevante, não meramente burocrática.

- data_movimentacao: Campo de data (schema: string com format date). Use somente ISO 8601 date YYYY-MM-DD. Data em que o juiz ASSINOU o despacho/sentença ou em que a parte PROTOCOLOU a petição — carimbos de protocolo ou assinaturas digitais. NÃO utilize previsão de intimação, prazos automáticos do sistema ou datas de ciência da parte. Se incongruente (OCR) ou ambígua → null. Verifique o ÚLTIMO documento de TODOS os PDFs anexados antes de definir.
VERIFICAÇÃO DE SAÍDA — INSTÂNCIA: Antes de definir instancia, compare a data da última Sentença (assinada por Juiz de Vara) com a data da última movimentação em TODOS os documentos. Se houver distribuição, redistribuição ou despacho assinado por Desembargador ou Relator em data POSTERIOR à Sentença, a instância é obrigatoriamente SEGUNDA_INSTANCIA. Se o autor interpôs agravo de petição contra a sentença favorável à COPEL e o recurso foi recebido/redistribuído no TRT, o processo TRAMITA HOJE na segunda instância — não na primeira. Certifique-se de que instancia, ultima_movimentacao e data_movimentacao são coerentes entre si.

- suspensao.is_suspenso: true APENAS se o processo está ATUALMENTE suspenso (IRDR, tema repetitivo, efeito suspensivo, acordo, determinação judicial).
- suspensao.motivo: Obrigatório quando is_suspenso = true. null quando is_suspenso = false.
- suspensao.referencia: Decisão/despacho que determinou a suspensão. null quando is_suspenso = false.

2. analise_estrategica_copel.materia_principal
Descreva em 1-2 frases a matéria central do processo. Ex: "Diferenças salariais decorrentes do Plano de Cargos e Salários da COPEL, período 2010-2018".

3. analise_estrategica_copel.preliminares_e_prejudiciais

Para ILEGITIMIDADE, COISA_JULGADA, LITISPENDÊNCIA (mesma estrutura simplificada):
- discutido: BOOLEAN. true se o tema foi mencionado, alegado, analisado ou decidido em qualquer peça dos autos. false se não há qualquer referência ao tema nos documentos.
- referencias: Array de referências documentais. Cada entrada contém: peca (nome da peça), pagina (página do PDF), trecho_resumido (resumo de 1-2 frases do trecho relevante). Inclua uma entrada para CADA peça/decisão que menciona o tema (sentença, acórdão, petição, despacho). Array vazio [] quando discutido = false.

Exemplo para ilegitimidade discutida em sentença e acórdão:
{ "discutido": true, "referencias": [
  { "peca": "Sentença", "pagina": 12, "trecho_resumido": "Rejeitou a preliminar de ilegitimidade ativa arguida pela COPEL." },
  { "peca": "Acórdão", "pagina": 3, "trecho_resumido": "Reformou a sentença e acolheu a ilegitimidade ativa do exequente." }
] }

Exemplo quando NÃO discutida:
{ "discutido": false, "referencias": [] }

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

FILTRO DE PASSIVO REAL: Se a última sentença de mérito extinguiu o processo sem resolução de mérito (ex: por ilegitimidade) ou julgou improcedentes os pedidos do autor, qualquer valor de liquidação ou cálculos homologados em decisão ANTERIOR (ex: sentença homologatória de cálculos posteriormente anulada) deve ser tratado como VALOR AFASTADO. Não reporte esse valor como risco financeiro ativo nem como passivo exposto — reporte-o como sucesso da tese defensiva da COPEL. Em motivo_urgencia, informe que o passivo está protegido pela decisão vigente e que a urgência decorre apenas do recurso pendente do autor (risco de reversão), não do valor em si.

REGRA DE IDENTIFICAÇÃO DO RECORRENTE: Ao descrever pendências e ações relacionadas a recursos (agravo de petição, recurso ordinário, etc.), identifique SEMPRE quem interpôs o recurso. Se a COPEL VENCEU na última instância e o AUTOR recorreu, a pendência da COPEL é RESPONDER ao recurso do autor (contraminuta), não INTERPOR recurso próprio. Nunca descreva "contraminuta ao agravo das rés" quando o agravo foi interposto pelo AUTOR contra decisão favorável à COPEL — o correto é "contraminuta ao agravo do AUTOR".

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

REGRA DE COERÊNCIA INSTÂNCIA ↔ TESES: O texto de teses_oportunidades deve ser coerente com a fase_processual.instancia e com as referencias das preliminares. Se uma peça foi identificada como Sentença de PRIMEIRA_INSTANCIA nas referencias, não a descreva como "acórdão de 2ª instância" no texto de teses. Antes de redigir, releia os campos já preenchidos para garantir consistência.

10. HISTORIO
LIMITE: Máximo 10 itens. Cada item deve ter no máximo 2 linhas. Selecione APENAS os eventos com maior impacto jurídico para a defesa da COPEL. Se houver mais de 10 eventos, priorize: ajuizamento, decisões que alteraram o passivo ou a legitimidade, recursos que mudaram o resultado, e a fase atual.

ORDENAÇÃO: Ordem cronológica real (pela data de assinatura), não pela ordem dos PDFs. Se houve "ida e volta" entre instâncias (acórdão devolvendo à origem, nova sentença), registre na ordem em que ocorreu. A decisão MAIS RECENTE é a que define o estado atual.

Formate cada item como:
<li>[Data ISO] — [Evento jurídico + resultado para COPEL em até 2 linhas] — [Peça / Pág.]</li>
O último item deve ser obrigatoriamente a movimentação mais recente nos autos.

11. metadados
- analise_completa: true se TODOS documentos lidos integralmente sem truncamento. false se algum falhou (detalhar no historico).
- documentos_insuficientes: true se faltam peças essenciais para determinar fase ou pedidos.
- requer_prompt_b: true se complexidade exige segunda rodada (dezenas de substituídos, cálculos complexos).
- processado_em: Data/hora ISO 8601 do momento ATUAL de processamento (data do sistema), NÃO a data dos documentos analisados. Se os documentos contêm eventos de 2025 ou 2026, processado_em deve refletir a data atual do sistema (ex: 2026-04-06T...), nunca uma data retroativa como 2024. Uma data de processamento desatualizada invalida a coerência temporal da análise.

CHECKLIST FINAL — EXECUTE ANTES DE GERAR O JSON:
1. Se ultima_movimentacao menciona "TRT", "Relator", "Desembargador" ou "redistribuído" → instancia DEVE ser "SEGUNDA_INSTANCIA".
2. Para cada preliminar: se discutido = true, o array referencias NÃO pode ser vazio. Se discutido = false, referencias DEVE ser [].
3. Se pendencias_identificadas contém item MEDIA/ALTA → acoes_recomendadas NÃO pode ser só MONITORAMENTO.
4. Se existe movimentação de Desembargador/Relator com data POSTERIOR à última Sentença de Juiz de Vara → instancia NÃO pode ser "PRIMEIRA_INSTANCIA".
5. Se a última sentença extinguiu o processo ou rejeitou pretensões do autor → valores de liquidação anteriores são AFASTADOS, não passivo ativo.
6. processado_em deve ser a data ATUAL do sistema, não uma data retroativa.
7. Verifique quem interpôs cada recurso: se a COPEL venceu e o AUTOR recorreu, a pendência da COPEL é contraminuta (INTIMACAO_PENDENTE), não recurso próprio (PRAZO_RECURSAL).
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

function preliminarSchema(definicao: string) {
  return {
    type: 'OBJECT' as const,
    description: definicao,
    required: ['discutido', 'referencias'],
    properties: {
      discutido: {
        type: 'BOOLEAN',
        description: 'true se o tema foi mencionado, alegado, analisado ou decidido em qualquer peça dos autos. false se não há qualquer referência ao tema nos documentos.',
      },
      referencias: {
        type: 'ARRAY' as const,
        description: 'Referências documentais de cada peça/decisão que menciona o tema. Uma entrada por peça relevante (sentença, acórdão, petição, despacho). Array vazio [] quando discutido = false. Quando discutido = true, deve conter ao menos uma entrada.',
        items: {
          type: 'OBJECT' as const,
          required: ['peca', 'pagina', 'trecho_resumido'],
          properties: {
            peca: { type: 'STRING', nullable: true, description: 'Nome da peça processual.' },
            pagina: { type: 'NUMBER', nullable: true, description: 'Página do documento PDF.' },
            trecho_resumido: { type: 'STRING', nullable: true, description: 'Resumo de 1-2 frases do trecho relevante sobre o tema.' },
          },
        },
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
          description: 'Onde os autos TRAMITAM HOJE, não onde foi a última decisão. Se existir capa de Agravo de Petição autuado no TRT, redistribuição por Desembargador, ou movimentação de tribunal posterior à sentença → SEGUNDA_INSTANCIA. PRIMEIRA_INSTANCIA somente se último ato for de Juiz de Vara sem recurso posterior. VALIDAÇÃO: se ultima_movimentacao mencionar TRT, Relator ou Desembargador, este campo NÃO pode ser PRIMEIRA_INSTANCIA.',
        },
        ultima_movimentacao: {
          type: 'STRING',
          description: 'Estado jurídico atual do processo, não ato burocrático. Redistribuição por Desembargador por prevenção (art. 930 CPC) É ato jurídico relevante. Exemplos válidos: "Sentença Proferida", "Acórdão Proferido", "Agravo de Petição redistribuído ao Relator prevento", "Execução Extinta". Ignore atos de secretaria, juntadas de guia ou intimações automáticas.',
        },
        data_movimentacao: {
          type: 'STRING',
          format: 'date',
          nullable: true,
          description:
            'Data ISO YYYY-MM-DD do evento jurídico mais recente dentre TODOS os documentos anexados. Usar data de assinatura do juiz/desembargador ou protocolo da parte, nunca data de intimação ou prazo. Se redistribuição no TRT for posterior à sentença de Vara, usar data da redistribuição. A data deve existir no calendário (29/02 só em ano bissexto). Se ambígua ou incongruente (OCR) → null.',
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
              'Legitimidade passiva da COPEL ou ativa do exequente. Verifique se foi questionada ou analisada em qualquer peça dos autos.',
            ),
            coisa_julgada: preliminarSchema(
              'Identifique se o autor possuiu ação com pedido idêntico já transitada em julgado. Verifique se o tema foi discutido em qualquer peça dos autos.',
            ),
            litispendencia: preliminarSchema(
              'Identifique se o autor possui/possuía ação com pedido idêntico em curso simultâneo. Verifique se o tema foi discutido em qualquer peça dos autos.',
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
              description: 'true SOMENTE se sindicato atua NESTA ação no polo ativo como substituto processual. false se autor é pessoa física agindo individualmente, mesmo que ACP originária tenha sido proposta por sindicato e mesmo que autor seja filiado a sindicato.',
            },
            sindicato_autor: {
              type: 'STRING',
              nullable: true,
              description: 'Sindicato atuando NESTA ação no polo ativo como substituto processual. null se autor é pessoa física com advogado particular, mesmo que filiado a sindicato. Refere-se ao sindicato nesta ação específica, não na ACP originária.',
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
          description: 'ALTA: prazo concreto < 15 dias com peça, data de início e vencimento identificáveis, OU risco financeiro iminente (penhora/SISBAJUD); se qualquer desses elementos for desconhecido, use MEDIA. MEDIA: execução ativa, recurso pendente com contraminuta, ou processo ativo sem prazo imediato — execução ativa NUNCA é BAIXA. BAIXA: somente processos suspensos, encerrados ou arquivados sem providência possível.',
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
                description: 'PRAZO_RECURSAL = COPEL precisa INTERPOR recurso próprio (prazo para recorrer em curso). INTIMACAO_PENDENTE = COPEL precisa RESPONDER a recurso/petição da parte contrária (contraminuta, resposta, manifestação). NUNCA use PRAZO_RECURSAL para contraminuta — contraminuta é resposta a recurso alheio. Use OUTRO apenas quando nenhuma categoria se aplica.',
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
            'Ações concretas cabíveis com evidência nos autos, ordenadas por prioridade (mais urgente primeiro). MANIFESTACAO vem ANTES de MONITORAMENTO quando ambas estiverem presentes. É esperado e correto retornar [] em muitos casos (sem prazo aberto, sem determinação que exija manifestação, processo suspenso/arquivado sem providência, ou defesa já alinhada aos documentos). Não invente itens genéricos para preencher o array. Itens só quando houver base documental clara.',
          items: {
            type: 'OBJECT',
            required: ['tipo', 'descricao', 'objetivo_estrategico'],
            properties: {
              tipo: {
                type: 'STRING',
                enum: ['RECURSO', 'PETICAO', 'IMPUGNACAO', 'EMBARGO', 'MANIFESTACAO', 'DILIGENCIA', 'MONITORAMENTO', 'OUTRO'],
                description: 'Se há pendência INTIMACAO_PENDENTE, incluir ação MANIFESTACAO antes de MONITORAMENTO. MANIFESTACAO = atuação ativa da COPEL (contraminuta, resposta). MONITORAMENTO = acompanhamento passivo. Se há pendência MEDIA/ALTA, NÃO pode ter SOMENTE MONITORAMENTO. Use OUTRO somente quando nenhum valor se aplica.',
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
        'Resumo cronológico dos PRINCIPAIS eventos, MÁXIMO 10 itens, cada um com no máximo 2 linhas. Formate cada item como: <li>[Data ISO] — [Evento + resultado para COPEL] — [Peça / Pág.]</li>. Priorize: ajuizamento, decisões que alteraram passivo ou legitimidade, recursos com impacto no resultado, e fase atual. Ordem cronológica real. O último item deve ser a movimentação mais recente nos autos.',
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
