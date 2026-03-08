import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandler,
} from "mcp-handler";
import {
  buildMcpAuthorizationServerUrl,
  buildMcpServerUrl,
} from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const handler = protectedResourceHandler({
    authServerUrls: [buildMcpAuthorizationServerUrl(req)],
    resourceUrl: buildMcpServerUrl(req),
  });
  return handler(req);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
