# Sandcastle 1.0 Release Plan

## 1.0 Definition Of Done

- [x] Product is fully rebranded from Superhuman Go / SHGO to **Sandcastle** across the middleware app, Pack copy, metadata, docs, and supporting setup copy.
- [x] Signed-in navigation is finalized as **Sandboxes**, **Templates**, and **Connector**.
- [x] **Sandboxes** defaults to active sandboxes, supports template-based creation, and remains the main operational dashboard.
- [x] **Templates** shows the built-in templates available to users and becomes the entry point for choosing how a sandbox starts.
- [x] **Connector** replaces the old pairing/auth surface and clearly handles the SHGO-to-website connection flow.
- [x] New sandbox creation/settings supports user-provided environment variables for that sandbox session.
- [x] Built-in templates include:
  - Standard template
  - Shell scripts validation template for proving the template system works end to end
  - Webpage inspector template for URL-driven audits with a rendered HTML report preview
- [x] Release candidate passes the current security and stability audit, with practical findings fixed and low-yield items explicitly deferred.

## Release-Candidate Checks Completed

- [x] Async sandbox/task flow with browser-first sandbox console
- [x] Template-aware website and SHGO creation flows
- [x] Owned sandbox listing and resume flows
- [x] Connector-based website-to-SHGO auth handoff
- [x] Website-owner enforcement for browser sandbox actions
- [x] Anthropic proxy isolation from the sandbox
- [x] Launch-time env injection with secret-safe UI handling
- [x] ReadFile guardrails for sensitive internal files
- [x] Deterministic task results, clearer recovery semantics, and task artifact cleanup
- [x] Startup/readiness validation via `/api/health`
- [x] Middleware tests plus `pnpm smoke:e2e`
- [x] Docs and setup copy refreshed for the Sandcastle 1.0 model
- [x] Pack base URL cleanup and Next/Turbopack config cleanup

## Explicit Deferrals After 1.0

- [ ] Add more built-in templates beyond `standard`, `shell-scripts-validation`, and `webpage-inspector`.
- [ ] Revisit the GitHub auth callback `url.parse()` deprecation warning if Next/Auth exposes a practical app-level fix.

## Next Step

- [ ] Run the final full end-to-end release test across:
  - website sign-in
  - template launch
  - env-var validation
  - SHGO connector pairing
  - SHGO sandbox create/list/resume/continue
  - browser console, preview, prompt, and stop flows
