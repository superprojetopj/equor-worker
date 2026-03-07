import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  LOG_FILE: z.string().default('logs/equor-worker.log'),
  LOG_LEVEL: z.string().default('info'),

  BACKEND_URL: z.url(),
  BACKEND_DOCUMENT_PATH: z.string().default('/api/process/{id}/task-data'),

  WORKER_SECRET: z.string().min(1),

  GCS_BUCKET_NAME: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
})

export type Env = z.infer<typeof EnvSchema>

let _env: Env | null = null

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env)
  }
  return _env
}
