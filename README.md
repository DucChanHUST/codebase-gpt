# codebase-gpt

> Ask your codebase questions. Local-first semantic knowledge graph + RAG.

[![npm](https://img.shields.io/npm/v/@phoenixaihub/codebase-gpt)](https://www.npmjs.com/package/@phoenixaihub/codebase-gpt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/phoenix-assistant/codebase-gpt/actions/workflows/ci.yml/badge.svg)](https://github.com/phoenix-assistant/codebase-gpt/actions)

**codebase-gpt** is a local-first codebase intelligence CLI. No cloud, no API key required. It builds a knowledge graph of your code — functions, classes, imports, change coupling from git history — and lets you ask questions, map architecture, find experts, and track health.

## Features

- 🔍 **`ask`** — Ask questions in plain English, get answers with file/line references
- 🗺️ **`map`** — Auto-generate architecture diagrams (Mermaid) via community detection
- 👥 **`who`** — Find who knows about a topic based on git history
- 🏥 **`health`** — Complexity hotspots, dead code, bus factor, coupling anomalies
- 📋 **`diff`** — Summarize what changed and why, with coupling-aware warnings
- 🖥️ **Local web app** — Search code, ask questions with citations, and build Claude Code prompts
- 🤖 **Optional LLM** — CLI uses `OPENAI_API_KEY`; the web app uses Gemini

## Install

```bash
npm install -g @phoenixaihub/codebase-gpt
```

Or use with npx:

```bash
npx @phoenixaihub/codebase-gpt index
```

## Quick Start

```bash
# 1. Index your codebase (run from project root)
codebase-gpt index

# 2. Ask questions
codebase-gpt ask "How does authentication work?"
codebase-gpt ask "Where is the database connection setup?"

# 3. Generate architecture map
codebase-gpt map

# 4. Find experts
codebase-gpt who "payment processing"

# 5. Health report
codebase-gpt health

# 6. What changed?
codebase-gpt diff --since v1.0.0
```

## Commands

### `codebase-gpt index`

Builds the knowledge graph. Parses TypeScript, JavaScript, Python, Go, Rust, Java. Analyzes git history for change coupling. Incremental — only re-parses changed files.

```
Options:
  -r, --root <path>   Root directory to index (default: auto-detected)
  -f, --force         Force full re-index
  -v, --verbose       Verbose output
```

**Sample output:**
```
🔍 Scanning files...
  Found 142 source files
🔗 Building import graph...
📊 Computing PageRank...
📝 Generating summaries...
🕰️  Analyzing git history...
  Found 1,203 commits, 87 coupling pairs

✅ Index built successfully
   Files indexed:   142
   Entities:        891
   Import edges:    203
   Coupling pairs:  87
```

### `codebase-gpt ask "<question>"`

Queries the knowledge graph. Uses TF-IDF search + graph traversal to find relevant code. If `OPENAI_API_KEY` is set, enhances with GPT-4o-mini.

```
codebase-gpt ask "How does the user authentication flow work?"
```

**Sample output:**
```
❓ Question: "How does authentication work?"

📍 Relevant code:

Functions / Classes:
  function authenticate @ src/auth/jwt.ts:23
    Validates JWT token and returns user session
  class AuthService @ src/auth/service.ts:45

Files:
  📄 src/auth/jwt.ts
    Functions: authenticate, signToken, verifyToken. Exports: authenticate, AuthService
```

### `codebase-gpt map`

Detects modules via Louvain community detection on the import graph. Outputs Mermaid diagram.

**Sample output:**
````
🗺️  Architecture Map

```mermaid
graph TD
  M0["📦 src/auth<br/>jwt.ts<br/>service.ts"]
  M1["📦 src/api<br/>routes.ts<br/>middleware.ts"]
  M2["📦 src/db<br/>connection.ts<br/>models.ts"]
  M1 --> M0
  M1 --> M2
```
````

### `codebase-gpt who "<topic>"`

Ranks contributors by expertise (recency × frequency × scope).

**Sample output:**
```
👥 Who knows about "payment processing"?

🏆 Expert Ranking:

🥇 Alice Chen
   ██████████ 100% confidence
   Commits: 47 total, 12 recent (90d)
   Files touched: 8

🥈 Bob Smith
   ███████░░░ 71% confidence
   Commits: 23 total, 3 recent (90d)
   Files touched: 5
```

### `codebase-gpt health`

Comprehensive health report including hotspots, coupling anomalies, dead code, and bus factor.

### `codebase-gpt diff [--since <commit>]`

Summarizes changes grouped by area, with coupling-aware warnings for files that *should* have changed but didn't.

## Supported Languages

| Language | Functions | Classes | Interfaces | Imports |
|----------|-----------|---------|------------|---------|
| TypeScript | ✅ | ✅ | ✅ | ✅ |
| JavaScript | ✅ | ✅ | — | ✅ |
| Python | ✅ | ✅ | — | ✅ |
| Go | ✅ | ✅ (structs) | ✅ | ✅ |
| Rust | ✅ | ✅ (structs) | ✅ (traits) | ✅ |
| Java | ✅ (methods) | ✅ | ✅ | ✅ |

## Algorithms

- **Graph construction**: Regex-based AST parsing → entity extraction → edge creation
- **Change coupling**: Apriori-style co-occurrence on git commit sets
- **Community detection**: Greedy Louvain on import graph
- **PageRank**: Identifies core utilities and entry points
- **TF-IDF search**: Query matching over entity names + comments
- **Bus factor**: Shannon entropy on contributor distribution

## Index Location

The index is stored in `.codebase-gpt/index.json` in your project root. Add it to `.gitignore` (or commit it for team sharing):

```gitignore
.codebase-gpt/
```

## AI Project Copilot Web App

The web app reuses the parser, import graph, and TF-IDF search. It binds to `127.0.0.1` only and never runs scripts or Git commands from a selected project.

```powershell
npm install
# Set GEMINI_API_KEY in the repository-root .env file.
npm run web
```

Copy [.env.example](.env.example) to `.env` and set `GEMINI_API_KEY`. `GEMINI_MODEL` is optional and defaults to `gemini-3.8-flash`; if set explicitly, it must name a model available to your API key. At startup, the server loads `.env` from its current working directory with `dotenv`; existing process environment variables take precedence. The key is only used server-side and is never returned to the browser. Open the local URL printed by the server (default `http://127.0.0.1:4173`), enter a project directory, and build its index. Use **Check Gemini** in the page header for a short connection check that sends no repository source.

The web app uses Google's official Gemini [`generateContent` REST API](https://ai.google.dev/api/generate-content). It stores its project list and indexes outside selected repositories in `%USERPROFILE%\.codebase-gpt-web` on Windows or `~/.codebase-gpt-web` on macOS/Linux. Set `CODEBASE_GPT_DATA_DIR` to choose a different local data directory. Set `PORT` or pass `--port` to change the listener port.

The local indexer reads up to 1,000 source files and 24 MB total; individual files are limited to 512 KB, and a scan is capped at 250,000 directory entries. It skips `.env` files, likely secret/credential/private-key filenames, symlinks, common dependency/build directories, and binary or credential-like content. Only TypeScript, JavaScript, Python, Go, Rust, and Java source files are indexed. Scanning and parsing are split into bounded batches. The job checkpoint and staging graph are stored atomically beside the local index, outside the selected project; use **Resume indexing** after an interrupted or partially failed job. **Refresh index** rescans the project, skips unchanged content by hash, and reconciles additions, edits, and deletions before publishing the refreshed graph. The last completed index remains available until a refresh completes. Gemini receives only bounded excerpts selected from indexed search results, not the whole repository. The browser never receives the API key.

Q&A labels results as Gemini-generated or retrieval-only. Generated answers are instructed to separate directly observed code from inference, cite retrieved source excerpts, and state when evidence is missing. Only citations matching retrieved snippets are rendered as verified file/line references; unrecognized model citations are marked as unverified and removed. Gemini errors keep retrieval citations visible and report the failure. The parser primarily extracts symbols and imports; it does not reliably resolve runtime data flow or prove database relationships. Prompt Builder packages retrieved evidence and project constraints for manual review and copy/paste; it does not contact Claude or modify project files.

Q&A retrieval also ranks source lines by exact field/identifier matches and database-write, schema, conditional, and scheduling signals, then follows nearby import relationships (up to two hops) to find connected callers and callees. Production source is prioritized over tests, which remain supplemental evidence. The chat's expandable retrieval details show ranked file/line snippets, match reasons, and source/context/output character counts without logging source text or exposing API credentials. Retrieval scans the already-indexed, size-limited source files for each request; it does not build a persisted full-text or vector index, and import edges are not a complete runtime call graph.

The legacy CLI `index` command retains its existing Git-history analysis. The web app deliberately does not call that command or read Git history.

## Large Repos

- Incremental indexing: only re-parses changed files (hash-based)
- Binary files are automatically skipped
- `node_modules`, `dist`, `build`, `vendor` are excluded

## License

MIT © Phoenix AI Hub

---

## CI Setup

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run build
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
