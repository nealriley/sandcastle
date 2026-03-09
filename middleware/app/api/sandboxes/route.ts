import { NextRequest } from "next/server";
import { encodeSessionToken } from "@/lib/tokens";
import {
  enforcePairingRedemptionLimits,
  isRateLimitError,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { listOwnedSessions } from "@/lib/session-ownership";
import { normalizePairingCode, readPairingCode } from "@/lib/pairing";
import { restoreOwnedSandboxSession } from "@/lib/owned-sandbox";
import {
  listLaunchableTemplateSummaries,
  listSystemTemplateSummaries,
} from "@/lib/template-service";
import { buildConnectorUrl, buildSandboxUrl } from "@/lib/url";
import { getErrorMessage } from "@/lib/route-errors";
import type {
  SandboxListResponse,
  SandboxSummary,
  SessionOwnershipRecord,
  SessionToken,
} from "@/lib/types";

const DEFAULT_PORTS = [3000, 5173, 8888];

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authRequiredResponse(
  req: NextRequest,
  errorCode: "auth_required" | "invalid_auth_code"
) {
  const authUrl = buildConnectorUrl(req);
  const error =
    errorCode === "auth_required"
      ? "Website authentication is required before listing owned sandboxes. Open Sandcastle Connect, sign in with GitHub, and paste the three-word connect code into SHGO."
      : "That three-word connect code is invalid or expired. Open Sandcastle Connect and try again.";

  const response: SandboxListResponse = {
    sandboxes: [],
    templates: listSystemTemplateSummaries(),
    authUrl,
    errorCode,
    error,
  };

  return Response.json(response, { status: 401 });
}

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

function matchesQuery(record: SessionOwnershipRecord, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystacks = [
    record.sandboxId,
    record.latestPrompt ?? "",
    record.status,
    record.runtime ?? "",
  ].map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(query));
}

export async function POST(req: NextRequest) {
  try {
    let body: {
      authCode?: string;
      query?: string;
      includeStopped?: boolean;
    };
    try {
      body = (await req.json()) as {
        authCode?: string;
        query?: string;
        includeStopped?: boolean;
      };
    } catch {
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { authCode, query, includeStopped = false } = body;
    if (!authCode || typeof authCode !== "string") {
      return authRequiredResponse(req, "auth_required");
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

      const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
      const owned = await listOwnedSessions(pairing.userId);
      const filtered = owned.filter((record) => {
        if (!includeStopped && record.status !== "active") {
          return false;
        }
        return matchesQuery(record, normalizedQuery);
      });

      const sandboxes: SandboxSummary[] = [];
      for (const record of filtered) {
        const restored = await restoreOwnedSandboxSession(record);
        if (!restored && record.status === "active" && !includeStopped) {
          continue;
        }

        const session = restored ?? fallbackSessionToken(record);
        const effectiveStatus =
          record.status === "active" && !restored ? "stopped" : record.status;
        sandboxes.push({
          sandboxId: record.sandboxId,
          sandboxToken: encodeSessionToken(session),
          sandboxUrl: buildSandboxUrl(req, record.latestViewToken),
          status: effectiveStatus,
          templateSlug: record.templateSlug ?? null,
          templateName: record.templateName ?? null,
          runtime: session.runtime,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          latestPrompt: record.latestPrompt,
        });
      }

      const response: SandboxListResponse = {
        sandboxes,
        templates: await listLaunchableTemplateSummaries(pairing.userId),
        authUrl: null,
        errorCode: null,
        error: null,
      };

      return Response.json(response, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        return rateLimitResponse(error);
      }

      console.error("Failed to list sandboxes:", error);
      return Response.json(
        {
          error: getErrorMessage(error, "Failed to list owned sandboxes"),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled /api/sandboxes route failure:", error);
    return Response.json(
      {
        error: getErrorMessage(error, "Failed to list owned sandboxes"),
      },
      { status: 500 }
    );
  }
}
