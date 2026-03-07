# Sandcastle Templates

This document explains how Sandcastle templates work in the live product.

## What A Template Is

In Sandcastle, a template is an application-level definition in
`projects/ai-coding-agent/middleware/lib/templates.ts`. It is not a
Vercel-native "template" resource.

Each template definition includes:

- `slug`, `name`, `summary`, `purpose`
- `source`
  - `runtime`
  - or `snapshot` with a snapshot env var
- `defaultRuntime`
- `supportedRuntimes`
- `ports`
- `timeoutMs`
- `vcpus`
- `promptPlaceholder`
- optional `defaultPrompt`
- `envHints`
- `bootstrap(sandbox, context)`
- `buildInitialPrompt({ prompt, environment })`

The core interface is defined in
`projects/ai-coding-agent/middleware/lib/templates.ts`.

## What Templates Actually Control

Templates currently control four things:

1. Sandbox launch configuration
   - runtime or snapshot source
   - preview ports
   - timeout
   - vCPU allocation

2. Bootstrap assets written into the sandbox
   - shell scripts
   - helper Node modules
   - placeholder files
   - README / manifest files

3. Optional background processes
   - for example, the webpage-inspector template starts a detached HTTP server

4. The first prompt sent to Claude
   - templates rewrite the first task prompt into a template-aware instruction block

Templates do not currently change Claude's allowed tool list. That is fixed in
the runner.

## Launch Flow

Both website sandbox creation and SHGO sandbox creation converge into the same
shared creation path.

High-level flow:

1. The caller selects a `templateSlug`.
2. Sandcastle validates the slug, requested runtime, prompt, and env inputs.
3. Template-specific default environment values are injected if needed.
4. Sandcastle creates the Vercel Sandbox.
5. The template's `bootstrap(...)` function writes helper files into the sandbox.
6. Sandcastle writes the launch environment bundle into the sandbox.
7. The template builds the initial Claude prompt.
8. The Claude runner starts with that prompt.

Relevant files:

- `projects/ai-coding-agent/middleware/app/api/sandboxes/create/route.ts`
- `projects/ai-coding-agent/middleware/app/api/sessions/route.ts`
- `projects/ai-coding-agent/middleware/lib/create-owned-sandbox.ts`

## Source Model

Every template declares a source:

- `runtime`
  Create a fresh sandbox with the selected runtime.

- `snapshot`
  Prefer a snapshot if the configured snapshot env var is present. Otherwise
  fall back to a runtime-based create.

This means snapshot-backed templates still work in environments where the
snapshot id is missing; they just start from a slower fresh sandbox.

## Bootstrap Mechanics

Templates bootstrap by calling `sandbox.writeFiles(...)` and then optionally
running setup commands.

The pattern looks like:

1. Build file contents in TypeScript.
2. Write those files into `/vercel/sandbox/...`.
3. `chmod +x` any shell scripts.
4. Optionally start a detached process.

This is how Sandcastle "installs" template helpers today. We are not publishing
packages or running a separate template installer.

## Environment Variables

Website-created sandboxes can include launch-time environment variables.

Validation rules:

- keys are normalized to uppercase
- max 16 variables
- max 4000 characters per value
- duplicates are rejected
- reserved keys and prefixes are blocked

Blocked examples include:

- `AGENT_API_KEY`
- `ANTHROPIC_API_KEY`
- `AUTH_*`
- `REDIS_*`
- `UPSTASH_*`
- `VERCEL_*`

Implementation lives in
`projects/ai-coding-agent/middleware/lib/sandbox-environment.ts`.

### How env vars reach the sandbox

Sandcastle currently uses two mechanisms:

1. pass `env` into `Sandbox.create(...)`
2. also write a sandbox-local env bundle to:
   `/vercel/sandbox/.sandcastle-env.json`

The second mechanism exists because the currently installed SDK/runtime behavior
has not been reliable enough on its own for persisted follow-up tasks.

### How env vars reach Claude tasks

On every task start, the runner script:

1. reads `/vercel/sandbox/.sandcastle-env.json`
2. loads each entry into `process.env`
3. layers the Anthropic proxy vars on top

That means follow-up tasks continue to see the same user-provided env values.

Important security property:

- raw env values are not stored in Redis ownership records
- browser APIs only expose env key names
- `ReadFile` blocks the env bundle file directly

## Prompt Shaping

There are two different prompt layers in the product.

### 1. SHGO / Pack skill prompt

The Pack prompt tells SHGO when to choose a template and how to route tool
calls. Example: for webpage audit requests, it prefers `webpage-inspector`.

This lives in `projects/ai-coding-agent/pack.ts`.

### 2. Template-built first task prompt

Inside the sandbox, Sandcastle does not currently send a separate hidden
template system prompt to the Claude Agent SDK.

Instead, it generates the first task prompt by calling:

