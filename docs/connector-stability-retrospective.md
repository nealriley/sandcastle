# Sandcastle Connector Stability Retrospective

Status: active incident record and planning input
Date: March 9, 2026

## Why this document exists

Sandcastle now has three real user-facing entry points:

- website
- SHGO / Coda Pack
- remote MCP clients

They all operate on the same owned sandboxes, but they do not yet share one
clean auth and transport model. Over the last few days, that has produced a
repeating pattern:

- one surface works
- another surface fails with a different auth or route symptom
- we patch the failing seam
- a neighboring seam then fails under a different connector path

This document records what we changed, what the system is doing today, what
still appears unstable, and what should happen next.

## Current state by surface

### Website

Current status:

- mostly working
- sandbox creation, dashboard listing, session viewing, preview access, stop,
  and follow-up flows have all worked in production during the latest passes
- this surface has had several `500` regressions already, but the latest
  hardening reduced the main known failures

Residual risk:

- still relies on Next.js App Router route-handler patterns that have proven
  sensitive to production-only behavior
- still lacks browser E2E coverage for the highest-value paths

### MCP

Current status:

- mostly working
- Claude.ai and other remote MCP clients were able to complete auth
- MCP-created sandboxes appeared correctly on the website
- MCP follow-up prompts are implemented for follow-up-capable strategies

Failures already seen and addressed:

- OAuth discovery metadata intermittently failed
- well-known metadata routes were unstable when routed indirectly
- tool responses were not explicit enough about real Sandcastle follow-along
  URLs
- request URL fallback leaked `localhost` into follow-along links

Residual risk:

- discovery/auth paths need permanent canaries
- MCP remains sensitive to metadata-route correctness and URL derivation

### SHGO / Coda Pack

Current status:

- still the least stable surface
- ownership is conceptually shared with the website and MCP through
  `website user.id`
- the user-facing pairing flow still works as a concept
- real production end-to-end usage is still unreliable

Recent observed failures:

- `POST /api/sandboxes` failed in production at March 9, 2026 09:39:53 UTC
- `POST /api/sandboxes/resume` failed in production at March 9, 2026 09:40:36 UTC
- `POST /api/sessions` failed in production at:
  - March 9, 2026 09:47:59 UTC
  - March 9, 2026 09:48:12 UTC
  - March 9, 2026 09:48:31 UTC

All of those failures logged the same runtime message:

- `No response is returned from route handler`

Important distinction:

- MCP to website handoff worked
- website access to MCP-created sandboxes worked
- SHGO remained the unstable connector

That means the remaining problem is not simply "ownership data is wrong." It is
specifically the SHGO auth + route boundary.

## What we changed during this stabilization cycle

### Route-handler hardening

We repeatedly moved production-critical routes toward the same pattern:

- `export async function ...`
- one outer `try/catch`
- body parsing inside the route
- auth and ownership resolution inside the route
- direct final `Response.json(...)` from the route
- no async work in `catch`

This helped on:

- website session routes
- MCP well-known metadata routes
- several SHGO routes

But it did not fully eliminate production-only route failures. The lesson is
not just "flatten more code." It is that Sandcastle must stop treating
route-shaping as an implementation detail.

### Connector lookup hardening

We added a direct owner+sandbox Redis index so exact sandbox lookup no longer
depends only on a short "recent sessions" window.

That was the right change and should remain, but it was not sufficient to make
SHGO stable end to end.

### MCP auth and URL work

We:

- replaced rewrite-dependent metadata paths with direct well-known routes
- clarified MCP follow-along URL output
- bound MCP URL generation to the real incoming request

That stabilized the MCP surface substantially.

### Documentation and audit work

We added:

- `docs/route-handler-reliability.md`
- `docs/connector-auth-stability.md`

Those were necessary, but the system still needed one more honest document:
this retrospective.

## Why the current approach feels like whack-a-mole

### 1. We have one ownership model but three access models

Owned sandboxes are ultimately tied to one website user identity, but each
surface reaches that ownership through a different grant:

- website session cookie
- SHGO three-word pairing code plus Pack system auth
- MCP OAuth bearer token

This means every product flow has two concerns mixed together:

- what the user owns
- how this connector proves it is acting for that user

That translation layer is different per surface, so the same product action
must be validated through three separate route families.

### 2. SHGO is not just another client

