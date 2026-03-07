const REQUEST_HEADER_DENYLIST = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "x-api-key",
]);
const RESPONSE_HEADER_DENYLIST = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

export function getAnthropicProxyCredential(headers: Headers): string | null {
  const apiKey = headers.get("x-api-key");
  if (apiKey) {
    return apiKey;
  }

  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function buildAnthropicProxyForwardHeaders(
  source: Headers,
  upstreamApiKey: string
): Headers {
  const headers = new Headers();

  source.forEach((value, key) => {
    if (REQUEST_HEADER_DENYLIST.has(key.toLowerCase())) {
      return;
    }
    headers.set(key, value);
  });

  headers.set("x-api-key", upstreamApiKey);
  return headers;
}

export function buildAnthropicProxyResponseHeaders(source: Headers): Headers {
  const headers = new Headers();

  source.forEach((value, key) => {
    if (RESPONSE_HEADER_DENYLIST.has(key.toLowerCase())) {
      return;
    }
    headers.set(key, value);
  });

  return headers;
}

export function extractAnthropicProxyPath(params: unknown): string[] | null {
  if (!params || typeof params !== "object" || !("path" in params)) {
    return null;
  }

  return Array.isArray(params.path) &&
    params.path.every((segment) => typeof segment === "string")
    ? params.path
    : null;
}
