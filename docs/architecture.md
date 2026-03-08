# Sandcastle Architecture

Status: current repo architecture
Date: March 8, 2026

## Overview

Sandcastle is a sandbox control plane for long-running coding and automation
work. It has two user-facing surfaces operating on the same owned-sandbox
records:

- the Sandcastle website
- the SHGO / Coda Pack integration

The control plane is intentionally async. Requests return quickly with
task/session metadata while the actual work continues inside a Vercel Sandbox.

## Current Product Surfaces

### Website

Current signed-in website surface:

- `/dashboard`
- `/marketplace`
- `/environment`
- `/connect`
- `/profile`
- `/sessions/[viewToken]`
- `/sandboxes/[viewToken]`

Current capabilities:

- launch from template metadata
- see owned sessions and previews
- prompt active sessions
- stop active sessions
- inspect console output and task history
- store reusable environment variables
- mint connector codes for SHGO

### SHGO / Pack

The Pack is the chat control surface for:

- creating a sandbox
- listing templates
- listing owned sandboxes
- resuming a sandbox
- continuing a selected sandbox
- checking task status
- reading files and previews
- stopping a sandbox

## Middleware Responsibilities

The Next.js middleware app handles:

- GitHub auth and owner enforcement
- template resolution and launch validation
- sandbox creation and bootstrap
- execution-strategy runner dispatch
- task/session state reads
- preview and file proxying
- signed control/view tokens
- Redis-backed ownership, pairing, and per-user environment storage
- Anthropic proxying for Claude-based sandboxes

## Template and Runner Model

Templates now describe both sandbox configuration and what executable performs
the work inside the sandbox.

Current execution strategies:

- `claude-agent`
- `codex-agent`
- `shell-command`

Current built-in templates:

- `claude-code`
- `codex`
- `website-deep-dive`
- `wordcount`

Shared runner infrastructure handles:

- JSONL log writing
- result-file persistence
- phase tracking and progress events
- stall/timeout monitoring
- stream aggregation and final-result selection

Strategy-specific runners provide:

- Claude Agent SDK integration
- Codex/OpenAI tool loop
- direct shell-command execution

## Auth and Ownership

### Website auth

- Auth.js + GitHub OAuth
- every browser-visible sandbox belongs to one website user
- browser routes validate both the signed token and Redis ownership

### SHGO pairing

- new sandbox creation and owned-sandbox listing require a three-word connector
  code
- pairing codes are short-lived, single-use for redemption, and stored in Redis

### Token model

Current signed tokens:

- sandbox control tokens
- task tokens
- view tokens
- Anthropic proxy tokens

Token signing uses dedicated secrets rather than `AGENT_API_KEY`.

## Environment Model

Launch-time environment values are validated server-side and also persisted into
the sandbox-local env bundle so follow-up tasks can rehydrate the same values.

Current important behavior:

- provider override keys are allowed for Anthropic/OpenAI
- stored user env vars from `/environment` are merged into launch-time env
- provider defaults fall back to platform `ANTHROPIC_API_KEY` or
  `OPENAI_API_KEY` when the user does not supply one
- raw values are never exposed back to the browser or stored in ownership
  records

## Operational Validation

Current verification commands:

```bash
cd projects/ai-coding-agent
npm test
./node_modules/.bin/coda validate pack.ts
./node_modules/.bin/coda build pack.ts

cd projects/ai-coding-agent/middleware
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:e2e
```

Current smoke behavior:

- `claude-code` and `wordcount` are always exercised
- the Codex smoke path runs when `OPENAI_API_KEY` is configured
- `SANDCASTLE_SMOKE_SKIP_CODEX=1` disables the Codex smoke path explicitly

Current health checks cover:

- agent auth
- Anthropic upstream config
- OpenAI upstream config
- token signing
- Redis
- website auth
- template registry
- template-service auth

## Release Mechanics

Middleware and Pack ship separately.

- Middleware:
  - deploy from `projects/ai-coding-agent/middleware`
  - current production path is `vercel deploy --prod --yes`
- Pack:
  - validate/build from `projects/ai-coding-agent`
  - upload and release separately with the Coda CLI
  - `coda release` requires a clean committed working tree

That means a green middleware deploy does not automatically publish new Pack
behavior, and a Pack upload alone does not make a version installable until the
release step succeeds.
