# Sandcastle

Sandcastle is the sandbox control plane that backs the SHGO coding workflow.
This directory still uses the historical `ai-coding-agent` path, but the live
product surface is Sandcastle.

## What Lives Here

- `pack.ts`
  The Coda Pack / SHGO integration layer.
- `schemas.ts`, `types.ts`
  Pack-side response contracts.
- `middleware/`
  The Sandcastle website, API routes, auth layer, sandbox orchestration, and
  verification scripts.

## Current Product Model

Sandcastle has two user-facing entry points:

1. The website
   - sign in with GitHub
   - launch sandboxes from the marketplace
   - inspect owned sandboxes on the dashboard
   - watch console output, preview URLs, and task history
   - send follow-up prompts or stop active sandboxes
   - store reusable launch-time environment variables
   - mint three-word connector codes for SHGO

2. SHGO / Coda Pack
   - create a sandbox from chat
   - list templates and owned sandboxes
   - resume a sandbox by id
   - continue work in the selected sandbox
   - read files, previews, logs, and status

The system is intentionally async. Creation and follow-up requests return fast
with task/session metadata while the long-running work continues inside a Vercel
Sandbox.

## Current Built-In Templates

- `claude-code`
- `codex`
- `website-deep-dive`
- `wordcount`

Current execution strategies:

- `claude-agent`
- `codex-agent`
- `shell-command`

## Current Documentation

- [`docs/current-state-audit.md`](docs/current-state-audit.md)
- [`docs/templates.md`](docs/templates.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`TASKS.md`](TASKS.md)

## Local Verification

Pack:

```bash
cd projects/ai-coding-agent
npm test
./node_modules/.bin/coda validate pack.ts
./node_modules/.bin/coda build pack.ts
```

Middleware:

```bash
cd projects/ai-coding-agent/middleware
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:e2e
```

## Local Setup

- Copy [`middleware/.env.example`](middleware/.env.example) to
  `middleware/.env.local`.
- Fill in the required secrets locally.
- Keep `.coda.json` local-only; it is ignored and should not be committed.

## Key Environment Variables

Pack / SHGO side:

- `X-Agent-Key` is the Pack system-auth header configured in Coda.

Middleware side:

- `AGENT_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `CONTROL_TOKEN_SECRET`
- `AUTH_SECRET`
- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `TEMPLATE_SERVICE_INTERNAL_KEY`
- `UPSTASH_REDIS_REST_URL` or `KV_URL`
- `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_TOKEN`
- `PUBLIC_APP_URL`

## Deployment Notes

- The middleware deploys to Vercel from `middleware/`.
- The Pack release is separate from the middleware deploy.
- `/api/health` validates auth, Redis, token signing, Anthropic/OpenAI upstream
  config, template registry integrity, and template-service auth.
- Browser sandbox actions are owner-authenticated server routes. The website
  never receives mutable sandbox bearer tokens.
