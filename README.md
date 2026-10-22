# codebase-gpt

Requires Node.js 18 or later.

## Install and run the CLI

Install globally:

```bash
npm install -g @phoenixaihub/codebase-gpt
```

From the root of a project, build its index and start using the CLI:

```bash
codebase-gpt index
codebase-gpt ask "How does authentication work?"
```

Or run a command without installing globally:

```bash
npx @phoenixaihub/codebase-gpt index
```

## Run the local web app

Clone this repository, then from its root:

```bash
npm install
```

Copy `.env.example` to `.env` and set `GEMINI_API_KEY`, then start the app:

```bash
npm run web
```

Open the local URL printed by the server (default: `http://127.0.0.1:4173`).
