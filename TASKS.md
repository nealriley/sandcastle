# Sandcastle Task List

Last updated: March 9, 2026

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

### Stability Pause

- [ ] Stop adding new connector-facing features until SHGO create/list/resume are production-stable
- [ ] Add route-level regression tests for `/api/sessions`, `/api/sandboxes`, and `/api/sandboxes/resume`
- [ ] Add post-deploy canaries for the SHGO create/list/resume route family
- [ ] Add a true MCP -> SHGO end-to-end smoke flow
- [ ] Add a true SHGO -> MCP end-to-end smoke flow
- [ ] Decide whether SHGO remains pairing-code based or moves toward Pack OAuth2 user auth

### Documentation and Audit

- [x] Keep repo docs aligned with the current shipped product
- [x] Keep Pack vocabulary aligned with the current template catalog
- [x] Record the current audited system state in `docs/current-state-audit.md`
- [x] Document route-handler reliability rules for critical Next.js endpoints
- [x] Document current connector auth model and Pack OAuth migration constraints

### Verification and Coverage

- [ ] Add real coverage reporting and thresholds for the middleware test suite
- [ ] Expand route-level tests for provider fallback and launch validation
- [ ] Expand smoke coverage for Codex, Website Deep Dive, and schema-driven launch fields
- [ ] Add browser-level E2E coverage for dashboard, marketplace, environment, and session viewer flows

### Connector Auth Stabilization

- [x] Stop relying on recent-session scans for exact sandbox lookup
- [ ] Make owned-sandbox listing limits explicit and configurable
- [ ] Extract connector-neutral create/list/resume/continue services behind the auth layer
- [ ] Decide whether SHGO should remain pairing-code based or move to Pack OAuth2 user auth

### Cleanup

- [ ] Remove or archive dead references to retired built-ins
- [ ] Decide whether old webpage-inspector template assets should remain as dormant code or be removed
- [x] Keep deployment and release docs aligned between middleware and Pack surfaces

## Later

- [ ] Additional built-in templates beyond the current four
- [ ] More provider strategies if product demand justifies them
- [ ] Stronger automated release validation for both middleware deploys and Pack releases
