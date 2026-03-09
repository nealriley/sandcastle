import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpOAuthMetadataOptionsResponse,
  buildMcpOAuthMetadataResponse,
} from "../lib/mcp-oauth-metadata.js";

test("MCP OAuth metadata response is stable on the well-known authorization-server path", async () => {
  const response = buildMcpOAuthMetadataResponse(
    new Request(
      "https://sandcastle.example.com/.well-known/oauth-authorization-server/api/mcp/oauth"
    )
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "max-age=3600");

  const body = (await response.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
  };
  assert.equal(body.issuer, "https://sandcastle.example.com/api/mcp/oauth");
  assert.equal(
    body.authorization_endpoint,
    "https://sandcastle.example.com/api/mcp/oauth/authorize"
  );
  assert.equal(
    body.token_endpoint,
    "https://sandcastle.example.com/api/mcp/oauth/token"
  );
});

test("MCP OAuth metadata response returns a JSON 500 when metadata generation fails", async () => {
  const response = buildMcpOAuthMetadataResponse(
    new Request("https://sandcastle.example.com/api/mcp/oauth/metadata"),
    () => {
      throw new Error("metadata broke");
    }
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Failed to build MCP OAuth metadata.",
  });
});

test("MCP OAuth metadata options response advertises CORS support", () => {
  const response = buildMcpOAuthMetadataOptionsResponse();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
});
