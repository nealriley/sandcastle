import assert from "node:assert/strict";
import test from "node:test";
import { FakeRedis } from "./helpers/fake-redis.js";
import {
  findOwnedSessionBySandboxIdInRedis,
  getOwnedSessionInRedis,
  listOwnedSessionsInRedis,
  ownedSessionStatus,
  touchOwnedSessionInRedis,
} from "../lib/session-ownership.js";

const fakeRedis = new FakeRedis();

test.afterEach(() => {
  fakeRedis.reset();
});

function sessionToken(overrides?: Partial<{
  sessionKey: string;
  ownerUserId: string;
  ownerLogin: string | null;
  sandboxId: string;
  createdAt: number;
  viewToken: string;
}>) {
  return {
    sessionKey: overrides?.sessionKey ?? "session_123",
    sandboxId: overrides?.sandboxId ?? "sb_123",
    agentSessionId: null,
    runtime: "node24" as const,
    ports: [3000, 5173],
    createdAt: overrides?.createdAt ?? 1_000,
    viewToken: overrides?.viewToken ?? "view_123",
    ownerUserId: overrides?.ownerUserId ?? "user_123",
    ownerLogin: overrides?.ownerLogin ?? "jarvis",
  };
}

test("touchOwnedSession stores and refreshes ownership metadata while preserving first createdAt", async () => {
  const first = await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken(),
    updatedAt: 2_000,
    latestPrompt: "Build app",
    status: "active",
    templateSlug: "standard",
    templateName: "Standard",
  });

  const second = await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      createdAt: 9_999,
      viewToken: "view_456",
    }),
    updatedAt: 3_000,
    latestPrompt: "Add auth",
    status: "stopped",
  });

  assert.equal(first.createdAt, 1_000);
  assert.equal(second.createdAt, 1_000);
  assert.equal(second.latestViewToken, "view_456");
  assert.equal(second.latestPrompt, "Add auth");
  assert.equal(second.status, "stopped");
  assert.equal(second.runtime, "node24");
  assert.equal(second.templateSlug, "standard");
  assert.equal(second.templateName, "Standard");
  assert.deepEqual(second.ports, [3000, 5173]);

  const stored = await getOwnedSessionInRedis(fakeRedis, "session_123");
  assert.deepEqual(stored, second);
});

test("listOwnedSessions returns only the signed-in user's sessions in reverse update order", async () => {
  await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      sessionKey: "session_old",
      createdAt: 1_000,
      viewToken: "view_old",
    }),
    updatedAt: 2_000,
    latestPrompt: "Older prompt",
    status: "active",
  });

  await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      sessionKey: "session_new",
      createdAt: 1_500,
      viewToken: "view_new",
    }),
    updatedAt: 5_000,
    latestPrompt: "Newer prompt",
    status: "active",
  });

  await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      sessionKey: "session_other",
      ownerUserId: "user_other",
      ownerLogin: "other",
      viewToken: "view_other",
    }),
    updatedAt: 6_000,
    latestPrompt: "Other user",
    status: "active",
  });

  const sessions = await listOwnedSessionsInRedis(fakeRedis, "user_123");

  assert.deepEqual(
    sessions.map((record) => record.sessionKey),
    ["session_new", "session_old"]
  );
});

test("findOwnedSessionBySandboxId returns only the signed-in user's matching sandbox", async () => {
  await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      sessionKey: "session_match",
      sandboxId: "sb_match",
    }),
    updatedAt: 2_000,
    latestPrompt: "Match me",
    status: "active",
  });

  await touchOwnedSessionInRedis(fakeRedis, {
    session: sessionToken({
      sessionKey: "session_other_user",
      ownerUserId: "user_other",
      ownerLogin: "other",
      sandboxId: "sb_match",
    }),
    updatedAt: 3_000,
    latestPrompt: "Do not match",
    status: "active",
  });

  const match = await findOwnedSessionBySandboxIdInRedis(
    fakeRedis,
    "user_123",
    "sb_match"
  );

  assert.equal(match?.sessionKey, "session_match");
});

test("ownedSessionStatus reports stopped when either the session or task is stopped", () => {
  assert.equal(ownedSessionStatus(false, "running"), "active");
  assert.equal(ownedSessionStatus(true, "running"), "stopped");
  assert.equal(ownedSessionStatus(false, "stopped"), "stopped");
});
