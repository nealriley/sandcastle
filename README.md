# Sandcastle

Sandcastle is the sandbox control plane that backs the SHGO coding workflow.
This directory still uses the historical `ai-coding-agent` path, but the live
product surface is Sandcastle.

## What Lives Here

- `pack.ts`
  The Coda Pack / SHGO integration layer.
- `helpers.ts`
  Shared Pack URL helpers.
- `schemas.ts`, `types.ts`
  Pack-side response contracts.
- `middleware/`
  The Sandcastle website, API routes, auth layer, sandbox orchestration, and
  test scripts.

## Current Product Model

Sandcastle has two user-facing entry points:

1. The website
   - sign in with GitHub
   - create sandboxes from templates
   - view owned sandboxes
   - inspect console output and previews
   - prompt or stop active sandboxes
   - mint three-word connector codes

2. SHGO
   - create a sandbox from chat
   - list owned sandboxes
   - resume a sandbox by id
   - continue work in the currently selected sandbox
   - read files / previews / status

The system is intentionally async. Chat requests return fast with a sandbox URL,
while the long-running task continues inside a Vercel Sandbox.

## Built-In Templates

- `standard`
- `claude-code`
- `codex`
- `shell-scripts-validation`
- `webpage-inspector`

Template internals are documented in
[`docs/templates.md`](docs/templates.md).

Architecture and release-plan docs live alongside the repo:

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
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:e2e
```

## Local Setup

- Copy [`middleware/.env.example`](middleware/.env.example) to `middleware/.env.local`.
- Fill in the required secrets locally.
- Keep `.coda.json` local-only; it is ignored and should not be committed.

## Key Environment Variables

Pack / SHGO side:

- `X-Agent-Key` is the Pack system-auth header configured in Coda.

Middleware side:

- `AGENT_API_KEY`
- `ANTHROPIC_API_KEY`
- `CONTROL_TOKEN_SECRET`
- `AUTH_SECRET`
- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `UPSTASH_REDIS_REST_URL` or `KV_URL`
- `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_TOKEN`
- `PUBLIC_APP_URL`

## Deployment Notes

- The Pack uses the canonical middleware base URL from `helpers.ts`.
- The middleware health route (`/api/health`) now validates auth, Redis, token
  signing, Anthropic upstream config, and template registry integrity.
- Browser sandbox actions are owner-authenticated server routes. The website no
  longer receives mutable sandbox bearer tokens.

## Release Candidate Notes

Current intentional deferrals:

- more built-in templates beyond the five live ones
- the GitHub auth callback `url.parse()` deprecation warning, which currently
  appears to be upstream behavior in the Next/Auth stack
