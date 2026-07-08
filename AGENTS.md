# AGENTS.md — Equor Worker

You are working on **Equor Worker**, a Node.js/TypeScript microservice that processes Brazilian legal documents using AI (Claude or Gemini). It receives tasks from a PHP (Yii2) backend, generates document sections with AI, sends documents for digital signature via Contraktor, and reports results back.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (ESM) |
| Language | TypeScript (strict, target ES2022, moduleResolution NodeNext) |
| HTTP Framework | Fastify 5 |
| Validation | Zod 4 |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) — default; Gemini via REST as alternative |
| Storage | Google Cloud Storage (`@google-cloud/storage`) |
| PDF | Puppeteer (`generatePdfFromHtml`) |
| Signature | Contraktor API |
| Logging | Pino (stdout + file) |

---

## Directory Structure

```
src/
├── config/
│   └── env.ts                        # Zod env schema. Lazy singleton via getEnv()
├── handlers/
│   ├── ai-generate.handler.ts        # AI generation: compose (skeleton) + per-prompt fallback
│   ├── signature.handler.ts          # PDF → GCS → Contraktor signature flow
│   └── delete-contraktor.handler.ts  # Delete contract in Contraktor
├── lib/
│   ├── ai-response.ts                # stripMarkdownFences / parsePromptResults
│   ├── html-wrap.ts                  # wrapTinyMceHtml (full HTML doc for PDF rendering)
│   ├── http.ts                       # fetchWithRetry
│   ├── logger.ts                     # Pino multistream (stdout + LOG_FILE)
│   └── shutdown.ts                   # dispatch / trackTask / waitForDrain / shutdownGuard
├── middleware/
│   └── auth.middleware.ts            # verifyAuth (x-worker-key secret; TODO: OIDC JWT em prod)
├── prompts/
│   ├── system.prompt.ts              # Persona: consultor jurídico brasileiro (Equor Legal Advisor)
│   ├── html-format.prompt.ts         # Shared: TinyMCE HTML rules, assinaturas, variáveis amarelas, security policy
│   ├── fill-placeholders.prompt.ts   # Per-prompt output contract (HTML puro) — fallback path
│   ├── compose-document.prompt.ts    # Compose output contract (<prompt_result> blocks + skeleton rules)
│   └── ai-generate.prompt.ts         # Joins system + task prompts into system instructions
├── routes/
│   ├── ai-generate.route.ts          # POST /ai-generate (202 async)
│   ├── signature.route.ts            # POST /signature (202 async)
│   └── delete-contraktor.route.ts    # POST /delete-contraktor
├── schemas/                          # Zod schemas (payloads + backend responses)
├── services/
│   ├── backend.service.ts            # fetchProcessDocumentData / reportAiGenerateResult / sign endpoints
│   ├── claude.service.ts             # callClaude (streaming + prompt caching)
│   ├── gemini.service.ts             # callGemini (REST generateContent)
│   ├── context.service.ts            # contextFileToPart (PDF/image inline, docx via mammoth, text sandboxed)
│   ├── contraktor.service.ts         # Contraktor API client
│   ├── pdf.service.ts                # generatePdfFromHtml (Puppeteer)
│   └── storage.service.ts            # GCS download (base64 in-memory) / upload
├── types/                            # backend.types, ai.types, storage.types, contraktor.types
├── index.ts                          # Entry point: buildServer() + listen() + graceful shutdown
└── server.ts                         # buildServer(): Fastify + cors + sensible + routes
```

---

## AI Generation Flow (ai-generate)

```
1. PHP Backend → POST /ai-generate { processDocumentId }
2. verifyAuth (preHandler) + Zod validation → 202 Accepted
3. Async (dispatch/trackTask):
   fetchProcessDocumentData(processDocumentId)
     → GET {BACKEND_AI_GENERATE_PATH} (header: X-Worker-Key)
     → { document: { process_document_id, skeleton?, prompts[], context_files[] }, metadata }
   downloadFromGCS(context_files[]) → base64 → contextFileToPart()
   IF skeleton present:
     → ONE compose call: files + <metadata> + <document_skeleton> + <prompts> (all prompts)
     → response parsed by parsePromptResults(): <prompt_result id="{PROMPT_x}">html</prompt_result>
     → prompts missing from the response fall back to the per-prompt path
   Per-prompt path (fallback / no skeleton):
     → for each pending prompt: callAI(files + metadata + skeleton (if any) + <instruction>)
     → instruction includes the prompt's `length` and the [[marker]] context when available
   reportAiGenerateResult(id, 'GENERATED', [{ prompt_id, result_html }])
   (on error) reportAiGenerateResult(id, 'FAILED', [], message)
```

