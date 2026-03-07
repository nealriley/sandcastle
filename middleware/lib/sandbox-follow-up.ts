import type { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { randomUUID } from "crypto";
import {
  appendSessionTask,
  makeTaskRecord,
  reconcileSessionState,
  refreshedSessionToken,
} from "./session-state";
import { getOwnedSession, touchOwnedSession } from "./session-ownership";
import { decodeSessionToken, encodeTaskToken } from "./tokens";
import { startAgentTask } from "./agent-runner";
import { buildAnthropicProxyBaseUrl, buildSandboxUrl } from "./url";
import type { SessionToken, TaskResponse } from "./types.js";

export async function startSandboxFollowUpTask(
  req: NextRequest,
  session: SessionToken,
  prompt: string
): Promise<TaskResponse> {
  const sandbox = await Sandbox.get({ sandboxId: session.sandboxId });
  const state = await reconcileSessionState(sandbox, session);

  // Best-effort timeout extension — may fail on Hobby plan if it
  // would exceed the 45-min maximum. Non-fatal.
  try {
    await sandbox.extendTimeout(10 * 60 * 1000);
  } catch (extErr) {
    console.warn("extendTimeout failed (non-fatal):", extErr);
  }

  const taskFileId = randomUUID();
  const anthropicBaseUrl = buildAnthropicProxyBaseUrl(req);

  const cmdId = await startAgentTask(
    sandbox,
    prompt,
    taskFileId,
    state.agentSessionId,
    anthropicBaseUrl
  );

  const taskId = encodeTaskToken({
    session: {
      ...session,
      agentSessionId: state.agentSessionId,
    },
    cmdId,
    taskFileId,
    createdAt: Date.now(),
  });
  const taskRecord = makeTaskRecord({
    taskId,
    taskFileId,
    cmdId,
    prompt,
  });
  const nextState = await appendSessionTask(sandbox, session, taskRecord);
  const sandboxToken = refreshedSessionToken(session, nextState);
  const sandboxUrl = buildSandboxUrl(req, session.viewToken);
  const nextSessionToken = decodeSessionToken(sandboxToken);
  const existingRecord = await getOwnedSession(session.sessionKey);

  await touchOwnedSession({
    session: nextSessionToken,
    updatedAt: taskRecord.updatedAt,
    latestPrompt: prompt,
    status: "active",
  });

  return {
    taskId,
    sandboxId: session.sandboxId,
    sandboxToken,
    sessionId: sandboxToken,
    templateSlug: existingRecord?.templateSlug ?? null,
    templateName: existingRecord?.templateName ?? null,
    status: "accepted",
    phase: taskRecord.phase,
    phaseDetail: taskRecord.phaseDetail,
    isComplete: false,
    createdAt: taskRecord.createdAt,
    updatedAt: taskRecord.updatedAt,
    completedAt: taskRecord.completedAt,
    lastLogAt: taskRecord.lastLogAt,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: "Waiting for the sandbox task to start.",
    consoleTail: null,
    sandboxUrl,
    logsUrl: sandboxUrl,
    sessionUrl: sandboxUrl,
    authUrl: null,
    errorCode: null,
    recoveryAction: "none",
    recoveryHint: null,
    retryAfterMs: null,
    error: null,
  };
}