SHGO does not authenticate like MCP, and it does not operate like the website.
It uses:

- Pack system auth for the server
- a user-scoping pairing code in the request body

That pairing code started as a lightweight handoff. It now also functions as a
user grant for:

- create
- list
- resume
- continue

That is too much responsibility for an ephemeral manual code.

### 3. Too much product behavior still lives in route seams

We have good library coverage for:

- templates
- execution strategies
- session state
- env validation
- auth helpers

But the real failures have been concentrated at the HTTP seam:

- route handler shape
- auth translation
- body parsing
- ownership lookup wiring
- Pack/MCP specific response shaping

This is why local library confidence has not translated into connector
stability.

### 4. We do not yet have the right end-to-end automated checks

What is missing is not just "more tests." It is the right tests:

- create via MCP, then use SHGO
- create via SHGO, then inspect via MCP
- real Pack-authenticated control-plane create/list/resume checks
- post-deploy canaries for the exact SHGO routes that have failed

Without those, each new deploy can re-break a connector path that looked fine
locally.

## Recommended path forward

### Recommendation 1: stop adding connector features until SHGO is stable

Do not add more Pack-facing features right now.

The current problem is not feature completeness. It is that the connector model
is structurally inconsistent and insufficiently verified.

### Recommendation 2: treat SHGO as a dedicated stabilization project

Do not continue fixing SHGO opportunistically inside unrelated feature work.

Create a focused stabilization pass with one goal:

- make create, list, resume, and continue deterministic for SHGO

That pass should include:

- a full route-by-route inventory of SHGO endpoints
- direct route-level tests for each endpoint
- a Pack-driven smoke harness that exercises the real request contract
- post-deploy verification against production

### Recommendation 3: move business logic behind connector-neutral services

The website, MCP, and SHGO should not each reinvent ownership and action
orchestration in their own routes.

The better boundary is:

- connector-specific auth translation at the edge
- connector-neutral application services behind it

That means:

- auth layer maps request -> connector principal
- shared service layer handles create/list/resume/continue/stop
- route handler only translates HTTP input/output

Today we partially do this. We do not do it consistently enough.

### Recommendation 4: decide whether the pairing code is temporary or strategic

This is the central product question.

If SHGO is temporary or secondary:

- keep the pairing code only long enough to unblock current users
- invest minimally beyond stabilization

If SHGO is strategic:

- stop doubling down on the three-word code
- move toward Pack OAuth2 user auth or another durable user-grant model

The current pairing model is still workable as a bootstrap, but it is a weak
long-term foundation for a connector that needs reliable create/list/resume
behavior.

### Recommendation 5: add a clear migration decision document before more auth work

Before writing another SHGO auth patch, decide explicitly between:

- Path A: pairing bootstrap plus durable Sandcastle-issued connector grant
- Path B: Pack OAuth2 user authentication

The system can support either direction, but continuing without choosing will
keep producing local improvements without architectural closure.

## Proposed next execution plan

When work resumes, use this order.

### Phase 1: stabilize what exists

- reproduce the latest SHGO failure with a fresh pairing code
- trace the exact request/response path in production logs
- add route-level tests for `/api/sessions`, `/api/sandboxes`, and
  `/api/sandboxes/resume`
- add a smoke script that uses the Pack request contract directly
- add post-deploy canaries for those three SHGO routes

Goal:

- SHGO create/list/resume are production-stable with the current pairing model

### Phase 2: reduce connector duplication

- extract connector-neutral create/list/resume/continue services
- make website, MCP, and SHGO all call the same service layer
- keep connector-specific auth translation separate from product logic

Goal:

- one sandbox application model, three connector adapters

### Phase 3: choose the durable SHGO auth model

- evaluate whether SHGO should remain pairing-code based
- if yes, define a durable connector grant behind the pairing bootstrap
- if no, design a Pack OAuth2 migration

Goal:

- remove the current ambiguity around whether pairing codes are bootstrap-only
  or a permanent user-grant mechanism

## Bottom line

The recent work was not wasted. It clarified the system.

What we now know:

- ownership data is not the primary remaining problem
- MCP and website are much closer to stable
- SHGO is still the unstable connector
- the main architectural gap is not template execution, but connector auth and
  route-boundary design

The correct next move is not more random patching. It is a short stability pause
followed by an explicit SHGO connector redesign and validation pass.
