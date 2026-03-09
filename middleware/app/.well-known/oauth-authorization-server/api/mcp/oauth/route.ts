import {
  buildMcpOAuthMetadataOptionsResponse,
  buildMcpOAuthMetadataResponse,
} from "@/lib/mcp-oauth-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request) {
  return buildMcpOAuthMetadataResponse(req);
}

export function OPTIONS() {
  return buildMcpOAuthMetadataOptionsResponse();
}
