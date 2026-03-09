import { getMcpOAuthMetadata } from "./mcp-auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export function buildMcpOAuthMetadataResponse(
  req: Request,
  getMetadata: typeof getMcpOAuthMetadata = getMcpOAuthMetadata
): Response {
  try {
    return Response.json(getMetadata(req), {
      headers: {
        ...corsHeaders,
        "Cache-Control": "max-age=3600",
      },
    });
  } catch (error) {
    console.error("Failed to build MCP OAuth metadata:", error);
    return Response.json(
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

export function buildMcpOAuthMetadataOptionsResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}
