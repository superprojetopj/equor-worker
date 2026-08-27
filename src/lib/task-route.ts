import type { FastifyReply } from 'fastify'

/** Quanto o Cloud Tasks espera antes de tentar de novo. */
const RETRY_AFTER_SECONDS = '30'

type RunTaskOptions = {
  /** Identifica a task no log. Ex.: `recall-video:42`. */
  key: string
  run: () => Promise<void>
  /**
   * `false` faz a rota sempre encerrar a task, mesmo em falha.
   *
   * Existe para trabalho que custa dinheiro ou não é idempotente do outro lado:
   * reexecutar `/signature` cria um SEGUNDO contrato no Contraktor e dispara um
   * segundo e-mail para o signatário — uma pessoa real —, e reexecutar
   * `/ai-generate` é outra fatura pelo mesmo documento. Nesses casos a falha já
   * foi reportada ao backend e o usuário vê o motivo na tela.
   *
   * A mídia do Recall é o oposto: repetir não cobra nada, então ela volta para
   * a fila.
   */
  allowRetry?: boolean
}

/**
 * Executa a task e só então responde.
 *
 * É a resposta que governa a fila: qualquer 2xx encerra a task, 5xx faz o Cloud
 * Tasks reentregar com backoff. Como a conexão fica aberta o tempo todo, o
 * `max_concurrent_dispatches` da fila é o teto real de trabalho simultâneo.
 */
export async function runTask(
  reply: FastifyReply,
  { key, run, allowRetry = true }: RunTaskOptions
): Promise<void> {
  try {
    await run()

    return reply.code(202).send({ status: 'done', key })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!allowRetry) {
      return reply.code(202).send({ status: 'failed', key, message })
    }

    return reply
      .code(503)
      .header('retry-after', RETRY_AFTER_SECONDS)
      .send({ status: 'failed', key, message })
  }
}
