import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { getWebsiteUser } from "@/auth";
import { buildSessionView, readSessionState } from "@/lib/session-state";
import { getOwnedSession } from "@/lib/session-ownership";
import { evaluateSessionViewAccess } from "@/lib/session-view-access";
import { decodeViewToken } from "@/lib/tokens";
import type { SessionToken, SessionViewResponse } from "@/lib/types";
import { buildSandboxUrl } from "@/lib/url";

function stoppedView(
  req: NextRequest,
  viewToken: string,
  sandboxId: string,
  metadata?: {
    sessionKey?: string;
    templateSlug?: string | null;
    templateName?: string | null;
    envKeys?: string[];
  }
): SessionViewResponse {
  return {
    sessionKey: metadata?.sessionKey ?? "",
    sandboxId,
    sandboxUrl: buildSandboxUrl(req, viewToken),
    templateSlug: metadata?.templateSlug ?? null,
    templateName: metadata?.templateName ?? null,
    envKeys: metadata?.envKeys ?? [],
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
  const { viewToken } = await params;
  const user = await getWebsiteUser();
  let sandboxIdForFallback = "";
  let sessionKeyForFallback = "";

  if (!user) {
    return Response.json(
      { error: "Sign in is required to view this sandbox." },
      { status: 401 }
    );
  }

  try {
    const viewData = decodeViewToken(viewToken);
    sandboxIdForFallback = viewData.sandboxId;
    sessionKeyForFallback = viewData.sessionKey;
    const record = await getOwnedSession(viewData.sessionKey);
    const access = evaluateSessionViewAccess({
      viewerUserId: user?.id ?? null,
      tokenOwnerUserId: viewData.ownerUserId,
      recordOwnerUserId: record?.ownerUserId ?? null,
    });

    if (access.kind === "unauthenticated") {
      return Response.json(
        { error: "Sign in is required to view this sandbox." },
        { status: 401 }
      );
    }

    if (access.kind === "forbidden") {
      return Response.json(
        { error: "This sandbox belongs to a different signed-in user." },
        { status: 403 }
      );
    }

    const sandbox = await Sandbox.get({ sandboxId: viewData.sandboxId });
    const state = await readSessionState(sandbox);
    if (!state) {
      return Response.json(
        stoppedView(req, viewToken, viewData.sandboxId, {
          sessionKey: viewData.sessionKey,
          templateSlug: record?.templateSlug ?? null,
          templateName: record?.templateName ?? null,
          envKeys: record?.envKeys ?? [],
        }),
        {
          headers: { "Cache-Control": "no-store" },
        }
      );
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
    response.envKeys = record?.envKeys ?? [];
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("not found") || error.message.includes("ENOENT"))
    ) {
      const record = sessionKeyForFallback
        ? await getOwnedSession(sessionKeyForFallback).catch(() => null)
        : null;
      return Response.json(
        stoppedView(req, viewToken, sandboxIdForFallback, {
          sessionKey: sessionKeyForFallback,
          templateSlug: record?.templateSlug ?? null,
          templateName: record?.templateName ?? null,
          envKeys: record?.envKeys ?? [],
        }),
        {
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    console.error("Failed to read public sandbox view:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read sandbox view",
      },
      { status: 500 }
    );
  }
}
