import { isTokenConfigurationError } from "./tokens";

/**
 * Validates the X-Agent-Key header against the expected API key.
 * Returns null if valid, or a Response object if unauthorized.
 */
export function validateAuth(req: { headers: Headers }): Response | null {
  const expected = process.env.AGENT_API_KEY;

  if (!expected) {
    console.error("AGENT_API_KEY not set in environment");
    return Response.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const provided = req.headers.get("X-Agent-Key");

  if (!provided || provided !== expected) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}

export function tokenConfigurationErrorResponse(error: unknown): Response {
  const message =
    error instanceof Error
      ? error.message
      : "Token signing is not configured correctly.";
  console.error("Token signing misconfigured:", error);
  return Response.json({ error: message }, { status: 500 });
}

export function invalidTokenResponse(
  error: unknown,
  invalidMessage: string
): Response {
  if (isTokenConfigurationError(error)) {
    return tokenConfigurationErrorResponse(error);
  }

  return Response.json({ error: invalidMessage }, { status: 400 });
}
