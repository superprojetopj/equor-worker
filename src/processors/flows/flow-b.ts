import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import type { ProcessorFlow } from '../planilha-review.processor.js'

/**
 * Fluxo B — Todos os arquivos da pasta do processo, exceto o PDF principal.
 * Útil para documentos complementares (imagens, planilhas, etc.).
 *
 * Pasta: $HOME/Downloads/EQUOR/Processos/2024-2026/{numero_processo}/
 * Exclui: {numero_processo}.pdf
 *
 * TODO: Preencha o prompt e o schema com as regras reais de extração.
 */
export const flowB: ProcessorFlow = {
  name: 'flow-b',
  prompt: `
TODO: Defina o prompt do fluxo B.
Exemplo: "Analise os documentos complementares e extraia as informações adicionais do processo."
  `.trim(),

  schema: {
    type: 'object',
    properties: {
      // TODO: Defina os campos que o Gemini deve retornar.
      campo_exemplo: {
        type: 'string',
        description: 'Exemplo de campo a ser extraído',
      },
    },
    required: ['campo_exemplo'],
  },

  async getFiles(numero_processo: string): Promise<string[]> {
    const dir = path.join(os.homedir(), 'Downloads', 'EQUOR', 'Processos', '2024-2026', numero_processo)
    const mainPdf = `${numero_processo}.pdf`
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name !== mainPdf)
        .map((e) => path.join(dir, e.name))
    } catch {
      return []
    }
  },
}
