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

  WORKER_SECRET: z
    .string()
    .min(32, 'WORKER_SECRET must be at least 32 characters')
    .transform((s) => s.trim()),

  GCS_BUCKET_NAME: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),

  // Max background jobs (AI generations) running at once — each can hold
  // up to 20MB of base64 file data in memory
  MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).default(3),

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
