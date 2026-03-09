import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import {
  buildBusySessionResponse,
  buildStoppedSessionResponse,
  findCurrentTask,
  reconcileSessionState,
} from "@/lib/session-state";
import {
  enforcePairingRedemptionLimits,
  isRateLimitError,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { followUpExecutionStrategy } from "@/lib/execution-strategy";
import { findOwnedSessionBySandboxId } from "@/lib/session-ownership";
import { normalizePairingCode, readPairingCode } from "@/lib/pairing";
import { restoreOwnedSandboxSession } from "@/lib/owned-sandbox";
import { buildConnectorUrl } from "@/lib/url";
import { startSandboxFollowUpTask } from "@/lib/sandbox-follow-up";
import type { SessionOwnershipRecord, SessionToken, TaskResponse } from "@/lib/types";

const MAX_PROMPT_LENGTH = 100_000;
const DEFAULT_PORTS = [3000, 5173, 8888];

function fallbackSessionToken(record: SessionOwnershipRecord): SessionToken {
  return {
    sessionKey: record.sessionKey,
    sandboxId: record.sandboxId,
    agentSessionId: null,
    runtime: record.runtime ?? "node24",
    ports:
      Array.isArray(record.ports) && record.ports.length > 0
        ? record.ports
        : DEFAULT_PORTS,
    createdAt: record.createdAt,
    viewToken: record.latestViewToken,
    ownerUserId: record.ownerUserId,
    ownerLogin: record.ownerLogin,
  };
}

function authRequiredResponse(
  req: NextRequest,
  errorCode: "auth_required" | "invalid_auth_code"
) {
  const authUrl = buildConnectorUrl(req);
  const error =
    errorCode === "auth_required"
      ? "Website authentication is required before resuming an owned sandbox. Open Sandcastle Connect, sign in with GitHub, and paste the three-word connect code into SHGO."
      : "That three-word connect code is invalid or expired. Open Sandcastle Connect and try again.";

  const response: TaskResponse = {
    taskId: "",
    sandboxId: "",
    sandboxToken: "",
    sessionId: "",
    templateSlug: null,
    templateName: null,
    status: "failed",
    phase: "failed",
    phaseDetail: error,
    isComplete: true,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: null,
    consoleTail: null,
    sandboxUrl: null,
    logsUrl: null,
    sessionUrl: null,
    authUrl,
    errorCode,
    recoveryAction: "authenticate",
    recoveryHint:
      "Open Sandcastle Connect, sign in with GitHub, and retry with a fresh three-word connect code.",
    retryAfterMs: null,
    error,
  };

  return Response.json(response, { status: 401 });
}

export async function POST(req: NextRequest) {
  let body: { authCode?: string; sandboxId?: string; prompt?: string };
  try {
    body = (await req.json()) as {
      authCode?: string;
      sandboxId?: string;
      prompt?: string;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const { authCode, sandboxId, prompt } = body;

  if (!authCode || typeof authCode !== "string") {
    return authRequiredResponse(req, "auth_required");
  }

  if (!sandboxId || typeof sandboxId !== "string") {
    return Response.json(
      { error: "Missing or invalid 'sandboxId' field" },
      { status: 400 }
    );
  }

  if (!prompt || typeof prompt !== "string") {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
      { status: 413 }
    );
  }

  try {
    let normalizedAuthCode: string | null = null;
    try {
      normalizedAuthCode = normalizePairingCode(authCode);
    } catch {}

    await enforcePairingRedemptionLimits(normalizedAuthCode);

    const pairing = await readPairingCode(authCode);
    if (!pairing) {
      return authRequiredResponse(req, "invalid_auth_code");
    }

    const record = await findOwnedSessionBySandboxId(pairing.userId, sandboxId);
    if (!record) {
      return Response.json(
        { error: `No owned sandbox found for ${sandboxId}.` },
        { status: 404 }
      );
    }
    const followUpStrategy = followUpExecutionStrategy(
      record.executionStrategyKind ?? null
    );

    if (!followUpStrategy) {
      return Response.json(
        { error: "This template does not accept follow-up prompts." },
        { status: 400 }
      );
    }

    const session = await restoreOwnedSandboxSession(record);
    const fallbackSession = session ?? fallbackSessionToken(record);
    if (!session || record.status === "stopped") {
      const response = buildStoppedSessionResponse(req, fallbackSession);
      response.templateSlug = record.templateSlug ?? null;
      response.templateName = record.templateName ?? null;
      return Response.json(response, {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const sandbox = await Sandbox.get({ sandboxId: session.sandboxId });
    const state = await reconcileSessionState(sandbox, session);
    if (findCurrentTask(state)) {
      const response = await buildBusySessionResponse(req, sandbox, session);
      response.templateSlug = record.templateSlug ?? null;
      response.templateName = record.templateName ?? null;
      return Response.json(response, {
        status: 409,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(
            Math.max(1, Math.ceil((response.retryAfterMs ?? 15_000) / 1_000))
          ),
        },
      });
    }

    const response = await startSandboxFollowUpTask(
      req,
      session,
      prompt,
      followUpStrategy
    );
    return Response.json(response, { status: 202 });
  } catch (error) {
    if (isRateLimitError(error)) {
      return rateLimitResponse(error);
    }

    console.error("Failed to resume sandbox:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resume sandbox",
      },
      { status: 500 }
    );
  }
}
