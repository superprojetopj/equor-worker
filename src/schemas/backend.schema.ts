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

const ContatoSchema = z.looseObject({
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
  // O backend renomeou de `socios` para `contatos` (a lista sempre foi de
  // contatos da parte, não de sócios). Payload antigo com `socios` ainda passa
  // pelo looseObject e chega ao prompt — só não é validado.
  contatos: z.array(ContatoSchema).default([]),
})

const ProcessoSchema = z.looseObject({
  process_number: z.string(),
  title: z.string().optional(),
  objeto_do_contrato: z.string().optional(),
  valores_e_multas: z.string().optional(),
  date_start: z.string().nullish(),
  date_end: z.string().nullish(),
})

const MetadataSchema = z.looseObject({
  processo: ProcessoSchema.optional(),
  contratantes: z.array(EmpresaSchema).optional(),
  contratadas: z.array(EmpresaSchema).optional(),
})

const ContextFileRefSchema = z.object({
  gcs_path: z.string(),
  file_name: z.string(),
  media_type: z.string(),
})

// Ids come from the TinyMCE templates as "{PROMPT_xxxxxx}" (frontend generates
// PROMPT_<base36>). Anything else is rejected — the id is interpolated into
// prompt XML and matched against AI response blocks.
const PROMPT_ID_PATTERN = /^\{?PROMPT_[A-Za-z0-9_]+\}?$/

const PromptItemSchema = z.object({
  id: z.string().regex(PROMPT_ID_PATTERN, 'invalid prompt id format'),
  prompt: z.string(),
  length: z.string().nullish(),
})

const ProcessDocumentDataSchema = z.object({
  process_document_id: z.number().int(),
  skeleton: z.string().nullish(),
  prompts: z.array(PromptItemSchema).default([]),
  context_files: z.array(ContextFileRefSchema).default([]),
})

export const BackendProcessDocumentResponseSchema = z.object({
  document: ProcessDocumentDataSchema,
  metadata: MetadataSchema.optional(),
})

// ── Sign Task Data ──

const SignatureSchema = z.object({
  name: z.string(),
  cpf: z.string(),
  email: z.string(),
  party_type: z.enum(['CONTRATANTE', 'CONTRATADA', 'MEDIADOR']),
})

const SignDocumentSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  process_number: z.string(),
  html_content: z.string(),
})

export const BackendSignDocumentResponseSchema = z.object({
  document: SignDocumentSchema,
  signatures: z.array(SignatureSchema).default([]),
})
