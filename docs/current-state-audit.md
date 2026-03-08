# Sandcastle Current-State Audit

Date: March 8, 2026

## Summary

The current repo implements a stable Sandcastle baseline with:

- two user-facing surfaces: website plus SHGO / Coda Pack
- four live built-in templates
- three live execution strategies
- owner-authenticated browser flows
- stored per-user environment variables
- provider-key override and fallback behavior

The main source of drift is no longer the runtime implementation. It is the
surrounding documentation, Pack-facing vocabulary, and release-validation
coverage.

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
  - mint three-word connector codes for SHGO
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

### Remaining gaps

- middleware tests are healthy but do not yet report formal coverage percentages
- browser/UI flows are still mostly protected by manual testing
- route-level launch validation coverage is thinner than core library coverage
- dormant references to retired built-ins still exist in historical assets and older planning context

## Current Confidence

Strengths:

- core middleware logic has focused tests around templates, execution
  strategies, runners, session state, auth, tokens, and env validation
- current template system is schema-driven rather than hardcoded per template
- stopped/timed-out session handling has been hardened in both viewer and dashboard paths

Primary risk areas:

- drift between repo docs and shipped behavior
- Pack/runtime vocabulary drifting apart from middleware template truth
- regressions in browser flows that do not yet have dedicated E2E coverage

## Recommended Next Work

1. add coverage reporting and thresholds
2. expand smoke coverage for the live template set
3. add browser E2E coverage for the highest-value website flows
4. remove or archive dead references to retired templates once rollout confidence is high
