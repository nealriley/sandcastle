import assert from "node:assert/strict";
import test from "node:test";
import { buildUnexpectedRunnerExitMessage } from "../lib/agent-runner.js";
import {
  appendSessionTask,
  buildBusySessionResponse,
  buildSessionView,
  buildStoppedSessionResponse,
  buildTaskResponse,
  initializeSessionState,
  makeTaskRecord,
  reconcileSessionState,
} from "../lib/session-state.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

process.env.CONTROL_TOKEN_SECRET ??= "test-control-token-secret";

function sessionToken() {
  return {
    sessionKey: "session_123",
    sandboxId: "sb_123",
    agentSessionId: null,
    runtime: "node24" as const,
    ports: [3000],
    createdAt: 1_000,
    viewToken: "view_123",
    ownerUserId: "user_123",
    ownerLogin: "jarvis",
  };
}

function logPath(taskFileId: string) {
  return `/vercel/sandbox/.log-${taskFileId}.jsonl`;
}

function logLine(entry: Record<string, unknown>) {
  return `${JSON.stringify(entry)}\n`;
}

test("buildUnexpectedRunnerExitMessage includes runner output when available", () => {
  const message = buildUnexpectedRunnerExitMessage({
    exitCode: 1,
    stdout: "partial stdout",
    stderr: "fatal stderr",
  });

  assert.match(message, /code 1/);
  assert.match(message, /fatal stderr/);
  assert.match(message, /partial stdout/);
});

test("reconcileSessionState marks a command exit without a result file as failed", async () => {
  const sandbox = new FakeSandbox();
  const task = makeTaskRecord({
    taskId: "task_123",
    taskFileId: "file_123",
    cmdId: "cmd_123",
    prompt: "Do the thing",
  });

  await initializeSessionState(sandbox as never, sessionToken(), task);
  sandbox.setFile(
    logPath(task.taskFileId),
    logLine({
      ts: 2_000,
      type: "phase",
      phase: "booting",
      text: "Sandbox task booting",
      progressAt: 2_000,
    })
  );
  sandbox.setCommand(task.cmdId, {
    exitCode: 1,
    stderr: "runner crashed",
  });

  const state = await reconcileSessionState(
    sandbox as never,
    sessionToken()
  );
  const nextTask = state.tasks[0];

  assert.equal(nextTask.status, "failed");
  assert.equal(nextTask.phase, "failed");
  assert.match(nextTask.error ?? "", /runner crashed/);
  assert.match(nextTask.phaseDetail ?? "", /code 1/);
});

test("reconcileSessionState keeps a task running while the detached command is still alive", async () => {
  const sandbox = new FakeSandbox();
  const task = makeTaskRecord({
    taskId: "task_456",
    taskFileId: "file_456",
    cmdId: "cmd_456",
    prompt: "Keep going",
  });

  await initializeSessionState(sandbox as never, sessionToken(), task);
  sandbox.setFile(
    logPath(task.taskFileId),
    logLine({
      ts: Date.now(),
      type: "task_progress",
      phase: "coding",
      text: "Still working",
      progressAt: Date.now(),
    })
  );
  sandbox.setCommand(task.cmdId, {
    exitCode: null,
  });

  const state = await reconcileSessionState(
    sandbox as never,
    sessionToken()
  );
  const nextTask = state.tasks[0];

  assert.equal(nextTask.status, "running");
  assert.notEqual(nextTask.phase, "failed");
  assert.equal(nextTask.error, null);
});

test("buildTaskResponse returns structured recovery guidance when the task token no longer exists", async () => {
  const sandbox = new FakeSandbox();
  const task = makeTaskRecord({
    taskId: "task_789",
    taskFileId: "file_789",
    cmdId: "cmd_789",
    prompt: "Ship the change",
  });

  await initializeSessionState(sandbox as never, sessionToken(), task);
  sandbox.setCommand(task.cmdId, { exitCode: null });

  const response = await buildTaskResponse(
    new Request("https://middleware.example.test"),
    sandbox as never,
    sessionToken(),
    "task_missing"
  );

  assert.equal(response.status, "failed");
  assert.equal(response.phase, "failed");
  assert.equal(response.errorCode, "task_not_found");
  assert.equal(response.recoveryAction, "check_sandbox");
  assert.match(response.recoveryHint ?? "", /no longer maps to a task/i);
  assert.equal(response.retryAfterMs, null);
  assert.match(response.error ?? "", /task_missing/);
});

