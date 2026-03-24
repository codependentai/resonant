# Semantic Search

Resonant includes local semantic search across all conversation history. Your companion can search by meaning, not just keywords — "that conversation about moving to a new city" will find relevant messages even if those exact words weren't used.

## How It Works

- Uses `all-MiniLM-L6-v2`, a small (30MB) embedding model that runs locally in Node.js
- No external API calls — everything stays on your machine
- Messages are automatically embedded when created
- Search uses cosine similarity to find the most relevant messages

## Setup

### 1. Install the dependency

The `@huggingface/transformers` package is included in Resonant's dependencies. If you're updating from a version that didn't have it:

```bash
cd packages/backend
npm install @huggingface/transformers
```

### 2. First run — model download

The embedding model downloads automatically on first use (~30MB). This happens once — subsequent starts use the cached model from `~/.cache/huggingface/`.

If you're behind a firewall or on an air-gapped machine, you can pre-download the model:

```bash
# Pre-cache the ONNX model (optional — will happen automatically on first search)
node -e "
  import('@huggingface/transformers').then(async ({ pipeline }) => {
    console.log('Downloading model...');
    await pipeline('feature-extraction', 'sentence-transformers/all-MiniLM-L6-v2', { dtype: 'fp32' });
    console.log('Done. Model cached at ~/.cache/huggingface/');
  });
"
```

### 3. Backfill existing messages

New messages are embedded automatically. To index your existing conversation history:

```bash
# From your Resonant root directory (where resonant.yaml is)
node tools/sc.mjs backfill 100    # process 100 messages at a time
```

Run this multiple times or with larger batch sizes to index your full history. Your companion can also do this during autonomous time.

## Usage

### CLI (for your companion via Bash tool)

```bash
# Search all threads
node tools/sc.mjs search "that conversation about the project deadline"

# Search a specific thread
node tools/sc.mjs search "query" --thread THREAD_ID --limit 5

# Filter by speaker
node tools/sc.mjs search "query" --role user
node tools/sc.mjs search "query" --role companion

# Filter by date range
node tools/sc.mjs search "query" --after 2026-03-01 --before 2026-03-15

# Combine filters
node tools/sc.mjs search "that deadline" --role user --after 2026-03-01 --limit 20

# Check indexing progress
node tools/sc.mjs backfill 0    # processes 0, but shows indexed/total counts
```

### Internal API (for programmatic access)

```bash
# Semantic search (with optional filters)
curl -X POST http://localhost:PORT/api/internal/search-semantic \
  -H "Content-Type: application/json" \
  -d '{
    "query": "your search",
    "threadId": "optional",
    "role": "user",
    "after": "2026-03-01",
    "before": "2026-03-15",
    "limit": 10
  }'

# Backfill embeddings
curl -X POST http://localhost:PORT/api/internal/embed-backfill \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 50}'
```

Both endpoints are localhost-only (no auth required).

Search results include session context when available — which session the message belongs to and when that session started/ended. See [Session Maintenance](session-maintenance.md) for details on session tracking.

## Technical Details

- **Model**: `sentence-transformers/all-MiniLM-L6-v2` (384-dimensional vectors)
- **Storage**: `message_embeddings` table in SQLite (separate from messages table)
- **Embedding**: Fire-and-forget on message creation — doesn't block message delivery
- **Vector cache**: All embeddings are loaded into a contiguous `Float32Array` at startup (~15 MB per 10K messages). Search is a tight dot-product loop with no SQLite queries per search.
- **Pre-filtering**: `--role`, `--after`, `--before` filters are applied before vector math, cutting the search space
- **Memory**: Embedding model uses ~100MB RAM when loaded; vector cache uses ~1.5 KB per message

## Troubleshooting

**Model download fails**: Check your internet connection. The model downloads from Hugging Face Hub. Set `HF_HOME` env var to change the cache location.

**Search returns no results**: Run `node tools/sc.mjs backfill` to index existing messages. New messages are indexed automatically.

**Slow first search**: The first search loads the model into memory (~5-10 seconds). Subsequent searches are fast (<100ms for query embedding + similarity computation).
