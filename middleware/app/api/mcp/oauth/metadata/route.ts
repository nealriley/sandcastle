import { NextResponse } from "next/server";
import { getMcpOAuthMetadata } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export function GET(req: Request) {
  return NextResponse.json(getMcpOAuthMetadata(req), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "max-age=3600",
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}
