import { z } from 'zod'

/** Payload da Cloud Task. Só o id: o que transferir é decidido no task-data. */
export const RecallMediaParamsSchema = z.object({
  processMeetingId: z.coerce.number().int(),
})

export type RecallMediaPayload = z.infer<typeof RecallMediaParamsSchema>

/**
 * Uma saída = um objeto no bucket. O vídeo tem uma; a transcrição tem duas
 * (o .txt que vira anexo e o JSON bruto, guardado como fonte).
 */
export const RecallMediaOutputSchema = z.object({
  format: z.enum(['mp4', 'txt', 'json']),
  gcs_path: z.string().min(1),
  file_name: z.string().optional(),
  content_type: z.string().min(1),
})

export const RecallMediaKindSchema = z.enum(['video', 'transcript'])

/**
 * Qual pipeline está rodando. Vídeo e transcrição chegam em eventos diferentes
 * do Recall e têm rotas próprias — o kind escolhe os endpoints do backend e a
 * chave de dedup da fila.
 */
export type RecallMediaKind = z.infer<typeof RecallMediaKindSchema>

export const RecallMediaArtifactSchema = z.object({
  kind: RecallMediaKindSchema,
  url: z.url(),
  outputs: z.array(RecallMediaOutputSchema).min(1),
})

/**
 * Resposta do task-data. Lista vazia é legítima: significa que não sobrou nada
 * pendente, ou que o Recall ainda não terminou de preparar o artefato.
 */
export const RecallMediaTaskDataSchema = z.object({
  meeting_id: z.coerce.number().int(),
  process_id: z.coerce.number().int().optional(),
  artifacts: z.array(RecallMediaArtifactSchema),
})

export type RecallMediaOutput = z.infer<typeof RecallMediaOutputSchema>
export type RecallMediaArtifact = z.infer<typeof RecallMediaArtifactSchema>
export type RecallMediaTaskData = z.infer<typeof RecallMediaTaskDataSchema>

/** O que volta para o backend depois da transferência. */
export type RecallMediaResultOutput = {
  format: RecallMediaOutput['format']
  gcs_path: string
  bytes: number
}

export type RecallMediaResultArtifact = {
  kind: RecallMediaArtifact['kind']
  outputs: RecallMediaResultOutput[]
}
