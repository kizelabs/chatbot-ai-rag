cb/README.md
```
# Chatbot

WhatsApp chatbot with LLM-powered responses and RAG (Retrieval-Augmented Generation).

## Architecture

```
├── apps/
│   ├── web/       # Next.js admin dashboard
│   └── worker/    # WhatsApp worker service (Baileys)
├── packages/
│   ├── config/    # Configuration & environment
│   ├── core/      # Core business logic (chat, LLM, RAG)
│   └── db/        # Database layer (Drizzle ORM + PostgreSQL)
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate database types
pnpm db:generate

# Run migrations
pnpm db:migrate

# Start services
pnpm dev:web    # Admin dashboard (http://localhost:3000)
pnpm dev:worker # WhatsApp worker
```

## Configuration Files

### `allowlist.json`

Controls which WhatsApp conversations the bot responds to.

**Format:** Array of JIDs (WhatsApp IDs)

```json
[
  "12025551000-987654321@g.us"
]
```

| Value | Description |
|-------|-------------|
| Personal chat JID | Bot responds to all messages |
| Group chat JID | Bot only responds when mentioned (`@bot` or `bot `) |

**How to get a JID:**
- Personal: `phone@.whatsapp.net` (e.g., `6285742200009@s.whatsapp.net`)
- Group: Ends with `@g.us` (get from WhatsApp group invite link or logs)

### `models.json`

Configures the LLM model chain. The bot tries models in order and falls back to the next on failure.

```json
[
  {
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "max_tokens": 16384,
    "temperature": 1,
    "top_p": 0.95,
    "enable_thinking": true,
    "reasoning_budget": 16384,
    "stream": false
  },
  {
    "model": "deepseek-ai/deepseek-v3.2",
    "max_tokens": 8192,
    "temperature": 1,
    "top_p": 0.95,
    "chat_template_kwargs": { "thinking": true },
    "stream": false
  }
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | NVIDIA NGC model ID |
| `max_tokens` | number | Yes | Maximum tokens in response |
| `temperature` | number | No | Sampling temperature (0-2). Default: 1 |
| `top_p` | number | No | Nucleus sampling. Default: 0.95 |
| `enable_thinking` | boolean | No | Enable chain-of-thought reasoning |
| `reasoning_budget` | number | No | Tokens for reasoning (requires `enable_thinking`) |
| `chat_template_kwargs` | object | No | Additional template params |
| `stream` | boolean | No | Enable streaming responses |
| `toolCapable` | boolean | No | Model can use tools. Default: true |
| `enabled` | boolean | No | Include in chain. Default: true |
| `order` | number | No | Fallback priority (lower = first) |

### `ingest.json`

Document ingestion jobs for RAG. These documents are embedded and used as context for chat responses.

```json
[
  {
    "id": "unique-job-id",
    "title": "Document Title",
    "kind": "text",
    "status": "ready",
    "sourceType": "file",
    "fileName": "document.md",
    "filePath": "./data/ingest/document.md",
    "mimeType": "text/markdown",
    "size": 1024,
    "content": null,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique job identifier (UUID) |
| `title` | string | Yes | Display name |
| `kind` | string | Yes | Type: `text`, `doc`, `sheet`, `ppt`, `pdf`, `image` |
| `status` | string | Yes | Status: `ready`, `queued`, `processing`, `stored`, `error` |
| `sourceType` | string | Yes | Source: `inline` (content) or `file` (filePath) |
| `fileName` | string | No | Original filename |
| `filePath` | string | No | Path to file (when `sourceType: file`) |
| `mimeType` | string | No | MIME type |
| `size` | number | No | File size in bytes |
| `content` | string | No | Inline content (when `sourceType: inline`) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `NVIDIA_API_KEY` | Yes | - | NVIDIA NGC API key |
| `WORKER_HEARTBEAT_MS` | No | 30000 | Heartbeat interval in ms |

## License

Private
