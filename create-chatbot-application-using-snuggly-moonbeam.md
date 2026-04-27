# WhatsApp Chatbot with RAG + Google Sheets Tools

## Context

Build a WhatsApp chatbot that:
- Receives and sends WhatsApp messages via Baileys (a Node WhatsApp Web library)
- Answers using LLMs hosted on NVIDIA NIM (build.nvidia.com) — free tier, OpenAI-compatible
- Supports a fallback chain across multiple models (tool-capable only) to survive rate limits and token-limit errors
- Performs RAG by querying a Zilliz (Milvus cloud) collection populated externally by AnythingLLM
- Exposes Google Sheets read/write as tools the LLM can call (service-account auth)
- Ships with a Next.js dashboard for QR pairing, status, conversation viewing, and config editing

The project is greenfield (empty directory at `/Users/kenshin/Projects/try/chatbot`). Deployment target is undecided — design for local-first with Docker so it can move to a VPS later without rework.

## High-Level Architecture

Two apps in a pnpm monorepo, sharing code via `packages/`. Communication between them goes through Neon Postgres (control events + worker heartbeat) — no HTTP or sockets between the processes.

```
WhatsApp ⇄ [apps/worker] ─── Neon Postgres ─── [apps/web (Next.js)]
                │                                        
                ├── NVIDIA NIM (OpenAI-compatible, fallback chain)
                ├── Zilliz (vector query, read-only)
                ├── Google Sheets API (service account)
                └── @xenova/transformers (multilingual-e5-small, local)
```

### Repo Shape

```
chatbot/
├── apps/
│   ├── worker/                 # Long-running Node process: Baileys + chat loop
│   └── web/                    # Next.js 15 App Router dashboard
├── packages/
│   ├── core/                   # LLM client, RAG, tool registry, chat loop
│   ├── db/                     # Drizzle schema + Neon client
│   └── config/                 # Zod env + models.json loader
├── data/                       # Baileys auth state (gitignored, volume-mounted)
├── scripts/
│   └── test-tools.ts           # Sheets tool smoke test
├── docker-compose.yml          # worker + web (Neon and Zilliz are remote)
├── .env.example
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Key Decisions

| Area | Decision |
|---|---|
| Language/runtime | TypeScript, Node 20+ |
| Web framework | Next.js 15 (App Router, RSC) |
| WhatsApp bridge | `@whiskeysockets/baileys` |
| LLM provider | NVIDIA NIM via OpenAI SDK (`baseURL: https://integrate.api.nvidia.com/v1`) |
| Embedding model | `Xenova/multilingual-e5-small` via `@xenova/transformers` (local, in worker); matches AnythingLLM ingest |
| Vector store | Zilliz (Milvus cloud) — query-only from app, populated by AnythingLLM externally |
| Database | Neon Postgres |
| ORM | Drizzle (HTTP driver for Next.js routes, WebSocket driver for worker) |
| Package manager | pnpm workspaces |
| UI | Tailwind + shadcn/ui, SWR for polling |
| Logging | Pino (worker), console (web) |
| Tests | Vitest (unit + integration against a Neon branch) |

## Components

### `packages/core` — shared chat logic

- `llm.ts` — wraps OpenAI SDK pointed at NVIDIA NIM. Exports `chatCompletion(messages, tools)` that iterates through the model fallback chain. Trigger matrix:
  - `429` → next model immediately
  - `context_length_exceeded` / token limit → trim oldest history pair, retry once same model; still fails → next model
  - `5xx` → exponential backoff on same model (1s, 2s), then next model
  - `401/403` → fail fast, log incident, do not cascade
  - Timeout (>30s) → next model
  - All exhausted → throw `AllModelsFailed`
