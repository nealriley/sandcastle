import { registerMcpOAuthClient } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const client = await registerMcpOAuthClient(body);
    return Response.json(client, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to register client.";
    return Response.json(
      { error: "invalid_client_metadata", error_description: message },
      { status: 400 }
    );
  }
}