test("buildBusySessionResponse marks an active sandbox as busy with retry guidance", async () => {
  const sandbox = new FakeSandbox();
  const task = makeTaskRecord({
    taskId: "task_busy",
    taskFileId: "file_busy",
    cmdId: "cmd_busy",
    prompt: "Keep coding",
  });

  await initializeSessionState(sandbox as never, sessionToken(), task);
  const now = Date.now();
  sandbox.setFile(
    logPath(task.taskFileId),
    logLine({
      ts: now,
      type: "task_progress",
      phase: "coding",
      text: "Still making progress",
      progressAt: now,
    })
  );
  sandbox.setCommand(task.cmdId, { exitCode: null });

  const response = await buildBusySessionResponse(
    new Request("https://middleware.example.test"),
    sandbox as never,
    sessionToken()
  );

  assert.equal(response.status, "running");
  assert.equal(response.errorCode, "sandbox_busy");
  assert.equal(response.recoveryAction, "wait");
  assert.equal(response.retryAfterMs, 15_000);
  assert.match(response.recoveryHint ?? "", /already handling another task/i);
});

test("buildStoppedSessionResponse returns structured start-new-sandbox guidance", () => {
  const response = buildStoppedSessionResponse(
    new Request("https://middleware.example.test"),
    sessionToken()
  );

  assert.equal(response.status, "stopped");
  assert.equal(response.errorCode, "sandbox_stopped");
  assert.equal(response.recoveryAction, "start_new_sandbox");
  assert.match(response.recoveryHint ?? "", /start a new sandbox/i);
  assert.equal(response.retryAfterMs, null);
});

test("buildSessionView includes the session key but no mutable sandbox token", async () => {
  const sandbox = new FakeSandbox();
  const task = makeTaskRecord({
    taskId: "task_view",
    taskFileId: "file_view",
    cmdId: "cmd_view",
    prompt: "Inspect the sandbox",
  });

  await initializeSessionState(sandbox as never, sessionToken(), task);
  sandbox.setCommand(task.cmdId, { exitCode: null });

  const response = await buildSessionView(
    new Request("https://middleware.example.test"),
    sandbox as never,
    sessionToken()
  );

  assert.equal(response.sessionKey, sessionToken().sessionKey);
  assert.equal("sandboxToken" in response, false);
});

test("appendSessionTask prunes artifacts for older terminal tasks and keeps the latest task files", async () => {
  const sandbox = new FakeSandbox();
  const firstTask = makeTaskRecord({
    taskId: "task_old",
    taskFileId: "file_old",
    cmdId: "cmd_old",
    prompt: "Do the old thing",
  });

  await initializeSessionState(sandbox as never, sessionToken(), firstTask);
  sandbox.setFile(`/vercel/sandbox/.task-${firstTask.taskFileId}.mjs`, "old script");
  sandbox.setFile(
    logPath(firstTask.taskFileId),
    logLine({
      ts: 2_000,
      type: "result",
      phase: "complete",
      text: "Old task complete",
      progressAt: 2_000,
    })
  );
  sandbox.setFile(
    `/vercel/sandbox/.result-${firstTask.taskFileId}.json`,
    JSON.stringify({
      result: "Old result",
      agentSessionId: "agent_old",
      source: "sdk_result",
    })
  );

  await reconcileSessionState(sandbox as never, sessionToken());

  const nextTask = makeTaskRecord({
    taskId: "task_new",
    taskFileId: "file_new",
    cmdId: "cmd_new",
    prompt: "Do the new thing",
  });
  sandbox.setFile(`/vercel/sandbox/.task-${nextTask.taskFileId}.mjs`, "new script");

  const state = await appendSessionTask(
    sandbox as never,
    sessionToken(),
    nextTask
  );

  await assert.rejects(
    sandbox.readFileToBuffer({
      path: `/vercel/sandbox/.task-${firstTask.taskFileId}.mjs`,
    }),
    /ENOENT/
  );
  await assert.rejects(
    sandbox.readFileToBuffer({ path: logPath(firstTask.taskFileId) }),
    /ENOENT/
  );
  await assert.rejects(
    sandbox.readFileToBuffer({
      path: `/vercel/sandbox/.result-${firstTask.taskFileId}.json`,
    }),
    /ENOENT/
  );

  const retainedScript = await sandbox.readFileToBuffer({
    path: `/vercel/sandbox/.task-${nextTask.taskFileId}.mjs`,
  });
  assert.equal(retainedScript?.toString("utf-8"), "new script");

  const prunedTask = state.tasks.find((task) => task.taskId === firstTask.taskId);
  const latestTask = state.tasks.find((task) => task.taskId === nextTask.taskId);
  assert.ok(prunedTask?.artifactsPrunedAt);
  assert.equal(latestTask?.artifactsPrunedAt, null);
});
