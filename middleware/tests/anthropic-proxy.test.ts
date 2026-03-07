import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicProxyForwardHeaders,
  buildAnthropicProxyResponseHeaders,
  extractAnthropicProxyPath,
  getAnthropicProxyCredential,
} from "../lib/anthropic-proxy.js";

test("getAnthropicProxyCredential prefers x-api-key", () => {
  const headers = new Headers({
    authorization: "Bearer bearer-token",
    "x-api-key": "proxy-token",
  });

  assert.equal(getAnthropicProxyCredential(headers), "proxy-token");
});

test("getAnthropicProxyCredential falls back to bearer auth", () => {
  const headers = new Headers({
    authorization: "Bearer bearer-token",
  });

  assert.equal(getAnthropicProxyCredential(headers), "bearer-token");
});

test("buildAnthropicProxyForwardHeaders strips proxy auth headers", () => {
  const headers = new Headers({
    authorization: "Bearer proxy-token",
    "anthropic-beta": "tool-use-2024-10-22",
    "anthropic-version": "2023-06-01",
    "content-length": "123",
    "content-type": "application/json",
    host: "middleware.example.com",
    "x-api-key": "proxy-token",
  });

  const forwarded = buildAnthropicProxyForwardHeaders(headers, "upstream-key");

  assert.equal(forwarded.get("authorization"), null);
  assert.equal(forwarded.get("content-length"), null);
  assert.equal(forwarded.get("host"), null);
  assert.equal(forwarded.get("x-api-key"), "upstream-key");
  assert.equal(forwarded.get("anthropic-version"), "2023-06-01");
  assert.equal(forwarded.get("anthropic-beta"), "tool-use-2024-10-22");
  assert.equal(forwarded.get("content-type"), "application/json");
});

test("buildAnthropicProxyResponseHeaders strips transport headers", () => {
  const headers = new Headers({
    connection: "keep-alive",
    "content-encoding": "gzip",
    "content-length": "456",
    "content-type": "text/event-stream",
    "transfer-encoding": "chunked",
    "x-request-id": "req_123",
  });

  const forwarded = buildAnthropicProxyResponseHeaders(headers);

  assert.equal(forwarded.get("connection"), null);
  assert.equal(forwarded.get("content-encoding"), null);
  assert.equal(forwarded.get("content-length"), null);
  assert.equal(forwarded.get("transfer-encoding"), null);
  assert.equal(forwarded.get("content-type"), "text/event-stream");
  assert.equal(forwarded.get("x-request-id"), "req_123");
});

test("extractAnthropicProxyPath validates catch-all params", () => {
  assert.deepEqual(extractAnthropicProxyPath({ path: ["v1", "messages"] }), [
    "v1",
    "messages",
  ]);
  assert.equal(extractAnthropicProxyPath({ path: "v1/messages" }), null);
  assert.equal(extractAnthropicProxyPath({}), null);
  assert.equal(extractAnthropicProxyPath(null), null);
});
