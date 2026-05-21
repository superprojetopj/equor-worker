import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  LOG_FILE: z.string().default('logs/equor-worker.log'),
  LOG_LEVEL: z.string().default('info'),

  BACKEND_URL: z.url(),
  BACKEND_AI_GENERATE_PATH: z.string().default('/worker/{processDocumentId}/ai-generate-task-data'),
  BACKEND_AI_GENERATE_RESULT_PATH: z.string().default('/worker/{processDocumentId}/ai-generate-result'),

  WORKER_SECRET: z.string().min(1).transform((s) => s.trim()),

  GCS_BUCKET_NAME: z.string().min(1),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),

  // AI Services
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),

  // Gemini
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),

  // Contraktor
  CONTRAKTOR_API_URL: z.url(),
  CONTRAKTOR_API_TOKEN: z.string().min(1),
})

export type Env = z.infer<typeof EnvSchema>

let _env: Env | null = null

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env)
  }
  return _env
}
