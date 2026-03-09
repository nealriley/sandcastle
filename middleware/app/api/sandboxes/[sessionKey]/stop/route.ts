import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { touchOwnedSession } from "@/lib/session-ownership";
import { getErrorMessage, isMissingSandboxError } from "@/lib/route-errors";
import { requireWebsiteOwnedSandbox } from "@/lib/website-owned-sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionKey: string }> }
) {
  try {
    const { sessionKey } = await params;
    if (!sessionKey) {
      return Response.json(
        { error: "Missing sandbox session key." },
        { status: 400 }
      );
    }

    const owned = await requireWebsiteOwnedSandbox(sessionKey);
    if (!owned.ok) {
      return owned.response;
    }

    const { record, session } = owned.context;
    if (!session || record.status === "stopped") {
      return Response.json(
        { message: "Sandbox already ended." },
        {
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    try {
      const sandbox = await Sandbox.get({ sandboxId: session.sandboxId });
      await sandbox.stop();
      await touchOwnedSession({
        session,
        updatedAt: Date.now(),
        latestPrompt: null,
        status: "stopped",
      });

      return Response.json(
        { message: "Sandbox ended." },
        {
          headers: { "Cache-Control": "no-store" },
        }
      );
    } catch (error) {
      if (isMissingSandboxError(error)) {
        await touchOwnedSession({
          session,
          updatedAt: Date.now(),
          latestPrompt: null,
          status: "stopped",
        });
        return Response.json(
          { message: "Sandbox already ended." },
          {
            headers: { "Cache-Control": "no-store" },
          }
        );
      }

      console.error("Failed to stop website sandbox:", error);
      return Response.json(
        { error: getErrorMessage(error, "Failed to stop sandbox.") },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unhandled website stop route failure:", error);
    return Response.json(
      { error: getErrorMessage(error, "Failed to stop sandbox.") },
      { status: 500 }
    );
  }
}
