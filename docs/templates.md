# Sandcastle Templates

This document describes the current template system as implemented in the repo.

## Overview

Templates are application-level definitions exposed through the template-service
layer. The built-in system templates currently originate in
`projects/ai-coding-agent/middleware/lib/templates.ts`, while both the website
and SHGO consume them through template-service APIs.

Each launchable template defines:

- identity: `slug`, `name`, `summary`, `purpose`, `status`
- source model: `runtime` or `snapshot`
- runtime limits: default runtime, supported runtimes, timeout, vCPUs, ports
- execution strategy
- prompt behavior: placeholder, default prompt, initial prompt builder
- launch-time environment schema (`envHints`)
- bootstrap behavior for files and setup inside the sandbox

## Execution Strategies

Sandcastle currently supports three execution strategies:

| Strategy | Initial prompt | Follow-ups | Required provider env |
| --- | --- | --- | --- |
| `claude-agent` | Yes | Yes | `ANTHROPIC_API_KEY` |
| `codex-agent` | Yes | Yes | `OPENAI_API_KEY` |
| `shell-command` | Configurable | No | None by default |

Notes:

- `shell-command` templates can opt into an initial prompt by mapping the prompt
  into an environment variable.
- Shell-command templates never accept follow-up prompts.
- The session viewer and launch UIs rely on execution-strategy metadata rather
  than hardcoded template slugs.

## Environment Schema and Select Fields

Template launch forms are schema-driven.

Current supported field behavior:

- plain text inputs
- secret inputs
- default values
- select lists with explicit options

Current built-ins use this in production:

- `claude-code`
  - `ANTHROPIC_MODEL` select
  - optional `ANTHROPIC_API_KEY` override
- `codex`
  - `OPENAI_MODEL` select
  - optional `OPENAI_API_KEY` override
- `website-deep-dive`
  - `ANTHROPIC_MODEL` select
  - optional `ANTHROPIC_API_KEY` override
  - optional website auth env fields
- `wordcount`
  - prompt input for target file path
  - `WORDCOUNT_METHOD` select

## Provider Environment Rules

Launch-time environment variables are validated before sandbox creation.

Current behavior:

- keys are normalized to uppercase
- duplicates are rejected
- reserved platform keys are blocked
- provider override keys are explicitly allowlisted:
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_MODEL`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`

Provider precedence:

1. user-supplied provider key in launch-time env
2. stored user env var from `/environment`
3. platform default provider key from middleware env

If the required provider key is still missing after resolution, launch fails
with a `400` before sandbox creation.

## Launch Flow

Both creation paths converge into the same shared owned-sandbox flow:

- website route: `POST /api/sandboxes/create`
- SHGO route: `POST /api/sessions`

High-level flow:

1. resolve the template slug through the template service
2. validate runtime, prompt, and launch env
3. resolve template defaults and provider fallbacks
4. create the sandbox from snapshot or runtime
5. bootstrap template files into the sandbox
6. persist the sandbox-local env bundle
7. build the initial prompt for prompt-capable strategies
8. start the strategy-specific runner

## Built-In Templates

### `claude-code`

- execution strategy: `claude-agent`
- purpose: general coding, debugging, refactors, and collaborative work
- bootstrap: shared provider contract files under
  `/vercel/sandbox/sandcastle-template`
- launch controls: Anthropic model select and optional Anthropic key override

### `codex`

- execution strategy: `codex-agent`
- purpose: OpenAI-backed coding work with stable request/result artifacts
- bootstrap: same provider contract layout as `claude-code`
- launch controls: OpenAI model select and optional OpenAI key override

### `website-deep-dive`

- execution strategy: `claude-agent`
- purpose: website research, product understanding, and technical reconnaissance
- bootstrap: same provider contract layout as `claude-code`
- launch controls: Anthropic model select, optional Anthropic key override, and
  optional website auth fields

### `wordcount`

- execution strategy: `shell-command`
- purpose: simple prompt-capable shell-command example
- bootstrap: writes `/vercel/sandbox/wordcount.txt` and README guidance
- prompt behavior: prompt is the target file path
- select behavior: `WORDCOUNT_METHOD` chooses the counting method
- follow-ups: rejected with `400`

## Prompt Behavior

Prompt shaping happens at sandbox creation time.

- `claude-agent` and `codex-agent` templates rewrite the first prompt through
  `resolveTemplatePrompt(...)` and `buildInitialPrompt(...)`.
- Follow-up prompts for those strategies are sent as raw user prompts into the
  existing session/conversation state.
- `shell-command` templates do not re-wrap follow-ups because follow-ups are not
  supported.

## Catalog and Service Layer

The public catalog and internal template-service responses expose:

- `defaultTemplateSlug`
- strategy kind
- whether the template accepts prompts
- the launch-time environment schema used by the website forms

This means the website launch drawers and template catalog render directly from
template metadata rather than one-off UI logic.
