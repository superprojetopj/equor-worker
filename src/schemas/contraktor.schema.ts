import { z } from 'zod'

// Validates only the fields the worker actually reads from Contraktor
// responses — everything else passes through loosely.

const ContraktorPartyDataSchema = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  email: z.string().nullish(),
})

export const ContraktorUploadFileResponseSchema = z.object({
  data: z.looseObject({ id: z.number().int() }),
})

export const ContraktorAddPartyResponseSchema = z.object({
  data: ContraktorPartyDataSchema,
})

export const ContraktorListPartiesResponseSchema = z.object({
  data: z.array(ContraktorPartyDataSchema),
})

export const ContraktorAttachFileResponseSchema = z.object({
  data: z.looseObject({ id: z.number().int() }),
})

export const ContraktorAddParticipantResponseSchema = z.object({
  data: z.looseObject({ id: z.number().int() }),
})

export const ContraktorCreateContractResponseSchema = z.object({
  data: z.looseObject({ id: z.number().int() }),
})

export const ContraktorCreateProofResponseSchema = z.object({
  data: z.looseObject({
    id: z.number().int(),
    status: z.string(),
    subjects: z.array(
      z.looseObject({
        id: z.number().int(),
        name: z.string(),
        email: z.string(),
      })
    ),
  }),
})

export const ContraktorShareLinkResponseSchema = z.object({
  data: z.looseObject({ sharelink: z.string() }),
})

export type ContraktorUploadFileResponse = z.infer<typeof ContraktorUploadFileResponseSchema>
export type ContraktorAddPartyResponse = z.infer<typeof ContraktorAddPartyResponseSchema>
export type ContraktorListPartiesResponse = z.infer<typeof ContraktorListPartiesResponseSchema>
export type ContraktorAttachFileResponse = z.infer<typeof ContraktorAttachFileResponseSchema>
export type ContraktorAddParticipantResponse = z.infer<
  typeof ContraktorAddParticipantResponseSchema
>
export type ContraktorCreateContractResponse = z.infer<
  typeof ContraktorCreateContractResponseSchema
>
export type ContraktorCreateProofResponse = z.infer<typeof ContraktorCreateProofResponseSchema>
export type ContraktorShareLinkResponse = z.infer<typeof ContraktorShareLinkResponseSchema>
