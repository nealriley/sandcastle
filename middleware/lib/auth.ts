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

function getTemplateServiceInternalKey(): string {
  const explicit = process.env.TEMPLATE_SERVICE_INTERNAL_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = process.env.AGENT_API_KEY?.trim();
  if (fallback) {
    return fallback;
  }

  throw new Error(
    "Template service internal auth is not configured. Set TEMPLATE_SERVICE_INTERNAL_KEY or AGENT_API_KEY."
  );
}

export function assertTemplateServiceInternalAuthConfigured(): string {
  return getTemplateServiceInternalKey();
}

export function validateTemplateServiceInternalAuth(
  req: { headers: Headers }
): Response | null {
  let expected: string;
  try {
    expected = getTemplateServiceInternalKey();
  } catch (error) {
    console.error("Template service internal auth misconfigured:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Server misconfigured",
      },
      { status: 500 }
    );
  }

  const provided = req.headers.get("X-Template-Service-Key");
  if (!provided || provided !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
