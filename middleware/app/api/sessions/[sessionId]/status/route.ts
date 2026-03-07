import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import {
  buildSessionStatusResponse,
  buildStoppedSessionResponse,
} from "@/lib/session-state";
import { invalidTokenResponse } from "@/lib/auth";
import { getOwnedSession } from "@/lib/session-ownership";
import { decodeSessionToken } from "@/lib/tokens";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId: sessionIdParam } = await params;

  let sessionData;
  try {
    sessionData = decodeSessionToken(sessionIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid session token");
  }

  try {
    const record = await getOwnedSession(sessionData.sessionKey);
    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    const response = await buildSessionStatusResponse(req, sandbox, sessionData);
    response.templateSlug = record?.templateSlug ?? null;
    response.templateName = record?.templateName ?? null;

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
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
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("Failed to read sandbox status:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read sandbox status",
      },
      { status: 500 }
    );
  }
}
