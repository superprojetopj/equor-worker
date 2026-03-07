import { z } from 'zod'

const ContextFileRefSchema = z.object({
  gcs_path: z.string(),
  file_name: z.string(),
  media_type: z.enum(['application/pdf', 'application/json', 'text/plain']),
})

const ProcessDocumentDataSchema = z.object({
  process_document_id: z.number().int(),
  html_template: z.string(),
  context_files: z.array(ContextFileRefSchema).default([]),
})

const ProcessDataSchema = z.object({
  id: z.number().int(),
  process_number: z.string(),
  documents: z.array(ProcessDocumentDataSchema),
})

export const BackendProcessResponseSchema = z.object({
  process: ProcessDataSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
})
