# AGENTS.md — Equor Worker

You are working on **Equor Worker**, a Node.js/TypeScript microservice that processes Brazilian legal documents using AI (Claude). It receives tasks from a PHP (Yii2) backend, fetches HTML templates, fills placeholders with Claude's responses, and reports results back.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (ESM) |
| Language | TypeScript (strict, target ES2022, moduleResolution NodeNext) |
| HTTP Framework | Fastify 5 |
| Validation | Zod 4 |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| Storage | Google Cloud Storage (`@google-cloud/storage`) |
| Logging | Pino (stdout + file) |

---

## Directory Structure

```
src/
├── config/
│   └── env.ts              # Zod env schema. Lazy singleton via getEnv()
├── handlers/
│   └── process.handler.ts  # Main orchestration: fetchProcessData → resolveDocument → Claude
├── lib/
│   ├── html-parser.ts      # extractPromptPlaceholders / replacePlaceholder
│   ├── logger.ts           # Pino multistream (stdout + LOG_FILE)
│   └── shutdown.ts         # Graceful shutdown: trackTask / waitForDrain / isShuttingDown
├── middleware/
│   └── auth.middleware.ts  # verifyAuth: dev=x-worker-secret, prod=Bearer (TODO: OIDC JWT)
├── routes/
│   └── task.route.ts       # POST /task (202 async), GET /health
├── schemas/
│   ├── backend.schema.ts   # Zod: BackendProcessResponse validation
│   └── task.schema.ts      # Zod: { taskId: UUID, processId: number }
├── services/
│   ├── backend.service.ts  # fetchProcessData / reportDocumentResult
│   ├── claude.service.ts   # callClaude (Anthropic messages API)
│   └── storage.service.ts  # downloadFromGCS → in-memory base64
├── types/
│   ├── index.ts            # Barrel exports
│   ├── backend.types.ts    # BackendProcessResponse, ProcessDocumentData, ContextFileRef, DocumentStatus
│   ├── claude.types.ts     # ClaudeRequest, ContextFile
│   └── html.types.ts       # PromptPlaceholder
├── index.ts                # Entry point: buildServer() + listen() + graceful shutdown
└── server.ts               # buildServer(): Fastify + sensible + taskRoutes
```

---

## End-to-End Data Flow

```
1. PHP Backend → POST /task { taskId, processId }
2. verifyAuth (preHandler)
3. Fastify validates body with Zod (task.schema.ts)
4. Returns 202 Accepted immediately
5. Async (fire-and-forget):
   fetchProcessData(processId)
     → GET /api/process/{id}/task-data (header: x-worker-secret)
     → returns { process: { id, process_number, documents[] }, metadata? }
   Promise.allSettled(documents.map(resolveDocument)):
     → reportDocumentResult(id, 'processing')
     → downloadFromGCS(context_files[]) → base64[]
     → extractPromptPlaceholders(html_template) → PromptPlaceholder[]
     → for each placeholder (sequentially):
         callClaude({ instruction, htmlContext, contextFiles, metadata })
         replacePlaceholder(html, placeholder, result)
     → reportDocumentResult(id, 'completed', html)
     → (on error) reportDocumentResult(id, 'failed', undefined, errorMessage)
```

---

## Architecture Rules

### Patterns to ALWAYS follow

- **Lazy singletons via closures**: external clients (`Anthropic`, `Bucket`, `Env`) are instantiated once with the pattern `let _x = null; function getX() { if (!_x) _x = new X(); return _x }`. Never break this.
- **Services are functions, not classes**: no service uses a class. Keep it that way.
- **Async fire-and-forget in route handler**: the route returns 202 and kicks off processing without `await`. Processing errors are caught internally and reported to the backend — they must never propagate to Fastify. All fire-and-forget tasks must be wrapped with `trackTask()` from `src/lib/shutdown.ts`.
- **`Promise.allSettled` for documents**: documents are processed in parallel. A failure in one must not cancel the others.
- **All external calls must have timeouts**: backend fetch = 30s (`AbortSignal.timeout`), Claude API = 10min (large PDFs + long responses), GCS download = 60s (`Promise.race`). Never add an external call without a timeout.
- **Graceful shutdown**: SIGTERM/SIGINT trigger `beginShutdown()` → `app.close()` → `waitForDrain(25s)` → exit. New requests return 503 during drain. The `/health` endpoint returns `"draining"` status.
- **Backend responses must be Zod-validated**: never use `as` type assertions on external data. Validate with a Zod schema in `src/schemas/`.
- **Error reporting must be fault-tolerant**: the catch block in `resolveDocument` wraps `reportDocumentResult('failed')` in its own try-catch to prevent cascading failures when the backend is unreachable.
- **Imports with `.js` extension**: TypeScript with `moduleResolution: NodeNext` requires `.js` extensions on imports, even in `.ts` files.
- **Always access env via `getEnv()`**: never use `process.env.X` directly.

### What NOT to do

