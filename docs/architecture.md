# Sandcastle 1.0 Architecture

> Project paths still use `projects/ai-coding-agent/` for continuity, but the
> product is now **Sandcastle**.
>
> Status: release-candidate architecture
> Date: March 7, 2026

## Overview

Sandcastle is a sandbox control plane for long-running coding work. It has two
user-facing surfaces that operate on the same owned sandbox records:

- The **Sandcastle website**: sign in, create sandboxes from templates, inspect
  live console output, prompt active sandboxes, stop them, and manage previews.
- The **SHGO / Coda Pack integration**: create, list, resume, and continue the
  same owned sandboxes from chat.

The current product is intentionally async. Chat requests return quickly with a
browser sandbox URL, while long-running work continues inside a Vercel Sandbox.

## Current System

```text
User
  |\
  | \-- Sandcastle website (Next.js app)
  |      - GitHub sign-in via Auth.js
  |      - Sandboxes / Templates / Connector UI
  |      - Owner-authenticated browser actions
  |
  \---- SHGO agent (Coda Pack)
         - creates/resumes sandboxes
         - polls task status
         - lists owned sandboxes/templates
         - uses short-lived connector codes for ownership handoff
             |
             v
Sandcastle middleware (Next.js API routes on Vercel)
  - sandbox lifecycle orchestration
  - template bootstrap and env injection
  - task status + console aggregation
  - signed control/view tokens
  - website ownership enforcement
  - Anthropic proxy
             |
             v
Vercel Sandbox
  - isolated runtime
  - Claude-based coding agent runner
  - filesystem + commands + previews
  - template bootstrap assets
```

## Product Surfaces

### 1. Sandcastle website

Primary routes:

- `/sandboxes`
  Active-sandbox table with prompt / kill / settings actions.
- `/templates`
  Template catalog and sandbox launcher.
- `/connector`
  Website-authenticated three-word pairing flow for SHGO.
- `/sandboxes/[viewToken]`
  Owner-locked sandbox console with status, preview links, prompt composer,
  live console, activity, and rendered template previews.

The website never receives mutable sandbox bearer tokens. Browser writes go
through website-authenticated routes keyed by `sessionKey`.

### 2. SHGO / Pack

The Pack remains the chat control surface for:

- creating a new sandbox
- continuing the selected sandbox
- listing templates
- listing owned sandboxes
- resuming a sandbox by id
- checking task status
- reading files, previews, and stopping sandboxes

New sandbox creation is gated by a short-lived three-word connector code.
Follow-up and status actions use signed sandbox/task tokens, not a global
long-lived key on every route.

## Auth And Ownership Model

### Website auth

- Auth.js + GitHub OAuth
- Every browser-visible sandbox belongs to one website user
- Website routes validate both:
  - the signed `viewToken`
  - the logged-in owner from Redis ownership data

### SHGO pairing

- SHGO keeps the shared Pack auth header only for `POST /api/sessions`
- New sandbox creation, owned-sandbox listing, and resume flows require a
  three-word connector code minted on `/connector`
- Pairing codes are:
  - three lowercase words
  - single use for redemption
  - short lived
  - stored in Redis

### Token model

Signed tokens currently in use:

- `ses_...` sandbox control token
- `tsk_...` task token
- `view_...` browser view token
- `atp_...` Anthropic proxy token

Token signing uses dedicated secrets, not `AGENT_API_KEY`.

## Sandbox Lifecycle

### Creation paths

Two creation paths converge into the same ownership model:

1. Website-authenticated create:
   `POST /api/sandboxes/create`
2. SHGO create:
   `POST /api/sessions`

Both call the shared owned-sandbox creation path in
`projects/ai-coding-agent/middleware/lib/create-owned-sandbox.ts`.

### Task model

Every prompt launches an async task:

1. create or reuse sandbox
2. write/update task state files in the sandbox
3. start the Claude runner
4. return quickly with:
   - `taskId`
   - `sandboxId`
   - `sandboxToken`
   - `sandboxUrl`
   - status/phase metadata
5. poll via `/api/tasks/[taskId]` or sandbox status APIs

Long-running work is expected. The system now supports:

- explicit task phases
- console tails in status responses
- stall detection / runner warnings
- deterministic final-result selection
- artifact pruning for older task files

