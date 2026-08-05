import { z } from 'zod'

// Validates only the fields the worker reads from generateContent responses.
export const GeminiGenerateContentResponseSchema = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        content: z
          .looseObject({
            parts: z.array(z.looseObject({ text: z.string().optional() })).optional(),
          })
          .optional(),
      })
    )
    .optional(),
  usageMetadata: z
    .looseObject({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
})

export type GeminiGenerateContentResponse = z.infer<typeof GeminiGenerateContentResponseSchema>
