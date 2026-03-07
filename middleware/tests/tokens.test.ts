import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFollowUpTokenConfiguration,
  assertSessionStartTokenConfiguration,
  decodeAnthropicProxyToken,
  decodeSessionToken,
  decodeTaskToken,
  decodeViewToken,
  encodeAnthropicProxyToken,
  encodeSessionToken,
  encodeTaskToken,
  encodeViewToken,
} from "../lib/tokens.js";

const ORIGINAL_AGENT_API_KEY = process.env.AGENT_API_KEY;
const ORIGINAL_CONTROL_TOKEN_SECRET = process.env.CONTROL_TOKEN_SECRET;
const ORIGINAL_VIEW_TOKEN_SECRET = process.env.VIEW_TOKEN_SECRET;
const ORIGINAL_PROXY_TOKEN_SECRET = process.env.ANTHROPIC_PROXY_TOKEN_SECRET;
const ORIGINAL_DATE_NOW = Date.now;

function resetEnvironment() {
  process.env.AGENT_API_KEY = ORIGINAL_AGENT_API_KEY;
  process.env.CONTROL_TOKEN_SECRET = ORIGINAL_CONTROL_TOKEN_SECRET;
  process.env.VIEW_TOKEN_SECRET = ORIGINAL_VIEW_TOKEN_SECRET;
  process.env.ANTHROPIC_PROXY_TOKEN_SECRET = ORIGINAL_PROXY_TOKEN_SECRET;
  Date.now = ORIGINAL_DATE_NOW;
}

test.afterEach(() => {
  resetEnvironment();
});

test("session, task, and view tokens round-trip with the dedicated control token secret", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  delete process.env.VIEW_TOKEN_SECRET;

  const sessionToken = encodeSessionToken({
    sessionKey: "session_123",
    sandboxId: "sb_123",
    agentSessionId: "agent_123",
    runtime: "node24",
    ports: [3000],
    createdAt: 1234,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: "jarvis",
  });
  const taskToken = encodeTaskToken({
    session: {
      sessionKey: "session_123",
      sandboxId: "sb_123",
      agentSessionId: "agent_123",
      runtime: "node24",
      ports: [3000],
      createdAt: 1234,
      viewToken: "view_123",
      ownerUserId: "user_123",
      ownerLogin: "jarvis",
    },
    cmdId: "cmd_123",
    taskFileId: "task_123",
    createdAt: 1234,
  });
  const viewToken = encodeViewToken({
    sessionKey: "session_123",
    sandboxId: "sb_123",
    ownerUserId: "user_123",
    createdAt: 1234,
  });

  assert.deepEqual(decodeSessionToken(sessionToken), {
    sessionKey: "session_123",
    sandboxId: "sb_123",
    agentSessionId: "agent_123",
    runtime: "node24",
    ports: [3000],
    createdAt: 1234,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: "jarvis",
  });
  assert.deepEqual(decodeTaskToken(taskToken), {
    session: {
      sessionKey: "session_123",
      sandboxId: "sb_123",
      agentSessionId: "agent_123",
      runtime: "node24",
      ports: [3000],
      createdAt: 1234,
      viewToken: "view_123",
      ownerUserId: "user_123",
      ownerLogin: "jarvis",
    },
    cmdId: "cmd_123",
    taskFileId: "task_123",
    createdAt: 1234,
  });
  assert.deepEqual(decodeViewToken(viewToken), {
    sessionKey: "session_123",
    sandboxId: "sb_123",
    ownerUserId: "user_123",
    createdAt: 1234,
  });
});

test("Anthropic proxy tokens use the dedicated secret when present", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  process.env.ANTHROPIC_PROXY_TOKEN_SECRET = "proxy-secret";

  const token = encodeAnthropicProxyToken({
    sandboxId: "sb_proxy",
    taskFileId: "task_proxy",
  });

  assert.deepEqual(decodeAnthropicProxyToken(token), {
    sandboxId: "sb_proxy",
    taskFileId: "task_proxy",
  });

  process.env.ANTHROPIC_PROXY_TOKEN_SECRET = "different-secret";
  assert.throws(() => decodeAnthropicProxyToken(token), /Invalid token signature/);
});

