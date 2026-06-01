import pino from 'pino'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { fetchSignDocumentData, reportSignTaskResult } from '../services/backend.service.js'
import { generatePdfFromHtml } from '../services/pdf.service.js'
import { uploadToGCS } from '../services/storage.service.js'
import {
  uploadFileToContraktor,
  addPartyToContraktor,
  createContraktorContract,
  addParticipantToContract,
  dispatchForSignature,
  getShareLink,
} from '../services/contraktor.service.js'
import { dispatch } from '../lib/shutdown.js'
import { SignTaskParamsSchema, SignTaskPayload } from '../schemas/signature.schema.js'

const log = pino({ name: 'sign-task-data' })

async function runSignTask(payload: SignTaskPayload): Promise<void> {
  const { processDocumentId } = payload
  try {
    const { document, signatures } = await fetchSignDocumentData(processDocumentId)

    const pdfBuffer = await generatePdfFromHtml(document.html_content)

    const fileName = `${crypto.randomUUID()}.pdf`
    const [gcsPath, uploadedFile, parties] = await Promise.all([
      uploadToGCS(
        `documents/processes/${processDocumentId}/${fileName}`,
        pdfBuffer
      ),
      uploadFileToContraktor(pdfBuffer, fileName),
      Promise.all(
        signatures.map((s) =>
          addPartyToContraktor({
            party: {
              person_type: 'pf',
              name: s.name,
              email: s.email,
              document: s.cpf,
            },
          })
        )
      ),
    ])

    const contraktorContract = await createContraktorContract({
      contract: {
        title: document.title,
        document: { file_id: uploadedFile.data.id },
        metadata: { process_document_id: String(processDocumentId) },
      },
    })

    const contractId = contraktorContract.data.id
    log.info(
      { processDocumentId, contraktorContractId: contractId },
      'Contraktor contract created'
    )

    await Promise.all(
      signatures.map((signature, i) =>
        addParticipantToContract(contractId, {
          sharing: {
            qualification: signature.party_type,
            party_id: parties[i].data.id,
            notification_type: 'email',
          },
        })
      )
    )

    const proof = await dispatchForSignature({
      proof: {
        contract_id: contractId,
        engine: 'standard',
        ordered: false,
      },
    })

    log.info(
      {
        processDocumentId,
        contraktorContractId: contractId,
        proofId: proof.data.id,
        proofStatus: proof.data.status,
      },
      'Contraktor proof dispatched'
    )

    const shareLinks = await Promise.all(
      proof.data.subjects.map((subject) => getShareLink(proof.data.id, subject.id))
    )

    const signatories = proof.data.subjects.map((subject, i) => ({
      name: subject.name,
      email: subject.email,
      share_link: shareLinks[i].data.sharelink,
    }))

    await reportSignTaskResult(processDocumentId, 'GENERATED', {
      contraktorContractId: String(contractId),
      gcsPath,
      signatories,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ processDocumentId, error: message }, 'sign-task failed')
    try {
      await reportSignTaskResult(processDocumentId, 'FAILED', { errorMessage: message })
    } catch (reportError) {
      const reportMessage =
        reportError instanceof Error ? reportError.message : String(reportError)
      log.error({ processDocumentId, reportError: reportMessage }, 'Failed to report FAILED status')
    }
  }
}

export async function signHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const payload = SignTaskParamsSchema.parse(request.body)

  reply.code(202).send({
    status: 'accepted',
    payload,
  })

  dispatch(runSignTask(payload), { payload })
}