The backend replaces each `prompt_id` result into the template spans server-side
(`DocumentTemplate::replacePrompts`) — the worker never returns the full document HTML.

### Prompt/skeleton contract (from the backend)

- Templates are TinyMCE HTML with `<span data-variable="{PROMPT_x}" data-prompt="..." data-length="...">` markers.
- The backend extracts `prompts: [{ id, prompt, length? }]` and builds `skeleton`: the full
  document as plain text with `[[{PROMPT_x}]]` markers where each generated section goes.
- `length` (optional, from `data-length`) becomes the `tamanho` attribute in the `<prompt>` XML tag —
  the compose prompt treats it as mandatory sizing guidance.
- **Full-document templates**: if the template has exactly ONE prompt and the skeleton minus its
  `[[marker]]` has < 200 chars of fixed text (`isFullDocumentTemplate`), that prompt IS the document.
  The instruction gets `FULL_DOCUMENT_NOTE`, which lifts the minimum-size rules (compose prompt
  rule 6 / system prompt full-document format) — otherwise a single-prompt template would be
  squeezed into "um parágrafo". Multiple prompts are ALWAYS treated as parts, even with no fixed
  text — each prompt is a section and the set composes the document.

---

## Architecture Rules

### Patterns to ALWAYS follow

- **Lazy singletons via closures**: external clients (`Anthropic`, `Bucket`, `Env`) are instantiated once with the pattern `let _x = null; function getX() { if (!_x) _x = new X(); return _x }`. Never break this.
- **Services are functions, not classes**: no service uses a class. Keep it that way.
- **Async fire-and-forget in route handlers**: routes return 202 and kick off processing via `dispatch()` from `src/lib/shutdown.ts`. Processing errors are caught internally and reported to the backend — they must never propagate to Fastify.
- **All external calls must have timeouts**: backend fetch via `fetchWithRetry`, AI calls = 10min (`AbortSignal.timeout`), GCS download = 60s. Never add an external call without a timeout.
- **Graceful shutdown**: SIGTERM/SIGINT → `beginShutdown()` → `app.close()` → `waitForDrain(25s)` → exit. New requests get 503 via `shutdownGuard`.
- **Backend responses must be Zod-validated**: never use `as` type assertions on external data. Validate with a Zod schema in `src/schemas/`.
- **Error reporting must be fault-tolerant**: catch blocks wrap the `FAILED` report in their own try-catch.
- **Imports with `.js` extension**: `moduleResolution: NodeNext` requires `.js` extensions on imports, even in `.ts` files.
- **Always access env via `getEnv()`**: never use `process.env.X` directly.
- **Provider-agnostic AI calls**: handlers call `callAI()` which routes to Claude or Gemini via `AI_PROVIDER`. Content is built as `AIContentPart[]` (`{text}` or `{inline_data}`), converted per-provider inside each service.
- **Compose must degrade gracefully**: a failed or partial compose call falls back to per-prompt generation for the missing prompts — never fail the whole document because the single-call path broke.

### What NOT to do

- Do not add classes where functions suffice.
- Do not create temporary files for GCS — everything stays in memory as base64.
- Do not `await` the processing inside the route handler — it violates the 202 async contract.
- Do not use `any` — use the types in `src/types/` (barrel: `src/types/index.ts`).
- Do not instantiate external clients outside getter functions.
- Do not use `as` type assertions on external API responses — always validate with Zod.
- Do not add external calls without a timeout.
- Do not put per-call (volatile) content before the cached prefix in Claude requests — see Claude Integration.

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
| `BACKEND_AI_GENERATE_PATH` | string | /worker/{processDocumentId}/ai-generate-task-data | Task data path |
| `BACKEND_AI_GENERATE_RESULT_PATH` | string | /worker/{processDocumentId}/ai-generate-result | Result path |
| `BACKEND_SIGN_TASK_DATA_PATH` | string | /worker/{processDocumentId}/sign-task-data | Sign data path |
| `BACKEND_SIGN_TASK_RESULT_PATH` | string | /worker/{processDocumentId}/sign-result | Sign result path |
| `WORKER_SECRET` | string | — | Shared secret with the backend (X-Worker-Key) |
| `GCS_BUCKET_NAME` | string | — | GCS bucket name |
| `GOOGLE_APPLICATION_CREDENTIALS` | string | — | Path to GCS credentials JSON |
| `AI_PROVIDER` | enum | claude | `claude` or `gemini` |
| `ANTHROPIC_API_KEY` | string | — | Required when AI_PROVIDER=claude |
| `CLAUDE_MODEL` | string | claude-haiku-4-5-20251001 | Claude model to use |
| `CLAUDE_TEMPERATURE` | number | 0.2 | 0–1. Silently skipped on models that reject sampling params (Opus 4.7+, Sonnet 5, Fable) |
| `GEMINI_API_KEY` | string | — | Required when AI_PROVIDER=gemini |
| `GEMINI_MODEL` | string | gemini-2.5-flash-lite | Gemini model to use |
| `CONTRAKTOR_API_URL` | url | — | Contraktor API base URL |
| `CONTRAKTOR_API_TOKEN` | string | — | Contraktor API token |
| `PUPPETEER_EXECUTABLE_PATH` | string | — | Optional Chromium path for PDF generation |

