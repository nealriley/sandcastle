import { headers } from "next/headers";

function parseAuthHeader(value: string | null): {
  authHeaderPresent: boolean;
  authScheme: string | null;
  tokenLength: number | null;
} {
  if (!value) {
    return {
      authHeaderPresent: false,
      authScheme: null,
      tokenLength: null,
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      authHeaderPresent: false,
      authScheme: null,
      tokenLength: null,
    };
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return {
      authHeaderPresent: true,
      authScheme: null,
      tokenLength: trimmed.length,
    };
  }

  const scheme = trimmed.slice(0, spaceIndex);
  const token = trimmed.slice(spaceIndex + 1).trim();
  return {
    authHeaderPresent: true,
    authScheme: scheme || null,
    tokenLength: token.length || null,
  };
}

export async function GET(request: Request) {
  const requestHeaders = await headers();
  const auth = parseAuthHeader(requestHeaders.get("authorization"));

  return Response.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      method: request.method,
      path: "/api/template-validation",
      userAgent: requestHeaders.get("user-agent"),
      authHeaderPresent: auth.authHeaderPresent,
      authScheme: auth.authScheme,
      tokenLength: auth.tokenLength,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
