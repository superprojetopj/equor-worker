import pino from 'pino'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { getEnv } from '../config/env.js'
import { runTask } from '../lib/task-route.js'
import { transcriptToText } from '../lib/transcript-format.js'
import {
  fetchRecallMediaTaskData,
  reportRecallMediaResult,
} from '../services/backend.service.js'
import { uploadBufferToGCS, uploadStreamToGCS } from '../services/storage.service.js'
import {
  RecallMediaParamsSchema,
  type RecallMediaArtifact,
  type RecallMediaKind,
  type RecallMediaPayload,
  type RecallMediaResultArtifact,
  type RecallMediaResultOutput,
} from '../schemas/recall-media.schema.js'

const log = pino({ name: 'recall-media' })

/**
 * Defesa em profundidade contra SSRF: as URLs vêm do backend autenticado (que
 * as pega da API do Recall), mas se o WORKER_SECRET vazar, este fetch seria um
 * proxy para destino arbitrário. A allow-list limita ao Recall e ao storage
 * dele (S3 presigned), que é para onde o download redireciona.
 */
function assertAllowedMediaUrl(rawUrl: string): void {
  const { hostname, protocol } = new URL(rawUrl)
  if (protocol !== 'https:') {
    throw new Error(`Recall media URL must be https: ${protocol}`)
  }

  const allowed = getEnv()
    .RECALL_MEDIA_ALLOWED_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)

  const host = hostname.toLowerCase()
  const ok = allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  if (!ok) {
    throw new Error(`Recall media URL host not allowed: ${host}`)
  }
}

async function fetchMedia(url: string): Promise<Response> {
  assertAllowedMediaUrl(url)

  return fetch(url, { signal: AbortSignal.timeout(getEnv().RECALL_MEDIA_TIMEOUT_MS) })
}

/**
 * Vídeo: streaming direto da origem para o bucket, sem passar por Buffer.
 * É o único caminho viável — a gravação de uma hora tem centenas de MB.
 */
async function transferVideo(
  artifact: RecallMediaArtifact
): Promise<RecallMediaResultOutput[]> {
  const output = artifact.outputs.find((o) => o.format === 'mp4')
  if (!output) return []

  const response = await fetchMedia(artifact.url)

  if (!response.ok || !response.body) {
    throw new Error(`Recall media download failed: status ${response.status}`)
  }

  const bytes = await uploadStreamToGCS(output.gcs_path, response.body, output.content_type)

  return [{ format: 'mp4', gcs_path: output.gcs_path, bytes }]
}

/**
 * Transcrição: um download, duas saídas.
 *
 * Aqui o buffer em memória é correto — o JSON tem poucos MB —, e é ele que
 * permite gerar o .txt com falante (o que a IA lê) sem baixar duas vezes. O
 * JSON bruto vai junto como fonte para qualquer formato futuro.
 */
async function transferTranscript(
  artifact: RecallMediaArtifact
): Promise<RecallMediaResultOutput[]> {
  const response = await fetchMedia(artifact.url)

  if (!response.ok) {
    throw new Error(`Recall transcript download failed: status ${response.status}`)
  }

  const raw = await response.text()
  const results: RecallMediaResultOutput[] = []

  const jsonOutput = artifact.outputs.find((o) => o.format === 'json')
  if (jsonOutput) {
    const bytes = await uploadBufferToGCS(
      jsonOutput.gcs_path,
      Buffer.from(raw, 'utf8'),
      jsonOutput.content_type
    )
    results.push({ format: 'json', gcs_path: jsonOutput.gcs_path, bytes })
  }

  const txtOutput = artifact.outputs.find((o) => o.format === 'txt')
  if (txtOutput) {
    let text: string
    try {
      text = transcriptToText(JSON.parse(raw))
    } catch (err) {
      // Duas causas caem aqui, e as duas têm a mesma saída certa: o JSON não
      // parseou, ou parseou e não bate com o schema documentado. O conteúdo
      // bruto ainda é a transcrição — anexá-lo como veio é melhor que anexar
      // nada, e MUITO melhor que degradar para vazio, que o backend leria
      // como "reunião sem fala" e fecharia sem transcrição, sem ata e sem erro.
      log.warn({ err }, 'Transcript unusable — attaching raw payload instead')
      text = raw
    }

    // Transcrição vazia (reunião sem fala) não vira anexo: melhor não ter
    // arquivo do que ter um arquivo em branco anexado ao processo. O backend
    // fecha o ciclo pelo JSON bruto, que sobe mesmo assim.
    if (text.trim()) {
      const bytes = await uploadBufferToGCS(
        txtOutput.gcs_path,
        Buffer.from(text, 'utf8'),
        txtOutput.content_type
      )
      results.push({ format: 'txt', gcs_path: txtOutput.gcs_path, bytes })
    }
  }

  return results
}

async function runRecallMediaTask(
  payload: RecallMediaPayload,
  kind: RecallMediaKind
): Promise<void> {
  const { processMeetingId } = payload

  // Fora do try: um vídeo de 600 MB que já está no bucket precisa chegar ao
  // backend MESMO quando algo falha logo depois — senão o retry rebaixa tudo
  // (e o objeto vira órfão no GCS).
  const artifacts: RecallMediaResultArtifact[] = []

  try {
    const taskData = await fetchRecallMediaTaskData(processMeetingId, kind)

    if (taskData.artifacts.length === 0) {
      // Nada pendente: o backend já sabe disso (foi ele quem calculou a lista)
      // e fecha o status sozinho. Reportar mesmo assim mantém uma única porta
      // de saída para o ciclo.
      log.info({ processMeetingId, kind }, 'No pending artifacts')
      await reportRecallMediaResult(processMeetingId, kind, 'DONE', { artifacts: [] })
      return
    }

    for (const artifact of taskData.artifacts) {
      const outputs =
        artifact.kind === 'video'
          ? await transferVideo(artifact)
          : await transferTranscript(artifact)

      if (outputs.length > 0) {
        artifacts.push({ kind: artifact.kind, outputs })
      }
    }

    log.info(
      { processMeetingId, kind, transferred: artifacts.map((a) => a.kind) },
      'Recall media transferred'
    )

    await reportRecallMediaResult(processMeetingId, kind, 'DONE', { artifacts })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(
      { processMeetingId, kind, error: message, partial: artifacts.map((a) => a.kind) },
      'recall media task failed'
    )

    try {
      // O relatório de falha leva o progresso parcial: o backend registra o que
      // já subiu, e a reexecução da task busca só o que falta.
      await reportRecallMediaResult(processMeetingId, kind, 'FAILED', {
        artifacts,
        errorMessage: message,
      })
    } catch (reportError) {
      log.error(
        { processMeetingId, reportError: String(reportError) },
        'Failed to report FAILED status'
      )
    }

    // Sobe para a rota responder 5xx: transferir de novo não cobra nada, então
    // a fila retenta com URLs novas até o teto de tentativas dela.
    throw error
  }
}

/** Uma pipeline por kind: vídeo e transcrição chegam em momentos diferentes. */
function makeRecallMediaHandler(kind: RecallMediaKind) {
  return async function recallMediaHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const payload = RecallMediaParamsSchema.parse(request.body)

    return runTask(reply, {
      key: `recall-${kind}:${payload.processMeetingId}`,
      run: () => runRecallMediaTask(payload, kind),
    })
  }
}

export const recallVideoHandler = makeRecallMediaHandler('video')
export const recallTranscriptHandler = makeRecallMediaHandler('transcript')
