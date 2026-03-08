import type { NextRequest } from "next/server";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getBaseUrl(req: Request | NextRequest): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if ("nextUrl" in req) {
    return trimTrailingSlash(req.nextUrl.origin);
  }

  return trimTrailingSlash(new URL(req.url).origin);
}

export function buildSandboxUrl(
  req: Request | NextRequest,
  viewToken: string
): string {
  return `${getBaseUrl(req)}/sandboxes/${encodeURIComponent(viewToken)}`;
}

export function buildConnectorUrl(req: Request | NextRequest): string {
  return `${getBaseUrl(req)}/connect/shgo`;
}

export function buildSandboxesUrl(req: Request | NextRequest): string {
  return `${getBaseUrl(req)}/sandboxes`;
}

export function buildAnthropicProxyBaseUrl(
  req: Request | NextRequest
): string {
  return `${getBaseUrl(req)}/api/anthropic`;
}

export function buildTemplateValidationUrl(
  req: Request | NextRequest
): string {
  return `${getBaseUrl(req)}/api/template-validation`;
}

export function buildMcpServerUrl(req: Request | NextRequest): string {
  return `${getBaseUrl(req)}/api/mcp`;
}

export function buildMcpProtectedResourceMetadataUrl(
  req: Request | NextRequest
): string {
  return `${getBaseUrl(req)}/.well-known/oauth-protected-resource/api/mcp`;
}

export function buildMcpAuthorizationServerUrl(
  req: Request | NextRequest
): string {
  return `${getBaseUrl(req)}/api/mcp/oauth`;
}

export function buildMcpAuthorizationMetadataUrl(
  req: Request | NextRequest
): string {
  return `${getBaseUrl(req)}/.well-known/oauth-authorization-server/api/mcp/oauth`;
}

export const buildConnectUrl = buildConnectorUrl;
export const buildSessionUrl = buildSandboxUrl;
export const buildSessionsUrl = buildSandboxesUrl;