- `rag.ts` — prefixes query with `query: `, embeds with local e5-small, runs Milvus top-K=5 search, formats chunks as a system-prefix context block.
- `tools/sheets.ts` — OpenAI-format schemas + handlers for `read_sheet`, `write_sheet`, `append_row`, `list_sheets`. Service-account client initialised once from `GOOGLE_SERVICE_ACCOUNT_JSON`.
- `chat.ts` — main loop: filter (allowlist, group-mention), rate-limit check, load history, RAG retrieve, build prompt, call `llm.chatCompletion`, execute tool calls (max 5 iterations), persist every step, return assistant text.
- `tokens.ts` — tiktoken-based approximate counter for trimming history to fit the smallest model's context window.

### `packages/db` — Drizzle schema

Tables (see Section 4 in the design review):
- `conversations(jid pk, display_name, is_group, allowlisted, created_at, updated_at)`
- `messages(id pk, jid fk, role, content, tool_calls jsonb, tool_call_id, tool_name, model_used, created_at)` — index on `(jid, created_at)`
- `rate_limits(jid, window_start, count)` — composite pk
- `incidents(id pk, jid, kind, detail jsonb, created_at)`
- `config(key pk, value jsonb, updated_at)` — holds `models`, `system_prompt`, `allowlist`
- `control_events(id pk, kind, payload jsonb, consumed_at, created_at)` — web → worker
- `worker_status(id=1 singleton, connected, qr, last_heartbeat, last_error)` — worker → web

Drizzle migrations via `drizzle-kit`. Two client exports: `dbHttp` (for Next.js) and `dbWs` (for worker, enables `LISTEN/NOTIFY`).

### `packages/config`

- Loads `.env` via Zod schema: `NVIDIA_API_KEY`, `DATABASE_URL`, `ZILLIZ_URI`, `ZILLIZ_TOKEN`, `ZILLIZ_COLLECTION`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Loads `models.json` (or falls back to DB `config.models`) with the fallback chain.

### `apps/worker`

- `src/main.ts` — boots Baileys with `useMultiFileAuthState("./data/auth")`, subscribes to `messages.upsert`, `connection.update`; writes QR + connection state to `worker_status`.
- Listens on Postgres `LISTEN control_events` for `pair`/`unpair`/`reload_config` commands.
- Supervisor restarts the socket on disconnect with exponential backoff (1s, 2s, 5s, 10s, cap 30s).
- Per-message handler: allowlist check → group-mention check → rate-limit → send `presence=composing` → call `packages/core` chat loop → send reply → clear presence.

### `apps/web`

Routes (App Router):
- `/` → redirect to `/status`
- `/status` — connection state, last heartbeat, last error, pair/unpair buttons
- `/pairing` — QR PNG from `worker_status.qr`, auto-refresh 2s via SWR until paired
- `/conversations` — list with last message, message count
- `/conversations/[jid]` — full transcript, expandable tool calls, shows `model_used` on assistant rows
- `/config` — edit models chain, system prompt, allowlist (writes `config` + emits `reload_config` control event)
- `/incidents` — recent failures

Mutations via Server Actions. Polling via SWR at 2s intervals on dynamic pages. No auth for MVP (single-user, local).

## Data Flow (per incoming WhatsApp message)

1. Baileys `messages.upsert` fires in worker.
2. Filter: allowlist lookup in `conversations`; if group, require bot mention.
3. Sliding-window rate-limit check against `rate_limits` (per JID, last 60s).
4. Send `presence=composing` to WhatsApp.
5. Load last N messages for this JID from `messages`.
6. Embed user text (local e5-small, `query: ` prefix) → Milvus top-K=5 → format as system-prefix context.
7. Call `llm.chatCompletion` with system + RAG context + history + tool schemas. Fallback chain kicks in on errors.
8. If response has `tool_calls`: execute each (Sheets handlers), append `role:"tool"` results, loop (max 5 iterations).
9. Persist user msg, all tool calls, tool results, and final assistant msg to `messages`.
10. Baileys sends the final text back to the WhatsApp JID. Clear composing presence.
11. On unrecoverable error: log to `incidents`, send a friendly fallback WhatsApp reply.

