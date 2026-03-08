import { getMcpOAuthMetadata } from "@/lib/mcp-auth";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export async function GET(req: Request) {
  return Response.json(getMcpOAuthMetadata(req), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "max-age=3600",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}
