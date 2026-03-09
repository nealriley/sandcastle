import assert from "node:assert/strict";
import test from "node:test";
import {
  requireWebsiteOwnedSandboxWithDependencies,
  type WebsiteOwnedSandboxLookup,
} from "../lib/website-owned-sandbox.js";

function createRecord(overrides?: Partial<{
  sessionKey: string;
  ownerUserId: string;
  ownerLogin: string | null;
  sandboxId: string;
}>) {
  return {
    sessionKey: overrides?.sessionKey ?? "session_123",
    ownerUserId: overrides?.ownerUserId ?? "user_123",
    ownerLogin: overrides?.ownerLogin ?? "jarvis",
    sandboxId: overrides?.sandboxId ?? "sbx_123",
    latestViewToken: "view_123",
    createdAt: 1_000,
    updatedAt: 2_000,
    latestPrompt: "Build app",
    status: "active" as const,
    runtime: "node24" as const,
    templateSlug: "claude-code",
    templateName: "Claude Code",
    executionStrategyKind: "claude-agent" as const,
    ports: [3000],
    envKeys: [],
  };
}

function createSession() {
  return {
    sessionKey: "session_123",
    sandboxId: "sbx_123",
    agentSessionId: null,
    runtime: "node24" as const,
    ports: [3000],
    createdAt: 1_000,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: "jarvis",
  };
}

async function readErrorBody(result: WebsiteOwnedSandboxLookup) {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("Expected a failed lookup result.");
  }

  return result.response.json();
}

test("website-owned sandbox lookup returns 500 when ownership lookup throws", async () => {
  const result = await requireWebsiteOwnedSandboxWithDependencies(
    "session_123",
    {
      getWebsiteUser: async () => ({
        id: "user_123",
        login: "jarvis",
        name: null,
        email: null,
        image: null,
      }),
      getOwnedSession: async () => {
        throw new Error("redis down");
      },
      restoreOwnedSandboxSession: async () => createSession(),
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 500);
  }
  assert.deepEqual(await readErrorBody(result), {
    error: "Failed to load sandbox ownership.",
  });
});

test("website-owned sandbox lookup returns 500 when session restoration throws", async () => {
  const result = await requireWebsiteOwnedSandboxWithDependencies(
    "session_123",
    {
      getWebsiteUser: async () => ({
        id: "user_123",
        login: "jarvis",
        name: null,
        email: null,
        image: null,
      }),
      getOwnedSession: async () => createRecord(),
      restoreOwnedSandboxSession: async () => {
        throw new Error("sandbox get failed");
      },
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 500);
  }
  assert.deepEqual(await readErrorBody(result), {
    error: "Failed to restore sandbox session.",
  });
});

test("website-owned sandbox lookup preserves 404 for a different signed-in user", async () => {
  const result = await requireWebsiteOwnedSandboxWithDependencies(
    "session_123",
    {
      getWebsiteUser: async () => ({
        id: "user_999",
        login: "other",
        name: null,
        email: null,
        image: null,
      }),
      getOwnedSession: async () => createRecord(),
      restoreOwnedSandboxSession: async () => createSession(),
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 404);
  }
  assert.deepEqual(await readErrorBody(result), {
    error: "Sandbox not found.",
  });
});

test("website-owned sandbox lookup returns the restored session when ownership succeeds", async () => {
  const result = await requireWebsiteOwnedSandboxWithDependencies(
    "session_123",
    {
      getWebsiteUser: async () => ({
        id: "user_123",
        login: "jarvis",
        name: null,
        email: null,
        image: null,
      }),
      getOwnedSession: async () => createRecord(),
      restoreOwnedSandboxSession: async () => createSession(),
    }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.context.record.sessionKey, "session_123");
    assert.equal(result.context.session?.sandboxId, "sbx_123");
  }
});