test("Anthropic proxy tokens expire based on their short TTL", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  process.env.ANTHROPIC_PROXY_TOKEN_SECRET = "proxy-secret";

  Date.now = () => 1_000;
  const token = encodeAnthropicProxyToken({
    sandboxId: "sb_proxy",
    taskFileId: "task_proxy",
  });

  Date.now = () => 1_000 + 16 * 60 * 1_000;
  assert.throws(() => decodeAnthropicProxyToken(token), /Token expired/);
});

test("view tokens prefer VIEW_TOKEN_SECRET over the shared control token secret", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  process.env.VIEW_TOKEN_SECRET = "view-secret";

  const token = encodeViewToken({
    sessionKey: "session_123",
    sandboxId: "sb_123",
    ownerUserId: "user_123",
    createdAt: 1234,
  });

  process.env.CONTROL_TOKEN_SECRET = "different-control-secret";
  assert.deepEqual(decodeViewToken(token), {
    sessionKey: "session_123",
    sandboxId: "sb_123",
    ownerUserId: "user_123",
    createdAt: 1234,
  });

  process.env.VIEW_TOKEN_SECRET = "different-view-secret";
  assert.throws(() => decodeViewToken(token), /Invalid token signature/);
});

test("session tokens no longer fall back to AGENT_API_KEY", () => {
  process.env.AGENT_API_KEY = "agent-secret";
  delete process.env.CONTROL_TOKEN_SECRET;
  delete process.env.VIEW_TOKEN_SECRET;

  assert.throws(
    () =>
      encodeSessionToken({
        sessionKey: "session_123",
        sandboxId: "sb_123",
        agentSessionId: null,
        runtime: "node24",
        ports: [3000],
        createdAt: 1234,
        viewToken: "view_123",
        ownerUserId: "user_123",
        ownerLogin: null,
      }),
    /Missing session token signing secret/
  );
});

test("Anthropic proxy tokens fall back to the shared control token secret", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  delete process.env.ANTHROPIC_PROXY_TOKEN_SECRET;

  const token = encodeAnthropicProxyToken({
    sandboxId: "sb_proxy",
    taskFileId: "task_proxy",
  });

  assert.deepEqual(decodeAnthropicProxyToken(token), {
    sandboxId: "sb_proxy",
    taskFileId: "task_proxy",
  });
});

test("token configuration helpers validate required secrets", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";
  delete process.env.ANTHROPIC_PROXY_TOKEN_SECRET;
  delete process.env.VIEW_TOKEN_SECRET;

  assert.doesNotThrow(() => assertSessionStartTokenConfiguration());
  assert.doesNotThrow(() => assertFollowUpTokenConfiguration());
});

test("session and task tokens expire based on their shorter control-plane TTL", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";

  Date.now = () => 10_000;
  const sessionToken = encodeSessionToken({
    sessionKey: "session_123",
    sandboxId: "sb_123",
    agentSessionId: null,
    runtime: "node24",
    ports: [3000],
    createdAt: 1234,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: null,
  });
  const taskToken = encodeTaskToken({
    session: {
      sessionKey: "session_123",
      sandboxId: "sb_123",
      agentSessionId: null,
      runtime: "node24",
      ports: [3000],
      createdAt: 1234,
      viewToken: "view_123",
      ownerUserId: "user_123",
      ownerLogin: null,
    },
    cmdId: "cmd_123",
    taskFileId: "task_123",
    createdAt: 1234,
  });

  Date.now = () => 10_000 + 2 * 60 * 60 * 1000 + 1;
  assert.throws(() => decodeSessionToken(sessionToken), /Token expired/);
  assert.throws(() => decodeTaskToken(taskToken), /Token expired/);
});

test("tampered session tokens are rejected", () => {
  process.env.CONTROL_TOKEN_SECRET = "control-secret";

  const token = encodeSessionToken({
    sessionKey: "session_123",
    sandboxId: "sb_123",
    agentSessionId: null,
    runtime: "node24",
    ports: [3000],
    createdAt: 1234,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: null,
  });
  const tampered =
    token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");

  assert.throws(() => decodeSessionToken(tampered), /Invalid token signature/);
});
