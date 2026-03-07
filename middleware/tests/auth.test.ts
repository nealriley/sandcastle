import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWebsiteAuthConfigured,
  getWebsiteAuthConfigurationError,
  isWebsiteAuthConfigured,
  WebsiteAuthConfigurationError,
} from "../auth.js";
import { invalidTokenResponse, validateAuth } from "../lib/auth.js";
import { TokenConfigurationError } from "../lib/tokens.js";

const ORIGINAL_AGENT_API_KEY = process.env.AGENT_API_KEY;
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
const ORIGINAL_NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
const ORIGINAL_AUTH_GITHUB_ID = process.env.AUTH_GITHUB_ID;
const ORIGINAL_GITHUB_ID = process.env.GITHUB_ID;
const ORIGINAL_AUTH_GITHUB_SECRET = process.env.AUTH_GITHUB_SECRET;
const ORIGINAL_GITHUB_SECRET = process.env.GITHUB_SECRET;

test.afterEach(() => {
  process.env.AGENT_API_KEY = ORIGINAL_AGENT_API_KEY;
  process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  process.env.NEXTAUTH_SECRET = ORIGINAL_NEXTAUTH_SECRET;
  process.env.AUTH_GITHUB_ID = ORIGINAL_AUTH_GITHUB_ID;
  process.env.GITHUB_ID = ORIGINAL_GITHUB_ID;
  process.env.AUTH_GITHUB_SECRET = ORIGINAL_AUTH_GITHUB_SECRET;
  process.env.GITHUB_SECRET = ORIGINAL_GITHUB_SECRET;
});

function requestWithHeaders(headers?: HeadersInit) {
  return new Request("https://middleware.example.com/api/test", {
    headers,
  }) as unknown;
}

test("validateAuth returns 500 when AGENT_API_KEY is missing", async () => {
  delete process.env.AGENT_API_KEY;

  const response = validateAuth(requestWithHeaders() as never);
  assert.ok(response);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Server misconfigured",
  });
});

test("validateAuth rejects missing or incorrect agent keys", async () => {
  process.env.AGENT_API_KEY = "expected-key";

  const missing = validateAuth(requestWithHeaders() as never);
  assert.ok(missing);
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), {
    error: "Unauthorized",
  });

  const wrong = validateAuth(
    requestWithHeaders({ "X-Agent-Key": "wrong-key" }) as never
  );
  assert.ok(wrong);
  assert.equal(wrong.status, 401);
});

test("validateAuth accepts the configured agent key", () => {
  process.env.AGENT_API_KEY = "expected-key";

  const response = validateAuth(
    requestWithHeaders({ "X-Agent-Key": "expected-key" }) as never
  );

  assert.equal(response, null);
});

test("website auth configuration reports missing settings and rejects partial config", () => {
  delete process.env.AUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  process.env.AUTH_GITHUB_ID = "github-id";
  process.env.AUTH_GITHUB_SECRET = "github-secret";

  assert.equal(isWebsiteAuthConfigured(), false);
  assert.match(
    getWebsiteAuthConfigurationError() ?? "",
    /partially configured/i
  );
  assert.match(
    getWebsiteAuthConfigurationError() ?? "",
    /AUTH_SECRET/
  );
  assert.throws(
    () => assertWebsiteAuthConfigured(),
    WebsiteAuthConfigurationError
  );
});

test("website auth configuration succeeds only with a real auth secret and GitHub credentials", () => {
  process.env.AUTH_SECRET = "auth-secret";
  process.env.AUTH_GITHUB_ID = "github-id";
  process.env.AUTH_GITHUB_SECRET = "github-secret";

  assert.equal(getWebsiteAuthConfigurationError(), null);
  assert.equal(isWebsiteAuthConfigured(), true);
  assert.deepEqual(assertWebsiteAuthConfigured(), {
    secret: "auth-secret",
    github: {
      clientId: "github-id",
      clientSecret: "github-secret",
    },
  });
});

test("invalidTokenResponse distinguishes token misconfiguration from invalid user tokens", async () => {
  const invalid = invalidTokenResponse(new Error("bad token"), "Invalid token");
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "Invalid token",
  });

  const misconfigured = invalidTokenResponse(
    new TokenConfigurationError("Missing control secret"),
    "Invalid token"
  );
  assert.equal(misconfigured.status, 500);
  assert.deepEqual(await misconfigured.json(), {
    error: "Missing control secret",
  });
});