---

## Claude Integration

File: `src/services/claude.service.ts`

- **Streaming**: uses `client.messages.stream(...).finalMessage()` — required for large `max_tokens`
  (compose calls use 32000 output tokens) without hitting HTTP timeouts.
- **Prompt caching**: two `cache_control: {type: "ephemeral"}` breakpoints —
  the system instruction block, and the penultimate content block (context files + metadata + skeleton).
  The last content block is always the per-call `<instruction>`, so sequential calls for the same
  document (per-prompt fallback, retries) read the cached prefix instead of re-paying for the PDFs.
  Keep this ordering: stable content first, volatile instruction last.
- PDFs go as `document` blocks, images as `image` blocks, everything else as sandboxed text.
- Default `max_tokens: 16000`; overridable via `generationConfig.maxOutputTokens`.
- **Temperature**: `CLAUDE_TEMPERATURE` (default 0.2) is applied only when the model accepts it —
  Opus 4.7+, Sonnet 5, and Fable reject `temperature`/`top_p`/`top_k` with 400, so the service
  guards with a model-name regex (`SAMPLING_PARAMS_REMOVED`). Haiku 4.5 and Sonnet 4.6 accept it.
- **Usage tracking**: `callClaude`/`callGemini` return `{ text, usage }` (`AIResult`). Usage is
  logged per call and aggregated per run by the handler (`aggregateUsage`), then reported to the
  backend in the result payload. Cost comes from the price table `MODEL_PRICES_PER_MTOK` —
  `estimatedCostUsd` is `null` for unknown models (add a row when changing `CLAUDE_MODEL`) and
  always `null` for Gemini (no price table).
- Returns only the first `text` block, passed through `stripMarkdownFences`.

## Prompts

Files: `src/prompts/`

- `system.prompt.ts` — persona/legal rules, shared by all generation paths.
- `html-format.prompt.ts` — shared TinyMCE formatting rules, signature blocks, yellow-highlight
  variable rules (`{{VARIAVEL}}` spans) and the content security policy. Imported by both output contracts.
- `fill-placeholders.prompt.ts` — per-prompt path: output is pure HTML, nothing else.
- `compose-document.prompt.ts` — compose path: output is one `<prompt_result id="...">` block per
  prompt; explains how to use `<document_skeleton>` for sizing (fit the marker's surroundings, default
  to the smallest content that satisfies the instruction, `tamanho` attribute is mandatory guidance,
  never duplicate fixed text, keep cross-section coherence).

When changing formatting rules, change `html-format.prompt.ts` — not the two output contracts.

---

## Backend Integration

File: `src/services/backend.service.ts`

- Auth header: `X-Worker-Key` (shared secret)
- `fetchProcessDocumentData(id)`: GET → `{ document, metadata }` — validated with `BackendProcessDocumentResponseSchema`
- `reportAiGenerateResult(id, status, prompts[], error?, usage?)`: POST `{ status, prompts: [{prompt_id, result_html}], error_message, usage }`
  - `usage` aggregates all AI calls of the run: `{ provider, model, ai_calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, estimated_cost_usd }` (`null` when no AI call happened). Sent on both `GENERATED` and `FAILED` — the backend persists it in `tb_ai_generation_usage`.
- `fetchSignDocumentData(id)` / `reportSignTaskResult(...)`: signature flow equivalents
- Statuses: `'PROCESSING' | 'GENERATED' | 'FAILED'`
- All calls go through `fetchWithRetry` (timeout + retry)

---

## Signature Flow (signature)

```
POST /signature { processDocumentId } → 202
  fetchSignDocumentData → { document (html_content), signatures[] }
  generatePdfFromHtml(wrapTinyMceHtml(html)) → uploadToGCS
  Contraktor: upload file → create contract → add parties/participants → dispatch → share links
  reportSignTaskResult(id, 'GENERATED', { contraktor_contract_id, gcs_path, signatories })
```

---

## Dev Scripts

```bash
npm run dev      # tsx watch src/index.ts (hot reload)
npm run build    # tsc → dist/
npm start        # node dist/index.js
npx tsc --noEmit # typecheck
npx eslint src   # lint
```
