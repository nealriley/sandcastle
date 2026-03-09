# Sandcastle Route-Handler Reliability

Status: active implementation guidance
Date: March 9, 2026

## Why this exists

We hit a recurring production failure pattern in Next.js App Router handlers:

- the code looked total locally
- `pnpm typecheck`, `pnpm test`, and `pnpm build` passed
- production still returned `500`
- Vercel logged `No response is returned from route handler`

This happened on:

- website sandbox view routes
- website stop/prompt routes
- MCP OAuth metadata routes

The underlying lesson is simple: for critical routes, Sandcastle cannot rely on
"helper returns a Response" abstractions or nested recovery paths that are only
implicitly total. The route handler itself must own the response path.

## Core rules

### 1. Critical route handlers should be `async` and return directly

Preferred pattern:

```ts
export async function GET(req: Request) {
  try {
    const data = computeData(req);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Route failed:", error);
    return NextResponse.json(
      { error: "Request failed." },
      { status: 500 }
    );
  }
}
```

Avoid thin synchronous wrappers around helper functions whose only job is to
return a `Response`.

### 2. Route handlers should own HTTP shaping

Helpers should prefer returning:

- typed success data
- typed failure data
- known domain errors

Helpers should avoid returning `Response` objects unless they are specialized
framework handlers such as `metadataCorsOptionsRequestHandler()`.

### 3. Do params, auth, and body parsing inside one outer `try`

Do not leave risky work outside the guarded path:

- `await params`
- `await req.json()`
- website auth lookup
- Redis ownership reads
- sandbox lookups

If the handler can throw before entering the guarded response path, Vercel can
still surface it as "no response returned."

### 4. Keep `catch` blocks simple

Catch blocks should:

- log
- map to a known status code
- return a final JSON response

Catch blocks should not:

- perform fresh async lookups
- emit diagnostics that can themselves throw
- branch into complex fallback trees

If fallback data is needed, capture it before entering the risky branch.

### 5. Use direct routes for protocol-critical well-known paths

For OAuth and MCP discovery routes, prefer direct App Router files over rewrites.

Use direct routes for:

- `/.well-known/oauth-authorization-server/...`
- `/.well-known/openid-configuration/...`
- `/.well-known/oauth-protected-resource/...`

Protocol-critical clients are less forgiving than browsers, and rewrites add an
extra layer when debugging production failures.

## Failure patterns we have already seen

### Response-wrapper helper instability

Broken pattern:

- route handler delegates immediately to a helper that returns `Response.json(...)`
- handler itself is a very thin synchronous wrapper

Observed result:

- local and build-time behavior looked fine
- production sometimes treated the route as not returning a response

Current guidance:

- inline the final `NextResponse.json(...)` in the route handler for critical
  auth, metadata, and ownership routes

### Nested fallback chains in website session routes

Broken pattern:

- params and auth work happened outside the safest response path
- nested `try/catch`
- catch paths performed extra async work

Observed result:

- intermittent website `500`s on session page, stop, and prompt actions

Current guidance:

- one outer `try`
- no async in `catch`
- all error exits return explicit JSON

### Rewrite-driven OAuth metadata

Broken pattern:

- `.well-known` metadata URLs relied on rewrites to an API route

Observed result:

- harder to diagnose production failures
- later replaced anyway by direct routes

Current guidance:

- expose direct route files for the public well-known URLs

## Route checklist

Use this checklist for any route that is auth-critical, ownership-critical, or
protocol-critical.

- `export const dynamic = "force-dynamic"` when freshness matters
- `export const runtime = "nodejs"` when using Node-only dependencies or auth
- `export async function ...`
- one outer `try/catch`
- param extraction inside the `try`
- body parsing inside the `try`
- direct return of `NextResponse.json(...)` or `Response.json(...)`
- no helper whose main job is "return a Response"
- no async work in `catch`
- final fallback status code always returned

## Post-deploy checks

Critical route changes must be followed by live checks, not just local build
success.

Current minimum checks:

```bash
curl -i https://middleware-psi-five.vercel.app/.well-known/oauth-authorization-server/api/mcp/oauth
curl -i https://middleware-psi-five.vercel.app/.well-known/openid-configuration/api/mcp/oauth
curl -i https://middleware-psi-five.vercel.app/.well-known/oauth-protected-resource/api/mcp
curl -i https://middleware-psi-five.vercel.app/api/mcp/oauth/metadata
```

For website session-route changes, also verify:

- one existing sandbox session page loads
- one stop action succeeds
- one follow-up prompt action succeeds or returns the expected non-500 error

## Current recommendation

When adding new route handlers, bias toward explicitness over reuse:

- duplicate 10 safe lines in the route if needed
- move business logic into helpers
- keep HTTP response creation in the route

For Sandcastle, this is the safer tradeoff than abstracting response generation
too aggressively.