- `resolveTemplatePrompt(...)`
- then `template.buildInitialPrompt(...)`

So the template behavior is currently expressed as a template-specific first
prompt string.

### Follow-ups

Template prompt shaping only happens on sandbox creation.

After that, follow-up prompts are resumed into the same Claude session as raw
user prompts. The template still influences follow-ups because:

- the helper files remain in the sandbox
- the same Claude session retains prior context
- the launch environment is rehydrated for each task

But Sandcastle does not re-wrap every follow-up prompt with the template
instructions.

## Claude Runner Defaults

All templates share the same Claude runner options:

- allowed tools: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`
- `permissionMode: "acceptEdits"`
- `includePartialMessages: true`
- adaptive thinking enabled

This is implemented in
`projects/ai-coding-agent/middleware/lib/agent-runner.ts`.

## Built-In Templates

## `standard`

Purpose:

- general-purpose coding
- installs
- preview servers
- follow-up iteration

Behavior:

- no bootstrap files
- no template-specific helper scripts
- first Claude prompt is just the user prompt trimmed

## `shell-scripts-validation`

Purpose:

- prove template bootstrapping works
- prove launch env wiring works
- prove outbound requests work
- validate authenticated request behavior without printing secrets

Files written:

- `README.md`
- `env-keys.txt`
- `verify-runtime.sh`
- `verify-env.sh`
- `verify-request.sh`
- `verify-all.sh`

What the scripts do:

- `verify-runtime.sh`
  prints runtime/tool availability and lists template files
- `verify-env.sh`
  reads `env-keys.txt` and reports whether each key is present
- `verify-request.sh`
  performs a `curl` request to `VALIDATION_REQUEST_URL`, optionally with an
  auth header
- `verify-all.sh`
  runs the other checks in sequence

Default env behavior:

- if `VALIDATION_REQUEST_URL` is not provided, Sandcastle injects its own
  `/api/template-validation` URL by default

First-task prompt behavior:

- tells Claude this is the validation template
- lists the available scripts
- lists the env keys available in the sandbox
- tells Claude to use the scripts rather than inventing the workflow
- appends `User request: ...`

## `webpage-inspector`

Purpose:

- inspect an HTTP/HTTPS page
- collect structured diagnostics
- render an HTML report
- keep a preview server running for the generated report

Files written:

- `README.md`
- `env-keys.txt`
- `page-audit-lib.mjs`
- `page-inspector.mjs`
- `inspect-page.sh`
- `serve-report.sh`
- `show-summary.sh`
- `output/latest-summary.txt`
- `report-site/index.html`

Background process:

- starts a detached Python HTTP server on port `4173`
- serves `report-site/` so the generated HTML report is previewable immediately

Optional env vars:

- `PAGE_AUDIT_AUTH_TOKEN`
- `PAGE_AUDIT_AUTH_HEADER_NAME`
- `PAGE_AUDIT_AUTH_SCHEME`

What the inspector library does:

- normalizes the target URL
- fetches the page with optional auth headers
- captures final URL, status, duration, and response headers
- extracts:
  - title
  - meta description
  - robots/meta tags
  - OG tags
  - canonical
  - `html lang`
  - viewport
  - H1 / H2 text
  - link/image/script/stylesheet/form counts
- checks security headers:
  - CSP
  - HSTS
  - X-Frame-Options
  - Referrer-Policy
  - X-Content-Type-Options
  - Permissions-Policy
- collects technology hints from the DOM and headers
- probes `robots.txt` and `sitemap.xml`
- generates:
  - JSON report
  - plain-text summary
  - rendered HTML report

First-task prompt behavior:

- tells Claude the report server is already running
- gives an explicit five-step required workflow
- points Claude at the helper scripts and output paths
- lists sandbox env keys without printing raw secret values
- tells Claude to mention the rendered HTML report in its response

## What The Website Exposes

The templates API intentionally exposes catalog metadata only:

- template name
- slug
- summary
- runtime info
- launch label

It does not expose bootstrap code or prompt-builder internals.

The website uses `envHints` to render environment-variable inputs per template.

## Adding A New Template

The current contract for a new built-in template is:

1. Add a new template definition to
   `projects/ai-coding-agent/middleware/lib/templates.ts`
2. Define its:
   - slug
   - metadata
   - source
   - runtime support
   - env hints
   - bootstrap function
   - initial prompt builder
3. If it needs helper assets, generate them from a dedicated file under
   `projects/ai-coding-agent/middleware/lib/template-assets/`
4. If it needs a preview, declare the port and start the server during bootstrap
5. If it needs defaults, implement them in `resolveTemplateEnvironment(...)`
6. If SHGO should prefer it for certain tasks, update the Pack skill prompt

## Practical Summary

Today, a Sandcastle template is best understood as:

- launch config
- bootstrap file set
- optional background service
- first-prompt wrapper

That is the current implementation boundary.
