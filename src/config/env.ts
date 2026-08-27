import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  LOG_FILE: z.string().default('logs/equor-worker.log'),
  LOG_LEVEL: z.string().default('info'),

  BACKEND_URL: z.url(),
  BACKEND_AI_GENERATE_PATH: z.string().default('/worker/{processDocumentId}/ai-generate-task-data'),
  BACKEND_AI_GENERATE_RESULT_PATH: z
    .string()
    .default('/worker/{processDocumentId}/ai-generate-result'),
  BACKEND_SIGN_TASK_DATA_PATH: z.string().default('/worker/{processDocumentId}/sign-task-data'),
  BACKEND_SIGN_TASK_RESULT_PATH: z.string().default('/worker/{processDocumentId}/sign-result'),
  // Vídeo e transcrição têm pipelines separadas no backend: cada evento do
  // Recall dispara a sua, e as chaves de fila não colidem (a chave única de
  // antes fazia o segundo webhook ser descartado como duplicado, e a
  // transcrição só era recuperada pela auditoria meia hora depois).
  BACKEND_RECALL_VIDEO_TASK_DATA_PATH: z
    .string()
    .default('/worker/{processMeetingId}/recall-video-task-data'),
  BACKEND_RECALL_VIDEO_RESULT_PATH: z
    .string()
    .default('/worker/{processMeetingId}/recall-video-result'),
  BACKEND_RECALL_TRANSCRIPT_TASK_DATA_PATH: z
    .string()
    .default('/worker/{processMeetingId}/recall-transcript-task-data'),
  BACKEND_RECALL_TRANSCRIPT_RESULT_PATH: z
    .string()
    .default('/worker/{processMeetingId}/recall-transcript-result'),

  WORKER_SECRET: z
    .string()
    .min(32, 'WORKER_SECRET must be at least 32 characters')
    .transform((s) => s.trim()),

  GCS_BUCKET_NAME: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),

  // Teto do download da mídia. Precisa caber no dispatch_deadline da task
  // (1800s no /recall-video, definido em CloudTaskService) JUNTO com o upload
  // para o GCS — por isso 20 min, não 30: os 10 restantes são a folga do envio.
  RECALL_MEDIA_TIMEOUT_MS: z.coerce.number().int().min(60_000).default(1_200_000),

  // Folga para requisições curtas terminarem no SIGTERM. O que for cortado no
  // meio não responde 2xx e o Cloud Tasks reentrega, então esperar mais que
  // isso só atrasa o deploy.
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).default(20_000),

  // Sufixos de host aceitos nas URLs de mídia do Recall (anti-SSRF). O download
  // do Recall redireciona para presigned URL do S3, por isso amazonaws.com.
  RECALL_MEDIA_ALLOWED_HOSTS: z.string().default('recall.ai,amazonaws.com'),

  // AI Provider
  AI_PROVIDER: z.enum(['claude', 'gemini']).default('claude'),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  // Ignorada em modelos que rejeitam sampling params (Opus 4.7+, Sonnet 5, Fable)
  CLAUDE_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),

  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),

  // Contraktor
  CONTRAKTOR_API_URL: z.url(),
  CONTRAKTOR_API_TOKEN: z
    .string()
    .min(1)
    .transform((s) => s.trim()),

  PUPPETEER_EXECUTABLE_PATH: z.string().min(1).optional(),
})

const EnvSchemaFinal = EnvSchema.superRefine((env, ctx) => {
  if (env.AI_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=claude',
      path: ['ANTHROPIC_API_KEY'],
    })
  }
  if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      path: ['GEMINI_API_KEY'],
    })
  }
})

export type Env = z.infer<typeof EnvSchema>

let _env: Env | null = null

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchemaFinal.parse(process.env)
  }
  return _env
}
