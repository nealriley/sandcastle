# Sandcastle Template Service Plan

## Objective

Extract the current in-process template system out of the Sandcastle middleware
and into a dedicated Template Service.

The new service must:
- expose a user-accessible API for listing available templates
- let authenticated users create and manage their own templates
- store templates durably with versioning
- resolve templates into an immutable launch contract that Sandcastle can use
  to create new sandboxes
- preserve the current built-in templates during migration

## Current State

Today, templates live inside Sandcastle middleware code:
- the catalog is defined in `middleware/lib/templates.ts`
- bootstrap behavior is implemented as TypeScript functions
- the website `Templates` page reads directly from the local registry
- sandbox creation invokes template bootstrap logic in-process during
  `createOwnedSandboxTask()`

This works for built-in templates, but it does not support:
- user-owned template creation/editing
- durable version history
- API-first template management
- independent deployment or scaling of template logic

## First-Cut Defaults

These defaults are now assumed unless we explicitly change them:

- The first implementation stays inside the current Sandcastle middleware
  deployment.
- We still create a service-shaped boundary now:
  - dedicated template routes
  - dedicated template storage layer
  - dedicated template resolution layer
- The first storage layer is the one we already have:
  - Upstash Redis
- Built-in templates may remain hard-coded initially, but only behind the new
  template API surface so Sandcastle stops reading from the in-process registry
  directly.
- User-owned templates must be stored in Redis from the first implementation.
- We defer a physically separate service deployment until the API contract and
  data model have stabilized.

## Core Design Decisions

- Templates become versioned data, not in-process application code.
- Sandcastle remains the sandbox control plane. It should not remain the source
  of truth for template definitions.
- The new Template Service becomes the source of truth for:
  - template metadata
  - template versions
  - template assets/bundles
  - prompt wrappers
  - environment schemas
  - publish state
  - template resolution
- Built-in and user-owned templates share the same underlying model.
- Built-in templates are seeded as system-owned templates and are not editable
  through normal user APIs.
- User-editable templates must be represented declaratively. We should not allow
  arbitrary server-side JavaScript execution inside the Template Service.

## Proposed Architecture

### Service split

For the first cut, the "Template Service" is a logical service inside the
existing Sandcastle app. Later it can be extracted into its own deployment
without changing the contract.

- `Sandcastle` keeps:
  - website auth and owned sandbox UX
  - sandbox/session/task lifecycle
  - previews, console, prompts, and runtime observability
  - SHGO connector flow
  - launch-time environment value submission
- `Template Service` owns:
  - template catalog APIs
  - user-owned template CRUD
  - template versioning
  - asset storage and retrieval
  - template validation and publish rules
  - template resolution into a concrete launch contract

### Auth model

- User-facing Template Service APIs use authenticated user identity.
- Sandcastle talks to the Template Service using service-to-service auth.
- Ownership rules:
  - any signed-in user can read system templates
  - users can read and modify their own templates
  - future public/shared templates can be added later, but should not block v1

### Storage model

- Use Upstash Redis as the first storage layer for:
  - template metadata
  - template versions
  - template specs
  - small text-based template assets
- Keep the first stored template format compact and declarative so Redis remains
  viable.
- Impose explicit limits for the Redis-backed first cut:
  - small script/text assets only
  - no large binary bundles
  - bounded version history per template
- If template assets or history outgrow Redis comfortably, extract assets into
  object storage later without changing the public contract.

### Deployment shape

- First cut:
  - internal service module + internal API routes inside the existing
    Sandcastle middleware app
- Later:
  - move the same contract into its own deployable service if scale,
    ownership, or operational isolation requires it

## Template Model

### Template

- `id`
- `slug`
- `owner_type` (`system` | `user`)
- `owner_user_id`
- `name`
- `summary`
- `description`
- `visibility` (`system` | `private` | `public` later)
- `status` (`active` | `archived`)
- `created_at`
- `updated_at`

### TemplateVersion

- `id`
- `template_id`
- `version_number`
- `state` (`draft` | `published` | `deprecated`)
- `created_by`
- `changelog`
- `created_at`

