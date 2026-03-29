import { z } from 'zod'

const EnderecoSchema = z.object({
  zip_code: z.string(),
  street: z.string(),
  number: z.string(),
  complement: z.string().default(''),
  neighborhood: z.string(),
  city_name: z.string(),
  state: z.string(),
})

const CnaeSchema = z.object({
  subclasse: z.string(),
  denominacao: z.string(),
})

const SocioSchema = z.looseObject({
  cpf: z.string(),
  nome: z.string(),
  email: z.string().default(''),
  phone: z.string().default(''),
  whatsapp: z.string().default(''),
  role: z.string().default(''),
  profissao: z.string().default(''),
  legal_representative: z.boolean().default(false),
  is_signatory: z.boolean().default(false),
  is_witness: z.boolean().default(false),
  is_consultant: z.boolean().default(false),
  is_reviewer: z.boolean().default(false),
  endereco: EnderecoSchema.optional(),
})

const EmpresaSchema = z.looseObject({
  cnpj: z.string(),
  razao_social: z.string(),
  phone: z.string().default(''),
  whatsapp: z.string().default(''),
  email: z.string().default(''),
  cnae_principal: CnaeSchema.nullable().default(null),
  cnaes_secundarios: z.array(CnaeSchema).default([]),
  endereco: EnderecoSchema,
  socios: z.array(SocioSchema).default([]),
})

const MetadataSchema = z.looseObject({
  contratantes: z.array(EmpresaSchema).optional(),
  contratadas: z.array(EmpresaSchema).optional(),
})

const ContextFileRefSchema = z.object({
  gcs_path: z.string(),
  file_name: z.string(),
  media_type: z.string(),
})

const PromptItemSchema = z.object({
  id: z.string(),
  prompt: z.string(),
})

const ProcessDocumentDataSchema = z.object({
  process_document_id: z.number().int(),
  html_template: z.string().optional(),
  prompts: z.array(PromptItemSchema).default([]),
  custom_prompt: z.string().nullable().optional(),
  context_files: z.array(ContextFileRefSchema).default([]),
})

const ProcessDataSchema = z.object({
  process_number: z.string(),
  documents: z.array(ProcessDocumentDataSchema),
})

export const BackendProcessResponseSchema = z.object({
  process: ProcessDataSchema,
  metadata: MetadataSchema.optional(),
})
