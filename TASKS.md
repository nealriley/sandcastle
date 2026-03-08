# Sandcastle Task List

Last updated: March 8, 2026

## Shipped Baseline

- [x] `/profile` route with GitHub identity and account metadata
- [x] `/environment` route with per-user stored launch-time environment values
- [x] launch-button loading states and double-submit protection
- [x] timed-out/stopped session viewer hardening
- [x] dashboard stopped-state reconciliation for expired sessions
- [x] execution-strategy support in the template service
- [x] shared runner extraction
- [x] `shell-command` execution strategy
- [x] `codex-agent` execution strategy
- [x] current built-in templates reset to:
  - `claude-code`
  - `codex`
  - `website-deep-dive`
  - `wordcount`
- [x] select-list environment fields for template launch forms
- [x] prompt-capable `wordcount` shell-command template
- [x] user provider-key overrides plus platform provider-key fallback

## Current Priorities

### Documentation and Audit

- [x] Keep repo docs aligned with the current shipped product
- [x] Keep Pack vocabulary aligned with the current template catalog
- [x] Record the current audited system state in `docs/current-state-audit.md`

### Verification and Coverage

- [ ] Add real coverage reporting and thresholds for the middleware test suite
- [ ] Expand route-level tests for provider fallback and launch validation
- [ ] Expand smoke coverage for Codex, Website Deep Dive, and schema-driven launch fields
- [ ] Add browser-level E2E coverage for dashboard, marketplace, environment, and session viewer flows

### Cleanup

- [ ] Remove or archive dead references to retired built-ins
- [ ] Decide whether old webpage-inspector template assets should remain as dormant code or be removed
- [x] Keep deployment and release docs aligned between middleware and Pack surfaces

## Later

- [ ] Additional built-in templates beyond the current four
- [ ] More provider strategies if product demand justifies them
- [ ] Stronger automated release validation for both middleware deploys and Pack releases
