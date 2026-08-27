/**
 * Converte a transcrição do Recall em texto com falante.
 *
 * O JSON traz timestamp por palavra. Isso é ótimo para legenda e ruim para
 * prompt: timecode ocupa contexto e não ajuda a IA a redigir um acordo. A saída
 * aqui agrupa falas consecutivas do mesmo participante e descarta os tempos —
 * o JSON bruto é guardado ao lado, então nada se perde.
 *
 * ## O formato é conhecido, não adivinhado
 *
 * A URL que baixamos é a `download_url` do artefato, que serve o formato
 * NORMALIZADO da Recall — é exatamente isso que a distingue da
 * `provider_data_download_url`, que traz o cru do provider. O schema é:
 *
 *   [{ participant: { id, name, ... }, language_code, words: [{ text, ... }] }]
 *
 * Este arquivo já tentou adivinhar nomes alternativos de campo ("speaker",
 * "speaker_name", "text" no segmento) por medo de variação entre providers.
 * Era proteção contra o risco errado: variação de provider não passa por esta
 * URL. E o custo era alto — ver abaixo.
 *
 * ## Formato irreconhecível PRECISA gritar
 *
 * Degradar para string vazia era a pior saída possível. O worker não anexa
 * arquivo em branco, e o backend lê "JSON cru salvo, nenhum .txt" como
 * transcrição legitimamente vazia — reunião sem fala — e fecha o ciclo em DONE.
 * Uma mudança de schema ficaria indistinguível de uma sala silenciosa: sem
 * transcrição, sem ata, sem erro, sem ninguém avisado.
 *
 * Por isso o que não bate com o schema documentado lança. Quem chama já trata:
 * anexa o conteúdo bruto e registra o motivo no log.
 */

type UnknownRecord = Record<string, unknown>

/** Schema documentado não reconhecido — quem chama cai para o texto cru. */
export class TranscriptFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptFormatError'
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

/**
 * Nome do falante. `participant.name` é documentado como anulável (bot sem
 * identificação, participante anônimo), e aí o id ainda distingue quem é quem —
 * um "[Participante]" repetido colaria falas de pessoas diferentes num bloco só.
 */
function speakerOf(participant: unknown): string {
  if (!isRecord(participant)) return 'Participante'

  if (typeof participant.name === 'string' && participant.name.trim()) {
    return participant.name.trim()
  }

  return typeof participant.id === 'number'
    ? `Participante ${participant.id}`
    : 'Participante'
}

function textOf(words: unknown): string {
  if (!Array.isArray(words)) return ''

  return words
    .map((word) => (isRecord(word) && typeof word.text === 'string' ? word.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

/**
 * Texto legível a partir do JSON da transcrição. Falas consecutivas do mesmo
 * participante viram um bloco só.
 *
 * String vazia significa UMA coisa só: a transcrição existe e não tem fala
 * nenhuma (array vazio). Qualquer outra surpresa lança.
 *
 * @throws {TranscriptFormatError} quando o JSON não segue o schema documentado
 */
export function transcriptToText(raw: unknown): string {
  if (!Array.isArray(raw)) {
    throw new TranscriptFormatError(
      `Expected a top-level array of segments, got ${raw === null ? 'null' : typeof raw}`
    )
  }

  // Reunião sem fala: legítimo, e o backend sabe fechar o ciclo assim.
  if (raw.length === 0) return ''

  const blocks: { speaker: string; parts: string[] }[] = []

  for (const segment of raw) {
    if (!isRecord(segment)) continue

    const text = textOf(segment.words)
    if (!text) continue

    const speaker = speakerOf(segment.participant)
    const last = blocks[blocks.length - 1]

    if (last && last.speaker === speaker) {
      last.parts.push(text)
    } else {
      blocks.push({ speaker, parts: [text] })
    }
  }

  // Havia segmentos e nenhum produziu texto: o schema mudou. Deixar passar como
  // "vazio" faria a reunião fechar sem transcrição e sem ninguém saber.
  if (blocks.length === 0) {
    throw new TranscriptFormatError(
      `${raw.length} segment(s) present but none matched the documented shape ` +
        '(participant + words[].text)'
    )
  }

  return blocks.map((block) => `[${block.speaker}]\n${block.parts.join(' ')}`).join('\n\n') + '\n'
}
