import { NextRequest, NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { getWebsiteUser } from "@/auth";
import { buildSessionView, readSessionState } from "@/lib/session-state";
import { getOwnedSession } from "@/lib/session-ownership";
import { evaluateSessionViewAccess } from "@/lib/session-view-access";
import {
  logSessionDiagnostic,
  summarizeOwnedSessionRecordForDiagnostics,
  summarizeSessionStateForDiagnostics,
  summarizeSessionViewForDiagnostics,
} from "@/lib/session-diagnostics";
import {
  getErrorMessage,
  isInvalidViewTokenError,
  isMissingSandboxError,
} from "@/lib/route-errors";
import type { ExecutionStrategy } from "@/lib/template-service-types";
import { decodeViewToken } from "@/lib/tokens";
import type { SessionToken, SessionViewResponse } from "@/lib/types";
import { buildSandboxUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeLogSessionDiagnostic(
  args: Parameters<typeof logSessionDiagnostic>[0]
) {
  try {
    logSessionDiagnostic(args);
  } catch (error) {
    console.error("Failed to emit session diagnostic:", error);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function stoppedView(
  req: NextRequest,
  viewToken: string,
  sandboxId: string,
  metadata?: {
    sessionKey?: string;
    templateSlug?: string | null;
    templateName?: string | null;
    executionStrategyKind?: ExecutionStrategy["kind"] | null;
    envKeys?: string[];
  }
): SessionViewResponse {
  return {
    sessionKey: metadata?.sessionKey ?? "",
    sandboxId,
    sandboxUrl: buildSandboxUrl(req, viewToken),
    templateSlug: metadata?.templateSlug ?? null,
    templateName: metadata?.templateName ?? null,
    executionStrategyKind: metadata?.executionStrategyKind ?? null,
    envKeys: normalizeStringArray(metadata?.envKeys),
    status: "stopped",
    phase: "stopped",
    phaseDetail: "Sandbox is no longer available.",
    currentTaskId: null,
    latestPrompt: null,
    createdAt: null,
    updatedAt: null,
    lastLogAt: null,
    previewUrl: null,
    previewUrls: [],
    previewStatus: "not-ready",
    previewHint: "Sandbox is no longer available.",
    result: null,
    error: "Sandbox is no longer available.",
    consoleText: "",
    consoleTail: null,
    liveThinking: null,
    liveResponse: null,
    logEntries: [],
    tasks: [],
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ viewToken: string }> }
) {
  let viewToken = "";
  let sandboxIdForFallback = "";
  let sessionKeyForFallback = "";
  let viewerUserId: string | null = null;
  let recordForFallback: Awaited<ReturnType<typeof getOwnedSession>> | null = null;
  let stoppedMetadata:
    | {
        sessionKey: string;
        templateSlug?: string | null;
        templateName?: string | null;
        executionStrategyKind?: ExecutionStrategy["kind"] | null;
        envKeys?: string[];
      }
    | undefined;

  try {
    const routeParams = await params;
    viewToken =
      typeof routeParams?.viewToken === "string" ? routeParams.viewToken : "";
    if (!viewToken) {
      return NextResponse.json(
        { error: "Missing sandbox view token." },
        { status: 400 }
      );
    }

    const user = await getWebsiteUser();
    viewerUserId = user?.id ?? null;

    if (!user) {
      safeLogSessionDiagnostic({
        event: "view_route_unauthenticated",
        level: "warn",
        data: {
          httpStatus: 401,
          viewTokenTail: viewToken.slice(-8),
        },
      });
      return NextResponse.json(
        { error: "Sign in is required to view this sandbox." },
        { status: 401 }
      );
    }

    const viewData = decodeViewToken(viewToken);
    sandboxIdForFallback = viewData.sandboxId;
    sessionKeyForFallback = viewData.sessionKey;
    const record = await getOwnedSession(viewData.sessionKey);
    recordForFallback = record;
    stoppedMetadata = {
      sessionKey: viewData.sessionKey,
      templateSlug: record?.templateSlug ?? null,
      templateName: record?.templateName ?? null,
      executionStrategyKind: record?.executionStrategyKind ?? null,
      envKeys: record?.envKeys ?? [],
    };
    const access = evaluateSessionViewAccess({
      viewerUserId: user.id,
      tokenOwnerUserId: viewData.ownerUserId,
      recordOwnerUserId: record?.ownerUserId ?? null,
    });

    if (access.kind === "unauthenticated") {
      safeLogSessionDiagnostic({
        event: "view_route_unauthenticated",
        level: "warn",
        data: {
          httpStatus: 401,
          sandboxId: viewData.sandboxId,
          sessionKey: viewData.sessionKey,
          viewerUserId: user.id,
          record: summarizeOwnedSessionRecordForDiagnostics(record),
        },
      });
      return NextResponse.json(
        { error: "Sign in is required to view this sandbox." },
        { status: 401 }
      );
    }

    if (access.kind === "forbidden") {
      safeLogSessionDiagnostic({
        event: "view_route_forbidden",
        level: "warn",
        data: {
          httpStatus: 403,
          sandboxId: viewData.sandboxId,
          sessionKey: viewData.sessionKey,
          viewerUserId: user.id,
          ownerUserId: access.ownerUserId,
          record: summarizeOwnedSessionRecordForDiagnostics(record),
        },
      });
      return NextResponse.json(
        { error: "This sandbox belongs to a different signed-in user." },
        { status: 403 }
      );
    }

    try {
      const sandbox = await Sandbox.get({ sandboxId: viewData.sandboxId });
      const state = await readSessionState(sandbox);
      if (!state) {
        safeLogSessionDiagnostic({
          event: "view_route_state_missing",
          level: "warn",
          data: {
            httpStatus: 200,
            sandboxId: viewData.sandboxId,
            sessionKey: viewData.sessionKey,
            viewerUserId: user.id,
            record: summarizeOwnedSessionRecordForDiagnostics(record),
          },
        });
        return NextResponse.json(stoppedView(req, viewToken, viewData.sandboxId, stoppedMetadata), {
          headers: { "Cache-Control": "no-store" },
        });
      }

      const session: SessionToken = {
        sessionKey: viewData.sessionKey,
        sandboxId: viewData.sandboxId,
        agentSessionId: state.agentSessionId,
        runtime: state.runtime,
        ports: state.ports,
        createdAt: state.createdAt,
        viewToken,
        ownerUserId: access.ownerUserId,
        ownerLogin: record?.ownerLogin ?? state.ownerLogin ?? null,
      };

      const response = await buildSessionView(req, sandbox, session);
      response.templateSlug = record?.templateSlug ?? null;
      response.templateName = record?.templateName ?? null;
      response.executionStrategyKind = record?.executionStrategyKind ?? null;
      response.envKeys = normalizeStringArray(record?.envKeys);

      if (
        response.status !== "running" ||
        response.error != null ||
        response.tasks.length === 0 ||
        response.phase === "stalled"
      ) {
        safeLogSessionDiagnostic({
          event: "view_route_anomalous_response",
          data: {
            httpStatus: 200,
            sandboxId: viewData.sandboxId,
            sessionKey: viewData.sessionKey,
            viewerUserId: user.id,
            record: summarizeOwnedSessionRecordForDiagnostics(record),
            state: summarizeSessionStateForDiagnostics(state),
            response: summarizeSessionViewForDiagnostics(response),
          },
        });
      }

      return NextResponse.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (isMissingSandboxError(error)) {
        safeLogSessionDiagnostic({
          event: "view_route_sandbox_missing",
          level: "warn",
          data: {
            httpStatus: 200,
            sandboxId: sandboxIdForFallback,
            sessionKey: sessionKeyForFallback,
            viewerUserId,
            error: error.message,
            record: summarizeOwnedSessionRecordForDiagnostics(recordForFallback),
          },
        });
        return NextResponse.json(
          stoppedView(req, viewToken, sandboxIdForFallback, stoppedMetadata),
          {
            headers: { "Cache-Control": "no-store" },
          }
        );
      }

      throw error;
    }
  } catch (unhandledError) {
    const status = isInvalidViewTokenError(unhandledError) ? 400 : 500;
    console.error("Unhandled sandbox view route failure:", unhandledError);
    safeLogSessionDiagnostic({
      event: "view_route_failed",
      level: "error",
      data: {
        httpStatus: status,
        sandboxId: sandboxIdForFallback,
        sessionKey: sessionKeyForFallback,
        viewerUserId,
        error: getErrorMessage(unhandledError, "Failed to read sandbox view"),
      },
    });
    return NextResponse.json(
      {
        error: getErrorMessage(unhandledError, "Failed to read sandbox view"),
      },
      { status }
    );
  }
}