## Error Handling

- Every Baileys handler wrapped in try/catch; user-facing failures → one polite WhatsApp reply + `incidents` row.
- Tool errors surfaced back to the model as `role:"tool"` with `{error}` so the model can recover.
- Supervisor restarts the Baileys socket on disconnect with backoff.
- `AllModelsFailed` triggers the fallback reply and an incident; no cascading retries.

## Testing

- **Unit (Vitest):** fallback matrix (mock OpenAI responses: 429, 5xx, token error), rate-limit window math, tool schema validation, history trimmer.
- **Integration (Vitest + Neon branch):** DB queries against a throwaway Neon branch per run; Drizzle migrations applied in setup.
- **Manual E2E:** pair via dashboard → send WhatsApp message → verify Sheets + RAG paths.
- **Tool smoke test:** `scripts/test-tools.ts` calls each Sheets tool directly against a test spreadsheet shared with the service account.

## Environment Variables (.env.example)

```
DATABASE_URL=postgres://...neon.tech/...
NVIDIA_API_KEY=nvapi-...
ZILLIZ_URI=https://...zilliz.cloud
ZILLIZ_TOKEN=...
ZILLIZ_COLLECTION=anythingllm_default
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
WORKER_HEARTBEAT_MS=5000
RATE_LIMIT_PER_MINUTE=20
MAX_HISTORY_MESSAGES=20
```

## Out of Scope (MVP)

- Authentication on the dashboard (add NextAuth later if deploying publicly).
- Multi-user / multi-WhatsApp-number support (worker is single-instance).
- Automated WhatsApp E2E tests.
- Streaming responses (WhatsApp messages are atomic; not needed).
- Ingesting documents into Zilliz from the app (AnythingLLM owns this).
- NotebookLM integration (no viable public API).

## Critical Files to Create

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, `.gitignore`
- `docker-compose.yml`
- `packages/db/schema.ts`, `packages/db/client.ts`, `packages/db/drizzle.config.ts`
- `packages/core/llm.ts`, `packages/core/rag.ts`, `packages/core/chat.ts`, `packages/core/tokens.ts`
- `packages/core/tools/sheets.ts`, `packages/core/tools/index.ts`
- `packages/config/env.ts`, `packages/config/models.ts`
- `apps/worker/src/main.ts`, `apps/worker/src/supervisor.ts`, `apps/worker/src/listen.ts`
- `apps/web/app/layout.tsx`, `apps/web/app/status/page.tsx`, `apps/web/app/pairing/page.tsx`, `apps/web/app/conversations/page.tsx`, `apps/web/app/conversations/[jid]/page.tsx`, `apps/web/app/config/page.tsx`, `apps/web/app/incidents/page.tsx`
- `apps/web/app/actions.ts` (Server Actions)
- `scripts/test-tools.ts`
- `models.json` (default fallback chain, user-editable via dashboard)

## Verification

1. `pnpm install` completes.
2. `pnpm -r typecheck` passes.
3. `pnpm -r test` passes (unit + integration against a Neon test branch).
4. `docker compose up` brings up worker + web.
5. Open `http://localhost:3000/pairing`, scan QR with WhatsApp; `worker_status.connected` flips to true.
6. Message the bot from an allowlisted number; observe:
   - Composing presence shown in WhatsApp.
   - Reply received.
   - Transcript visible in `/conversations/[jid]` with the model used.
7. Ask the bot something covered by the Zilliz collection — verify RAG context appears in the logged prompt.
8. Ask the bot to "read A1:B5 from sheet <id>" — verify a tool call + result appear in the transcript.
9. Ask the bot to append a row — verify the row in Google Sheets.
10. Simulate rate limit by lowering `RATE_LIMIT_PER_MINUTE` and rapid-messaging — verify the throttle reply.
11. Force a model failure (invalid model ID at position 0 of the chain) — verify fallback to position 1 and that `model_used` reflects it.
