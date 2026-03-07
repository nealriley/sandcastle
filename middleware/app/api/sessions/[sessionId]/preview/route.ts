/**
 * GET /api/sessions/:sessionId/preview?port=3000 — Get preview URL.
 *
 * Returns the public URL for a port exposed on the sandbox.
 */
import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { invalidTokenResponse } from "@/lib/auth";
import { decodeSessionToken } from "@/lib/tokens";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId: sessionIdParam } = await params;
  const port = parseInt(req.nextUrl.searchParams.get("port") || "3000", 10);

  let sessionData;
  try {
    sessionData = decodeSessionToken(sessionIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid session token");
  }

  // Validate port against the session's allowed ports
  if (!sessionData.ports.includes(port)) {
    return Response.json(
      { error: `Invalid port ${port}. Allowed ports: ${sessionData.ports.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    const url = sandbox.domain(port);

    return Response.json({ url });
  } catch (error) {
    console.error("Failed to get preview URL:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get preview URL",
      },
      { status: 500 }
    );
  }
}
