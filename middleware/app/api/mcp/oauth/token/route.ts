import { McpOAuthError, exchangeMcpAuthorizationCode } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const tokens = await exchangeMcpAuthorizationCode(req, formData);
    return Response.json(tokens, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return Response.json(
        {
          error: error.oauthError,
          error_description: error.message,
        },
        { status: error.status }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to exchange access token.";
    return Response.json(
      { error: "server_error", error_description: message },
      { status: 500 }
    );
  }
}
