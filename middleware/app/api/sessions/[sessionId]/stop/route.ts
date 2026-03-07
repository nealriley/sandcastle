/**
 * POST /api/sessions/:sessionId/stop — End sandbox and stop the VM.
 *
 * Stops the sandbox VM and frees resources. The sandbox also auto-stops
 * after its timeout (~30 minutes of inactivity).
 *
 * Uses POST instead of DELETE to avoid potential issues with Coda's fetcher.
 */
import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { invalidTokenResponse } from "@/lib/auth";
import { decodeSessionToken } from "@/lib/tokens";
import { touchOwnedSession } from "@/lib/session-ownership";

export async function POST(
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
    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    await sandbox.stop();
    await touchOwnedSession({
      session: sessionData,
      updatedAt: Date.now(),
      latestPrompt: null,
      status: "stopped",
    });

    return Response.json({ message: "Sandbox ended." });
  } catch (error) {
    // Sandbox may already be stopped — that's fine
    const message =
      error instanceof Error ? error.message : String(error);
    const isAlreadyStopped =
      message.includes("not found") || message.includes("already");

    if (isAlreadyStopped) {
      await touchOwnedSession({
        session: sessionData,
        updatedAt: Date.now(),
        latestPrompt: null,
        status: "stopped",
      });
      return Response.json({ message: "Sandbox already ended." });
    }

    console.error("Failed to stop sandbox:", error);
    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}
