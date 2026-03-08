import { NextResponse } from "next/server";
import { McpOAuthError, exchangeMcpAuthorizationCode } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const tokens = await exchangeMcpAuthorizationCode(req, formData);
    return NextResponse.json(tokens, {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return NextResponse.json(
        {
          error: error.oauthError,
          error_description: error.message,
        },
        {
          status: error.status,
          headers: corsHeaders,
        }
      );
    }

    const message =
      error instanceof Error ? error.message : "Failed to exchange access token.";
    return NextResponse.json(
      { error: "server_error", error_description: message },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
