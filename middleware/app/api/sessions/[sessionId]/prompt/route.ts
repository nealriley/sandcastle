/**
 * POST /api/sessions/:sessionId/prompt — Send a follow-up prompt.
 *
 * 1. Decodes the session token to get sandboxId + agentSessionId
 * 2. Reconnects to the existing sandbox
 * 3. Starts a new agent task with session resume
 * 4. Returns a new taskId for polling
 */
import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import {
  invalidTokenResponse,
  tokenConfigurationErrorResponse,
} from "@/lib/auth";
import {
  buildBusySessionResponse,
  buildStoppedSessionResponse,
  findCurrentTask,
  reconcileSessionState,
} from "@/lib/session-state";
import { getOwnedSession } from "@/lib/session-ownership";
import {
  assertFollowUpTokenConfiguration,
  decodeSessionToken,
} from "@/lib/tokens";
import { executionStrategyAllowsFollowUps } from "@/lib/execution-strategy";
import { startSandboxFollowUpTask } from "@/lib/sandbox-follow-up";
import type { ExecutionStrategy } from "@/lib/template-service-types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId: sessionIdParam } = await params;

  // Parse body with error handling for malformed JSON
  let body: { prompt?: string };
  try {
    body = (await req.json()) as { prompt?: string };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const { prompt } = body;

  if (!prompt || typeof prompt !== "string") {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  if (prompt.length > 100_000) {
    return Response.json(
      { error: "Prompt exceeds maximum length of 100000 characters" },
      { status: 413 }
    );
  }

  let sessionData;
  try {
    sessionData = decodeSessionToken(sessionIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid session token");
  }

  try {
    assertFollowUpTokenConfiguration();
  } catch (error) {
    return tokenConfigurationErrorResponse(error);
  }

  try {
    const record = await getOwnedSession(sessionData.sessionKey);
    const followUpStrategy: ExecutionStrategy = {
      kind:
        record?.executionStrategyKind === "codex-agent"
          ? "codex-agent"
          : "claude-agent",
    };
    if (!executionStrategyAllowsFollowUps(record?.executionStrategyKind ?? null)) {
      return Response.json(
        { error: "This template does not accept follow-up prompts." },
        { status: 400 }
      );
    }

    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    const state = await reconcileSessionState(sandbox, sessionData);

    if (findCurrentTask(state)) {
      const response = await buildBusySessionResponse(req, sandbox, sessionData);
      response.templateSlug = record?.templateSlug ?? null;
      response.templateName = record?.templateName ?? null;
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
      sessionData,
      prompt,
      followUpStrategy
    );
    return Response.json(response, { status: 202 });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("not found") || error.message.includes("ENOENT"))
    ) {
      const response = buildStoppedSessionResponse(req, sessionData);
      const record = await getOwnedSession(sessionData.sessionKey);
      response.templateSlug = record?.templateSlug ?? null;
      response.templateName = record?.templateName ?? null;
      return Response.json(response, {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("Failed to send prompt:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send prompt to sandbox",
      },
      { status: 500 }
    );
  }
}
