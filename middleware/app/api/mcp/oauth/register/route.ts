import { NextResponse } from "next/server";
import { registerMcpOAuthClient } from "@/lib/mcp-auth";

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
    const body = await req.json();
    const client = await registerMcpOAuthClient(body);
    return NextResponse.json(client, {
      status: 201,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to register client.";
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: message },
      {
        status: 400,
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
