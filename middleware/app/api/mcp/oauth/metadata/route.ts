import { NextResponse } from "next/server";
import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { getMcpOAuthMetadata } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export async function GET(req: Request) {
  try {
    return NextResponse.json(getMcpOAuthMetadata(req), {
      headers: {
        ...corsHeaders,
        "Cache-Control": "max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to build MCP OAuth metadata:", error);
    return NextResponse.json(
      { error: "Failed to build MCP OAuth metadata." },
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
