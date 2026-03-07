import { NextRequest } from "next/server";
import {
  buildAnthropicProxyForwardHeaders,
  buildAnthropicProxyResponseHeaders,
  extractAnthropicProxyPath,
  getAnthropicProxyCredential,
} from "@/lib/anthropic-proxy";
import { decodeAnthropicProxyToken } from "@/lib/tokens";

export const runtime = "nodejs";

const ANTHROPIC_API_ORIGIN = "https://api.anthropic.com";

interface ProxyRouteContext {
  params: Promise<unknown>;
}

interface StreamingRequestInit extends RequestInit {
  duplex?: "half";
}

async function handleAnthropicProxy(
  req: NextRequest,
  context: ProxyRouteContext
): Promise<Response> {
  const upstreamApiKey = process.env.ANTHROPIC_API_KEY;
  if (!upstreamApiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const proxyCredential = getAnthropicProxyCredential(req.headers);
  if (!proxyCredential) {
    return Response.json(
      { error: "Missing Anthropic proxy credential" },
      { status: 401 }
    );
  }

  try {
    decodeAnthropicProxyToken(proxyCredential);
  } catch (error) {
    console.warn("Rejected Anthropic proxy request:", error);
    return Response.json(
      { error: "Invalid Anthropic proxy credential" },
      { status: 401 }
    );
  }

  const path = extractAnthropicProxyPath(await context.params);

  if (!path || path.length === 0) {
    return Response.json({ error: "Missing Anthropic path" }, { status: 404 });
  }

  const upstreamUrl = new URL(`/${path.join("/")}`, ANTHROPIC_API_ORIGIN);
  upstreamUrl.search = req.nextUrl.search;

  const init: StreamingRequestInit = {
    method: req.method,
    headers: buildAnthropicProxyForwardHeaders(req.headers, upstreamApiKey),
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    console.error("Anthropic proxy upstream request failed:", error);
    return Response.json(
      { error: "Failed to reach Anthropic upstream" },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildAnthropicProxyResponseHeaders(upstream.headers),
  });
}

export async function GET(req: NextRequest, context: ProxyRouteContext) {
  return handleAnthropicProxy(req, context);
}

export async function POST(req: NextRequest, context: ProxyRouteContext) {
  return handleAnthropicProxy(req, context);
}

export async function PUT(req: NextRequest, context: ProxyRouteContext) {
  return handleAnthropicProxy(req, context);
}

export async function PATCH(req: NextRequest, context: ProxyRouteContext) {
  return handleAnthropicProxy(req, context);
}

export async function DELETE(req: NextRequest, context: ProxyRouteContext) {
  return handleAnthropicProxy(req, context);
}
