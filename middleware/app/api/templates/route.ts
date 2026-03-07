import { NextRequest } from "next/server";
import {
  enforcePairingRedemptionLimits,
  isRateLimitError,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { normalizePairingCode, readPairingCode } from "@/lib/pairing";
import {
  getDefaultTemplateSlug,
  listLaunchableTemplateSummaries,
  listSystemTemplateSummaries,
} from "@/lib/template-service";
import type { TemplateListResponse } from "@/lib/types";
import { buildConnectorUrl } from "@/lib/url";

function buildTemplateListResponse(
  templates: TemplateListResponse["templates"]
): TemplateListResponse {
  return {
    templates,
    defaultTemplateSlug: getDefaultTemplateSlug(),
    authUrl: null,
    errorCode: null,
    error: null,
  };
}

function authRequiredResponse(
  req: NextRequest,
  errorCode: "auth_required" | "invalid_auth_code"
) {
  const authUrl = buildConnectorUrl(req);
  const error =
    errorCode === "auth_required"
      ? "Website authentication is required before listing owned templates. Open Sandcastle Connect, sign in with GitHub, and paste the three-word connector code into SHGO."
      : "That three-word connector code is invalid or expired. Open Sandcastle Connect and try again.";

  const response: TemplateListResponse = {
    templates: listSystemTemplateSummaries(),
    defaultTemplateSlug: getDefaultTemplateSlug(),
    authUrl,
    errorCode,
    error,
  };

  return Response.json(response, { status: 401 });
}

export async function GET() {
  const response = buildTemplateListResponse(
    await listLaunchableTemplateSummaries(null)
  );

  return Response.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let body: {
    authCode?: string;
    includeOwned?: boolean;
  };
  try {
    body = (await req.json()) as {
      authCode?: string;
      includeOwned?: boolean;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  if (!body.includeOwned) {
    return Response.json(
      buildTemplateListResponse(await listLaunchableTemplateSummaries(null)),
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  if (!body.authCode || typeof body.authCode !== "string") {
    return authRequiredResponse(req, "auth_required");
  }

  try {
    let normalizedAuthCode: string | null = null;
    try {
      normalizedAuthCode = normalizePairingCode(body.authCode);
    } catch {}

    await enforcePairingRedemptionLimits(normalizedAuthCode);

    const pairing = await readPairingCode(body.authCode);
    if (!pairing) {
      return authRequiredResponse(req, "invalid_auth_code");
    }

    const templates = await listLaunchableTemplateSummaries(pairing.userId);
    return Response.json(buildTemplateListResponse(templates), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      return rateLimitResponse(error);
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list templates.",
      },
      { status: 500 }
    );
  }
}
