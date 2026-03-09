# Sandcastle Current-State Audit

Date: March 9, 2026

## Summary

The current repo implements a strong Sandcastle baseline with:

- three user-facing surfaces: website, SHGO / Coda Pack, and remote MCP
- four live built-in templates
- three live execution strategies
- owner-authenticated browser flows
- stored per-user environment variables
- provider-key override and fallback behavior

The main unresolved risk is no longer templates or execution strategies. It is
connector stability, especially on the SHGO / Pack path.

## Current Functionality Inventory

### Website

Current signed-in routes and capabilities:

- `/dashboard`
  - view owned sandboxes and their effective active/stopped state
- `/marketplace`
  - launch from schema-driven template metadata
- `/environment`
  - create, update, reveal, and delete saved launch-time environment values
- `/connect`
  - browse the available connectors
- `/connect/[connectorSlug]`
  - view setup details for SHGO and MCP
  - `/connect/mcp` now includes client-specific setup guides for Claude Code,
    Claude web, Codex, and ChatGPT
- `/connect/mcp/authorize`
  - approve OAuth access for an MCP client
- `/profile`
  - inspect GitHub identity and Sandcastle account metadata
- `/sessions/[viewToken]` and `/sandboxes/[viewToken]`
  - view console output, task history, preview URLs, prompt controls, and status

### SHGO / Pack

Current Pack capabilities:

- create a new sandbox
- list templates
- list owned sandboxes
- resume a sandbox by id
- continue a selected sandbox
- read file contents
- fetch preview URLs
- fetch task/session status
- stop a sandbox

Operational note:

- this remains the least reliable production surface today

### MCP

Current MCP capabilities:

- protected-resource and authorization metadata discovery
- dynamic public-client registration
- browser-based GitHub-backed OAuth approval
- list templates
- launch an owned sandbox
- continue an active Claude or Codex sandbox
- list owned sandboxes
- inspect sandbox state, previews, tasks, and logs
- read sandbox files
- stop an owned sandbox

### Template System

Current built-ins:

- `claude-code`
- `codex`
- `website-deep-dive`
- `wordcount`

Current execution strategies:

- `claude-agent`
- `codex-agent`
- `shell-command`

Current launch-form features:

- text inputs
- secret inputs
- select-list inputs
- default values
- stored-env prefill when keys match

Current `wordcount` behavior:

- prompt input is raw text, not a file path
- startup command writes that text to a temporary file
- selected method then counts words from that temp input

## Audit Findings

### Resolved in this batch

- stale Pack-facing template names and default template slug
- stale smoke expectations for `wordcount`
- stale top-level docs and backlog notes
- release workflow is now documented for both middleware and Pack surfaces
- connector management is now a generalized product surface
- remote MCP discovery, auth, and owner-scoped tools are now implemented
- March 9 reliability audit:
  - MCP auth discovery no longer depends on rewrites for the well-known metadata URLs
  - website-owned sandbox resolution now returns typed JSON failures instead of throwing through route handlers
  - website `view`, `stop`, and `prompt` routes now keep param extraction and failure handling inside one guaranteed-response flow
  - regression tests now cover MCP metadata response generation and website-owned sandbox lookup failure paths
  - added direct owner+sandbox indexing so exact connector lookup is no longer limited to only recent-session windows
  - documented the current connector-stability incident and next-step recommendation in `docs/connector-stability-retrospective.md`

### Remaining gaps

- middleware tests are healthy but do not yet report formal coverage percentages
- browser/UI flows are still mostly protected by manual testing
- route-level launch validation coverage is thinner than core library coverage
- dormant references to retired built-ins still exist in historical assets and older planning context
- SHGO and MCP still share ownership through website `user.id`, but they do not
  yet share one connector-grant model
- SHGO remains the least stable connector even after ownership-index and route-shape hardening
- several recent SHGO failures were production-only App Router `500`s rather than clean auth or ownership errors

## Current Confidence

Strengths:

- core middleware logic has focused tests around templates, execution
  strategies, runners, session state, auth, tokens, and env validation
- current template system is schema-driven rather than hardcoded per template
- stopped/timed-out session handling has been hardened in both viewer and dashboard paths
- MCP and website behavior are materially closer to stable than they were at the
  start of this audit cycle

Primary risk areas:

- SHGO connector auth and route reliability
- regressions in browser flows that do not yet have dedicated E2E coverage
- lack of true cross-connector end-to-end smoke coverage
- Pack/runtime vocabulary drifting apart from middleware template truth when connector behavior changes

## Recommended Next Work

1. pause new connector features and treat SHGO stability as the top engineering task
2. add route-level tests and post-deploy canaries for `/api/sessions`, `/api/sandboxes`, and `/api/sandboxes/resume`
3. add true cross-connector smoke coverage for MCP -> SHGO and SHGO -> MCP flows
4. extract connector-neutral create/list/resume/continue services behind the auth layer
5. decide whether SHGO should remain pairing-code based or move toward Pack OAuth
