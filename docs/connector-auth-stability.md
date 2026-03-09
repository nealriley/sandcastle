# Sandcastle Connector Auth Stability

Status: current-state audit and migration notes
Date: March 9, 2026

## Summary

Sandcastle currently has one real identity system and two connector-specific
grant systems:

- website identity: GitHub via Auth.js
- SHGO / Pack access: three-word pairing code
- MCP access: OAuth authorization-code flow with bearer access tokens

The stable invariant is that owned sandboxes should always resolve back to the
same website `user.id`, regardless of which connector created them.

That invariant is correct in the codebase, but the connector auth surface is
still too fragmented. The result is that bugs can show up as cross-connector
visibility problems even when the underlying identity model is nominally shared.

## Current model

### Website

- primary identity system
- GitHub sign-in
- source of truth for `user.id`
- dashboard and browser actions operate directly as that user

### SHGO / Pack

- uses Pack system auth for the machine-to-machine `X-Agent-Key`
- uses a short-lived three-word pairing code for user scoping
- pairing code currently acts as an ephemeral handoff from website identity to
  Pack actions

Today the Pack uses the pairing code for:

- create
- list owned sandboxes
- list owned templates
- resume / continue a sandbox by id

### MCP

- uses OAuth authorization code flow
- access token is bound to the website user who approved it
- tool calls operate directly as that website user

## Stability findings

### 1. We do not have one connector-grant abstraction

The product currently has:

- website identity
- pairing-code grant
- MCP OAuth grant

But there is no single internal "connector principal" abstraction that all
surfaces share. Each surface reaches owned-sandbox data through its own auth
translation step.

That means the ownership model is conceptually unified, but the access model is
still split.

### 2. SHGO lookup has been too dependent on recent-session lists

Until now, direct sandbox lookup for SHGO used the recent owned-session list as
its backing data source. That creates two stability risks:

- older sandboxes can fall out of the lookup window
- any connector that creates many sessions can make another connector appear to
  "lose" older sandboxes

Immediate mitigation:

- maintain a direct owner+sandbox lookup index in Redis
- use that index for resume / continue lookups

### 3. Listing and direct access have different requirements

Listing owned sandboxes needs:

- a recent ordered view
- filtering
- UI-friendly summaries

Direct access by sandbox id needs:

- exact lookup
- no dependence on recency windows

These should not share the same lookup primitive.

### 4. The three-word code is overloaded

The pairing code started as a simple website-to-Pack handoff. It now also
functions as a user grant for listing and resuming resources.

That is workable short-term, but it has drawbacks:

- it is ephemeral
- it is manual
- it is easy to confuse with account identity
- it is less observable than a first-class OAuth grant

## Near-term stabilization

These are the current low-risk steps that improve stability without changing the
Pack auth model yet.

### Done or in progress

- document the route-handler reliability rules
- document the connector auth split explicitly
- add a direct owner+sandbox lookup index instead of relying only on recent
  session scans

### Next practical checks

- add smoke coverage for: create via MCP, then access via SHGO
- add smoke coverage for: create via SHGO, then access via MCP where applicable
- add tests for ownership records created by one surface being readable by the
  other
- make listing limits explicit and configurable

## Long-term direction

The long-term stable direction is to make Pack auth look more like MCP auth:

- website identity remains the root user identity
- Pack gets a first-class user grant rather than a short-lived pairing code

There are two realistic paths.

### Path A: keep pairing for bootstrap, add a durable connector grant

Flow:

- user signs in on the website
- user completes a one-time handoff to SHGO
- Sandcastle issues a longer-lived connector grant behind the scenes
- Pack actions use that grant instead of repeated three-word codes

Pros:

- less Pack migration work
- preserves current UX as a bootstrap

Cons:

- we would still own a custom auth protocol
- still more bespoke than standard OAuth

### Path B: move the Pack to OAuth2 user authentication

This is the cleaner long-term path if the product investment justifies it.

Why it is plausible:

- the Coda Pack SDK supports OAuth2 Authorization Code authentication
- Coda stores user credentials and applies them to outbound requests
- this aligns better with how MCP already works

What would need to change:

- Pack auth would move from `authCode` parameters to user auth
- Sandcastle would need a Pack-specific OAuth client strategy
- our current MCP dynamic-registration flow is not a direct fit for Coda Packs

Important constraint:

- Coda Pack OAuth expects configured authorization and token URLs and Pack-managed
  client credentials
- our current MCP flow is designed for remote MCP clients with dynamic public
  registration and PKCE

So the likely migration is not "reuse MCP OAuth as-is." It is:

- reuse the same Sandcastle website identity and ownership model
- add a Pack-oriented OAuth surface on top

## Recommendation

Short term:

- stabilize the current pairing-code path with better indexing, smoke coverage,
  and clearer ownership invariants

Medium term:

- decide whether SHGO is strategic enough to justify a full OAuth migration

Long term:

- if SHGO remains core, migrate from three-word pairing to Pack OAuth2 user auth

## External references

These docs are relevant to a future Pack auth migration:

- Coda Pack OAuth2 guide:
  https://coda.io/packs/build/latest/guides/basics/authentication/oauth2/
- Coda `OAuth2Authentication` reference:
  https://coda.io/packs/build/latest/reference/sdk/core/interfaces/OAuth2Authentication/
- Coda Pack security overview:
  https://help.coda.io/en/articles/4587167-security-of-packs-on-coda