### TemplateSpec

The spec returned by the Template Service should be declarative and serializable.

- `source`
  - `runtime`
  - `snapshot`
  - later: `git` / `tarball`
- `runtime_constraints`
  - default runtime
  - supported runtimes
- `launch_config`
  - ports
  - timeout
  - vcpus
- `environment_schema`
  - key
  - label
  - description
  - required
  - secret
  - optional default behavior
- `prompt_config`
  - prompt placeholder
  - default prompt
  - initial prompt wrapper template
  - optional follow-up hints
- `bootstrap_manifest`
  - files to write
  - chmod operations
  - commands to run
  - detached/background processes
  - preview metadata
- `asset_bundle_ref`
  - immutable asset digest / storage location
  - for the first cut, this can be a Redis-backed asset reference rather than
    external blob storage

### TemplateInvocationResolution

This is the contract Sandcastle receives at create time.

- resolved template version id
- resolved source/runtime
- resolved launch config
- resolved env schema
- resolved prompt wrapper
- resolved bootstrap manifest
- resolved asset bundle metadata

This must be immutable for a given version so every sandbox can record exactly
which template version it used.

## API Surface

## User-facing API

- `GET /v1/templates`
- `GET /v1/templates/:templateId`
- `GET /v1/me/templates`
- `POST /v1/templates`
- `PATCH /v1/templates/:templateId`
- `POST /v1/templates/:templateId/clone`
- `POST /v1/templates/:templateId/versions`
- `PATCH /v1/template-versions/:versionId`
- `POST /v1/template-versions/:versionId/publish`
- `POST /v1/template-versions/:versionId/assets`
- `GET /v1/template-versions/:versionId/assets`

## Internal API used by Sandcastle

- `GET /internal/templates/catalog`
- `GET /internal/templates/:templateId`
- `POST /internal/templates/:templateId/resolve`
- `POST /internal/templates/:templateId/resolve-by-slug`

The internal resolve endpoint should return the immutable launch contract that
Sandcastle uses during sandbox creation.

## User Experience Plan

- Sandcastle can remain the primary user UI for browsing and launching
  templates, but it should become a client of the Template Service.
- Users should also be able to manage templates directly over API.
- We do not need a large standalone template-service UI on day one.
- API-first is enough for the first release, as long as Sandcastle consumes the
  same APIs.

## Safety Constraints

- Do not allow arbitrary executable server-side logic in the Template Service.
- Validate template manifests before publish.
- Enforce limits on:
  - file count
  - asset size
  - script size
  - command count
  - detached process count
  - environment schema size
- Record every resolved template version on sandbox creation.
- Preserve launch-time env values in Sandcastle; the Template Service should
  define env schema, not receive raw user secrets unless explicitly required.

## Migration Constraints

- Current templates are implemented as TypeScript functions and must be migrated
  into declarative specs plus assets.
- Existing built-ins must continue to work during migration:
  - `standard`
  - `claude-code`
  - `codex`
  - `shell-scripts-validation`
  - `webpage-inspector`
- Sandcastle should have a fallback strategy if the Template Service layer is
  unavailable during rollout.
- For the first cut, it is acceptable to keep built-ins hard-coded behind the
  new API while user templates are stored in Redis. The key requirement is that
  Sandcastle consumes the API contract, not the old in-process registry.

## Phase 0: Contract And Platform Decisions

- [ ] Finalize the `Template`, `TemplateVersion`, `TemplateSpec`, and
      `TemplateInvocationResolution` schemas.
- [x] Default the first deployment shape to an internal service layer inside
      the current Sandcastle app.
- [x] Default the first storage layer to Upstash Redis.
- [x] Define service-to-service auth between Sandcastle and the Template
      Service.
- [ ] Decide whether user auth is shared from Sandcastle or independent but
      identity-compatible.
- [x] Define the initial supported bootstrap manifest operations.
- [x] Explicitly list unsupported template features for v1.

## Phase 1: Service Foundation

- [x] Create the internal Template Service module and route surface inside the
      current Sandcastle app.
- [x] Add startup/readiness checks for Redis, template auth, and template route
      availability.