- Do not add classes where functions suffice.
- Do not create temporary files for GCS — everything stays in memory as base64.
- Do not `await` the processing inside the route handler — it violates the 202 async contract.
- Do not use `any` — use the types in `src/types/`.
- Do not instantiate external clients outside getter functions (prevents startup failures when env vars are missing).
- Do not bypass the `src/types/index.ts` barrel — always import types from there.
- Do not use `as` type assertions on external API responses — always validate with Zod.
- Do not add external calls without a timeout — a hung connection blocks the worker forever.

---

## Environment Variables

Defined in `src/config/env.ts` with Zod. All required unless a default is listed:

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | 3000 | Server port |
| `NODE_ENV` | enum | development | Environment |
| `LOG_FILE` | string | logs/equor-worker.log | Log file path |
| `LOG_LEVEL` | string | info | Pino log level |
| `BACKEND_URL` | url | — | PHP backend base URL |
| `BACKEND_DOCUMENT_PATH` | string | /api/process/{id}/task-data | Path template with `{id}` |
| `WORKER_SECRET` | string | — | Shared secret with the backend |
| `GCS_BUCKET_NAME` | string | — | GCS bucket name |
| `GOOGLE_APPLICATION_CREDENTIALS` | string | — | Path to GCS credentials JSON |
| `ANTHROPIC_API_KEY` | string | — | Anthropic API key |
| `CLAUDE_MODEL` | string | claude-sonnet-4-6 | Claude model to use |

---

## Placeholder System

HTML templates arrive from the backend with markers in this format:

```html
{{PROMPT: Extract the full name of the contractor from the document}}
```

- `extractPromptPlaceholders(html)` → regex `/\{\{PROMPT:\s*([\s\S]*?)\}\}/g`
- Returns an array of `{ instruction: string, original: string }`
- Placeholders are resolved **sequentially** — each one sees the HTML already updated by the previous ones
- `replacePlaceholder(html, placeholder, content)` → replaces `original` with Claude's result

---

## Claude Integration

File: `src/services/claude.service.ts`

- System prompt in Brazilian Portuguese: specialist in Brazilian legal documents
- Message content sent (in order):
  1. Context files (PDFs as `document` blocks, others decoded as plain text)
  2. Structured `metadata` (JSON) if present
  3. Current HTML of the document
  4. Final instruction asking for ONLY the HTML/text content, no explanations
- `max_tokens: 4096`
- Returns only the first `text` block from the response

---

## Backend Integration

File: `src/services/backend.service.ts`

- Auth header: `x-worker-secret` (same secret shared with backend)
- `fetchProcessData(processId)`: GET returning `{ process, metadata? }` — validated with `BackendProcessResponseSchema`
- `reportDocumentResult(id, status, html?, error?)`: POST with `{ status, result_html, error_message }`
- Possible statuses: `'processing'` | `'completed'` | `'failed'`
- Both calls have a 30s timeout via `AbortSignal.timeout()`

---

## Authentication

File: `src/middleware/auth.middleware.ts`

- **Development**: `x-worker-secret` header compared against `WORKER_SECRET` env var
- **Production**: `Authorization: Bearer <token>` header — **TODO: validate Google OIDC JWT**
  - When implementing: verify JWT signature, issuer `https://accounts.google.com`, audience = Cloud Run service account

---

## Dev Scripts

```bash
npm run dev      # tsx watch src/index.ts (hot reload)
npm run build    # tsc → dist/
npm start        # node dist/index.js
```

---

## Graceful Shutdown

File: `src/lib/shutdown.ts`

- `trackTask(promise)`: registers an in-flight task (increment counter, decrement on settle)
- `isShuttingDown()`: returns `true` after SIGTERM/SIGINT received
- `beginShutdown()`: sets the shutdown flag
- `waitForDrain(timeoutMs)`: resolves when all in-flight tasks complete or timeout expires

The route handler calls `trackTask()` on every fire-and-forget task. On shutdown, the entry point (`src/index.ts`) waits up to 25s for drain before exiting (Cloud Run gives 30s).

---

## How to Add a New External Service

1. Create `src/services/my-service.service.ts`
2. Use the lazy singleton pattern for the client
3. Export only functions
4. Add a timeout to every external call
5. Add required env vars to `src/config/env.ts`
6. Add types to `src/types/` and re-export from the `index.ts` barrel

## How to Add a New Route

1. Add the handler in `src/handlers/`
2. Add a Zod schema in `src/schemas/`
3. Register the route in `src/routes/task.route.ts` (or create a new route file)
4. Register the new plugin in `src/server.ts`

---

## Domain Context

- Documents are in **Brazilian Portuguese**
- The backend is a **PHP Yii2** application — the API contract cannot be changed without coordinating with the backend team
- Context files (e.g. powers of attorney, contracts) are stored in **GCS** and referenced by the backend
- Processing is **async by design**: the worker is invoked, returns 202, and the backend polls for status updates
- Multiple documents from the same process are always processed in parallel (`Promise.allSettled`)
