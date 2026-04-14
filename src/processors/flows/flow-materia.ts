import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { ProcessorFlow } from '../planilha-review.processor.js'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
const FLOW_MATERIA_PROMPT = `
Você é um Auditor Jurídico focado em extração de dados para cálculos. Sua tarefa é identificar qual verba FINANCEIRA está sendo objeto desta execução.

### PASSO A PASSO OBRIGATÓRIO:
1. Localize o parágrafo que começa com "DECIDE-SE" ou "ISTO POSTO".
2. Verifique qual o nome da verba citada logo abaixo desses títulos (ex: Adicional de Dupla Função).
3. IGNORE QUALQUER OUTRA MATÉRIA que apareça no resto do documento se ela não for o tema direto da decisão.
4. Se o documento menciona "Art. 66" ou "Art. 67", mas o juiz está decidindo sobre "Dupla Função", você deve IGNORAR os artigos 66 e 67.

### REGRA DE OURO:
- Responda apenas com a verba que impacta o saldo devedor do processo.
- No documento atual, a verba é: Adicional de Dupla Função.

### FORMATO DE SAÍDA:
Retorne EXCLUSIVAMENTE um objeto JSON: {"resumo": "<h3>Matéria Central</h3><ul><li>Descrição da matéria</li></ul>"}.
`.trim();


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
        'Descrição da matéria central discutida no processo.',
    },
  },
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type FlowMateriaGeminiResult = {
  resumo: string
}

export type FlowMateriaResult = FlowMateriaGeminiResult & {
  count_tokens: number
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
export const flowMateria: ProcessorFlow = {
  name: 'flow-materia',
  prompt: FLOW_MATERIA_PROMPT,
  schema,    
  async getFiles(numero_processo: string): Promise<string[]> {
    const dir = path.join(os.homedir(), 'Downloads', 'EQUOR', 'Processos', '2014-2023', numero_processo)
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter(e => e.isFile())
      .map(e => path.join(dir, e.name))
  },
}
