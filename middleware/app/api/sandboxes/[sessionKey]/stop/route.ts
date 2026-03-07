import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { touchOwnedSession } from "@/lib/session-ownership";
import { requireWebsiteOwnedSandbox } from "@/lib/website-owned-sandbox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionKey: string }> }
) {
  const { sessionKey } = await params;
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
    const message =
      error instanceof Error ? error.message : String(error);
    const isAlreadyStopped =
      message.includes("not found") || message.includes("already");

    if (isAlreadyStopped) {
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
      { error: message },
      { status: 500 }
    );
  }
}