## Template System

Templates live in `projects/ai-coding-agent/middleware/lib/templates.ts`.

Each template defines:

- slug, name, summary, status
- source model (`runtime` or `snapshot`)
- runtime and resource defaults
- env hints for launch-time configuration
- bootstrap function for files/scripts/setup
- initial prompt builder

Current built-in templates:

- `standard`
- `shell-scripts-validation`
- `webpage-inspector`

For the full template contract and current implementation details, see
`docs/templates.md`.

### Environment variables

Launch-time env vars are validated server-side and written into the sandbox via
Sandcastle’s own env persistence layer. Raw values are never shown in the UI or
stored in Redis ownership records.

### Validation template

The shell-scripts template proves:

- template bootstrap works
- runtime tools are present
- launch env keys are available inside the sandbox
- outbound HTTPS requests work

It defaults to Sandcastle’s own `/api/template-validation` endpoint.

## Anthropic Integration

The sandbox does not receive the raw upstream Anthropic API key.

Instead:

1. the middleware mints a short-lived proxy token
2. the sandbox points at `/api/anthropic/...`
3. the middleware attaches the real upstream key server-side

This removes the original “shared upstream key inside a user-steerable sandbox”
design flaw.

## Persistence Model

Redis stores durable control-plane state:

- pairing codes
- ownership records
- recent owned sandbox lists
- rate-limiter counters

Sandbox-local state stores transient execution details:

- task manifests
- console/log files
- result files
- template bootstrap assets
- launch env bundle for process hydration

The `ReadFile` route blocks internal control files, including the sandbox env
bundle.

## Key API Surfaces

### SHGO / Pack routes

- `POST /api/sessions`
- `POST /api/sandboxes`
- `POST /api/sandboxes/resume`
- `GET /api/tasks/[taskId]`
- `POST /api/sessions/[sessionId]/prompt`
- `GET /api/sessions/[sessionId]/status`
- `GET /api/sessions/[sessionId]/file`
- `GET /api/sessions/[sessionId]/preview`
- `POST /api/sessions/[sessionId]/stop`

### Website routes

- `POST /api/sandboxes/create`
- `POST /api/sandboxes/[sessionKey]/prompt`
- `POST /api/sandboxes/[sessionKey]/stop`
- `GET /api/view/[viewToken]`
- `GET /api/templates`
- `GET /api/template-validation`
- `GET /api/health`

The old task-log endpoint is retired and returns `410`.

## Operational Validation

`GET /api/health` now reports actual readiness checks for:

- `AGENT_API_KEY`
- `ANTHROPIC_API_KEY`
- token-signing configuration
- Redis configuration
- website auth configuration
- template registry configuration

The health route returns `500` when the deploy is not ready.

## Testing And Release Checks

Primary verification commands:

```bash
cd projects/ai-coding-agent
npm test
./node_modules/.bin/coda validate pack.ts
./node_modules/.bin/coda build pack.ts

cd middleware
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:e2e
```

The end-to-end smoke script covers:

- connector pairing
- SHGO-style sandbox creation
- template-backed website creation
- env var injection
- owned sandbox listing
- resume / continue flows
- task polling and cleanup

## Known Deferred Items

These are intentionally not release blockers for the current 1.0 candidate:

- additional built-in templates beyond the three live ones
- the GitHub auth callback `url.parse()` deprecation warning, which appears to
  come from current upstream Next/Auth internals rather than app code

## Directory Map

```text
projects/ai-coding-agent/
  helpers.ts                 Pack URL helpers
  pack.ts                    SHGO / Coda Pack formulas and skills
  schemas.ts                 Pack result schemas
  types.ts                   Shared Pack-side response types
  middleware/
    app/                     Website and API routes
    lib/                     sandbox, auth, token, template, and ownership logic
    scripts/                 smoke tests and snapshot utilities
    tests/                   middleware test suite
```

## Summary

Sandcastle 1.0 is no longer “chat waits for a coding run to finish.” It is an
owned sandbox platform with:

- async execution
- browser-visible state
- template-based sandbox creation
- env-aware launch flows
- secure SHGO handoff
- Redis-backed ownership and rate limits
- explicit readiness checks

That is the system the docs, UI, middleware, and Pack now need to stay aligned
with.
