import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FakeRedis } from "./helpers/fake-redis.js";
import {
  McpOAuthError,
  buildMcpAuthorizationErrorRedirect,
  exchangeMcpAuthorizationCodeForRedis,
  getMcpOAuthMetadata,
  issueMcpAuthorizationCodeForRedis,
  registerMcpOAuthClientForRedis,
  revokeMcpAccessTokenForRedis,
  validateMcpAuthorizationRequestForRedis,
  verifyMcpAccessTokenForRedis,
} from "../lib/mcp-auth.js";

const fakeRedis = new FakeRedis();

function s256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

test.afterEach(() => {
  fakeRedis.reset();
});

test("MCP OAuth flow registers a client, issues a code, exchanges a token, and verifies ownership", async () => {
  const client = await registerMcpOAuthClientForRedis(fakeRedis, {
    client_name: "Test MCP Client",
    redirect_uris: ["https://client.example.com/callback"],
  });
  const req = new Request("https://sandcastle.example.com/api/mcp");
  const verifier = "test-code-verifier";

  const authorization = await validateMcpAuthorizationRequestForRedis(
    fakeRedis,
    req,
    {
      client_id: client.client_id,
      redirect_uri: "https://client.example.com/callback",
      response_type: "code",
      code_challenge: s256(verifier),
      code_challenge_method: "S256",
      scope: "mcp",
    }
  );

  const code = await issueMcpAuthorizationCodeForRedis(fakeRedis, authorization, {
    id: "user_123",
    login: "jarvis",
    name: "Jarvis",
    email: "jarvis@example.com",
    image: null,
  });

  const formData = new FormData();
  formData.set("grant_type", "authorization_code");
  formData.set("client_id", client.client_id);
  formData.set("code", code);
  formData.set("redirect_uri", "https://client.example.com/callback");
  formData.set("code_verifier", verifier);

  const tokens = await exchangeMcpAuthorizationCodeForRedis(fakeRedis, req, formData);
  assert.equal(tokens.token_type, "bearer");
  assert.equal(tokens.scope, "mcp");

  const authInfo = await verifyMcpAccessTokenForRedis(
    fakeRedis,
    req,
    tokens.access_token
  );
  assert.equal(authInfo?.clientId, client.client_id);
  assert.equal(authInfo?.extra?.ownerUserId, "user_123");
  assert.equal(authInfo?.extra?.ownerLogin, "jarvis");

  await revokeMcpAccessTokenForRedis(fakeRedis, tokens.access_token);
  await assert.rejects(
    () => verifyMcpAccessTokenForRedis(fakeRedis, req, tokens.access_token),
    (error: unknown) =>
      error instanceof McpOAuthError && error.oauthError === "invalid_token"
  );
});

test("MCP authorization validation rejects unsupported resources and emits redirect metadata", async () => {
  const client = await registerMcpOAuthClientForRedis(fakeRedis, {
    redirect_uris: ["https://client.example.com/callback"],
  });
  const req = new Request("https://sandcastle.example.com/api/mcp");

  await assert.rejects(
    () =>
      validateMcpAuthorizationRequestForRedis(fakeRedis, req, {
        client_id: client.client_id,
        redirect_uri: "https://client.example.com/callback",
        response_type: "code",
        code_challenge: "abc123",
        code_challenge_method: "S256",
        resource: "https://sandcastle.example.com/api/not-mcp",
        state: "opaque-state",
      }),
    (error: unknown) => {
      assert.ok(error instanceof McpOAuthError);
      assert.equal(error.oauthError, "invalid_target");
      assert.equal(
        buildMcpAuthorizationErrorRedirect(error),
        "https://client.example.com/callback?error=invalid_target&error_description=The+requested+resource+is+not+supported.&state=opaque-state"
      );
      return true;
    }
  );
});

test("MCP OAuth metadata advertises the Sandcastle auth endpoints", () => {
  const req = new Request("https://sandcastle.example.com/api/mcp");
  const metadata = getMcpOAuthMetadata(req);

  assert.equal(metadata.issuer, "https://sandcastle.example.com/api/mcp/oauth");
  assert.equal(
    metadata.authorization_endpoint,
    "https://sandcastle.example.com/api/mcp/oauth/authorize"
  );
  assert.equal(metadata.registration_endpoint, "https://sandcastle.example.com/api/mcp/oauth/register");
  assert.deepEqual(metadata.scopes_supported, ["mcp"]);
});