- [ ] Add request logging, structured errors, and rate limiting.
- [x] Implement user authentication for API access.
- [x] Implement internal service authentication boundaries for Sandcastle calls.
- [ ] Add OpenAPI or equivalent machine-readable API documentation.

## Phase 2: Data Model And CRUD APIs

- [x] Create the Redis key model for templates and template versions.
- [x] Implement template CRUD APIs.
- [x] Implement template version CRUD APIs.
- [ ] Implement Redis-backed asset upload and asset listing APIs for small text
      assets.
- [ ] Implement ownership and visibility enforcement.
- [ ] Add tests around authorization and invalid state transitions.

## Phase 3: Template Compiler / Validator

- [x] Build schema validation for template specs.
- [x] Build manifest normalization/compilation.
- [ ] Enforce publish-time validation for files, commands, runtimes, ports,
      and env schema.
- [ ] Add immutable asset digests / bundle references.
- [ ] Add resolve-time tests proving a published version yields a deterministic
      launch contract.

## Phase 4: Built-in Template Migration

- [x] Expose `standard` through the new template API contract.
- [x] Expose `claude-code` through the new template API contract.
- [x] Expose `codex` through the new template API contract.
- [x] Expose `shell-scripts-validation` through the new template API contract.
- [x] Expose `webpage-inspector` through the new template API contract.
- [x] Move built-in template definitions behind the internal template-service
      layer, even if they still originate from code in the first cut.
- [ ] Seed lower environments and production with these built-ins.
- [ ] Record version ids for every seeded built-in template.

## Phase 5: Sandcastle Integration

- [ ] Replace `middleware/lib/templates.ts` as the source of truth.
- [x] Change `/api/templates` to query the Template Service.
- [x] Change website template browsing to use the Template Service.
- [x] Change sandbox creation to resolve a template through the Template
      Service before invoking sandbox bootstrapping.
- [x] Preserve current env-var behavior and prompt-wrapper behavior through the
      new resolve contract.
- [x] Update SHGO/Pack template discovery and create flows to read from the
      Template Service.
- [ ] Add caching and graceful failure behavior around template reads.

## Phase 6: User-Owned Templates

- [ ] Support create-from-scratch template creation.
- [ ] Support cloning from a system template into a user-owned draft.
- [ ] Support editing user-owned template metadata.
- [ ] Support editing env schema.
- [ ] Support editing prompt configuration.
- [ ] Support editing bootstrap manifest and assets.
- [ ] Support publishing a draft version.
- [ ] Support rolling back to a prior published version.
- [ ] Expose owned templates through API and Sandcastle UI.

## Phase 7: Invocation, Audit, And Safety

- [ ] Record the exact template version on every sandbox created by Sandcastle.
- [ ] Add an audit trail showing which resolved template contract was applied.
- [ ] Add quotas for template count, asset storage, and publish frequency.
- [ ] Add negative tests for unauthorized edits, broken manifests, and invalid
      asset bundles.
- [ ] Run a security review for user-authored bootstrap content.
- [ ] Define a rollback plan if the Template Service fails after cutover.

## Phase 8: End-To-End Release Gates

- [ ] End-to-end test: list system templates from the internal template-service
      API.
- [ ] End-to-end test: create a user-owned template over API.
- [ ] End-to-end test: publish a template version and launch a sandbox from it.
- [ ] End-to-end test: clone a built-in template and modify it safely.
- [ ] End-to-end test: SHGO creates a sandbox using a service-backed template.
- [ ] End-to-end test: historical sandboxes retain their template version
      reference.
- [ ] End-to-end test: template-service route failure produces a controlled
      Sandcastle failure mode.

## Explicit Non-Goals For The First Cut

- [ ] Multi-user collaborative editing on a single template
- [ ] Public marketplace/discovery for community templates
- [ ] Arbitrary server-side code hooks inside the Template Service
- [ ] Full standalone template-editor UI before the API and integration are
      stable

## Immediate Next Step

- [ ] Add graceful failure behavior and bounded caching around template reads,
      then start recording the exact template version id on each sandbox
      creation so invocation audit data is durable.
