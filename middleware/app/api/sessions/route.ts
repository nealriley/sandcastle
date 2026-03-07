/**
 * POST /api/sessions — Create a new sandbox session and start the first task.
 *
 * 1. Validates auth
 * 2. Creates a Vercel Sandbox from snapshot (or fresh)
 * 3. Starts the Claude Agent SDK runner in detached mode
 * 4. Returns sessionId + taskId tokens immediately (< 10s)
 */
import { NextRequest } from "next/server";
import {
  tokenConfigurationErrorResponse,
  validateAuth,
} from "@/lib/auth";
import {
  normalizePairingCode,
  readPairingCode,
  redeemPairingCode,
} from "@/lib/pairing";
import {
  enforcePairingRedemptionLimits,
  enforceSessionCreateLimits,
  isRateLimitError,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  assertSessionStartTokenConfiguration,
} from "@/lib/tokens";
import {
  resolveTemplateEnvironment,
  resolveTemplatePrompt,
} from "@/lib/templates";
import {
  getDefaultTemplateSlug,
  resolveLaunchableTemplateBySlug,
} from "@/lib/template-service";
import { buildConnectorUrl, buildTemplateValidationUrl } from "@/lib/url";
import { createOwnedSandboxTask, MAX_PROMPT_LENGTH, VALID_RUNTIMES } from "@/lib/create-owned-sandbox";
import type { RuntimeName, TaskResponse } from "@/lib/types";

function authRequiredResponse(req: NextRequest, errorCode: "auth_required" | "invalid_auth_code") {
  const authUrl = buildConnectorUrl(req);
  const error =
    errorCode === "auth_required"
      ? "Website authentication is required before creating a sandbox. Open Sandcastle Connect, sign in with GitHub, and paste the three-word connect code into SHGO."
      : "That three-word connect code is invalid, expired, or already used. Open Sandcastle Connect and try again.";

  const response: TaskResponse = {
    taskId: "",
    sandboxId: "",
    sandboxToken: "",
    sessionId: "",
    templateSlug: null,
    templateName: null,
    status: "failed",
    phase: "failed",
    phaseDetail: error,
    isComplete: true,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: null,
    consoleTail: null,
    sandboxUrl: null,
    logsUrl: null,
    sessionUrl: null,
    authUrl,
    errorCode,
    recoveryAction: "authenticate",
    recoveryHint:
      "Open Sandcastle Connect, sign in with GitHub, and retry with a fresh three-word connect code.",
    retryAfterMs: null,
    error,
  };

  return Response.json(response, { status: 401 });
}

export async function POST(req: NextRequest) {
  // Auth check
  const authError = validateAuth(req);
  if (authError) return authError;

  // Parse body with error handling for malformed JSON
  let body: {
    prompt?: string;
    runtime?: string;
    authCode?: string;
    templateSlug?: string;
  };
  try {
    body = (await req.json()) as {
      prompt?: string;
      runtime?: string;
      authCode?: string;
      templateSlug?: string;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const {
    prompt,
    runtime = "node24",
    authCode,
    templateSlug = getDefaultTemplateSlug(),
  } = body;

  if (!prompt || typeof prompt !== "string") {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  if (!authCode || typeof authCode !== "string") {
    return authRequiredResponse(req, "auth_required");
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
      { status: 413 }
    );
  }

  // Validate runtime against whitelist
  if (!VALID_RUNTIMES.includes(runtime as RuntimeName)) {
    return Response.json(
      { error: `Invalid runtime '${runtime}'. Must be one of: ${VALID_RUNTIMES.join(", ")}` },
      { status: 400 }
    );
  }
  const requestedRuntime = runtime as RuntimeName;

  if (!templateSlug || typeof templateSlug !== "string") {
    return Response.json(
      { error: "Missing or invalid 'templateSlug' field" },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    assertSessionStartTokenConfiguration();
  } catch (error) {
    return tokenConfigurationErrorResponse(error);
  }

  try {
    let normalizedAuthCode: string | null = null;
    try {
      normalizedAuthCode = normalizePairingCode(authCode);
    } catch {}

    await enforcePairingRedemptionLimits(normalizedAuthCode);

    const pairingPreview = await readPairingCode(authCode);
    if (!pairingPreview) {
      return authRequiredResponse(req, "invalid_auth_code");
    }

    const template = await resolveLaunchableTemplateBySlug(
      templateSlug,
      pairingPreview.userId
    );
    if (!template) {
      return Response.json(
        {
          error: `Template '${templateSlug}' is not available for sandbox creation yet.`,
        },
        { status: 400 }
      );
    }

    if (!template.supportedRuntimes.includes(requestedRuntime)) {
      return Response.json(
        {
          error: `Template '${template.name}' supports runtimes: ${template.supportedRuntimes.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    if (
      template.source.kind === "snapshot" &&
      process.env[template.source.snapshotEnvVar] &&
      requestedRuntime !== template.source.snapshotRuntime
    ) {
      return Response.json(
        {
          error: `Snapshot-backed sandboxes for template '${template.name}' currently support only ${template.source.snapshotRuntime}.`,
        },
        { status: 400 }
      );
    }

    const resolvedEnvironment = resolveTemplateEnvironment(template, {}, {
      templateValidationUrl: buildTemplateValidationUrl(req),
    });
    const resolvedEnvKeys = Object.keys(resolvedEnvironment).sort();

    try {
      resolveTemplatePrompt(template, prompt, resolvedEnvironment);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid template prompt configuration.",
        },
        { status: 400 }
      );
    }

    await enforceSessionCreateLimits(pairingPreview.userId);

    const pairing = await redeemPairingCode(authCode);
    if (!pairing) {
      return authRequiredResponse(req, "invalid_auth_code");
    }

    const response = await createOwnedSandboxTask(req, {
      prompt,
      runtime: requestedRuntime,
      template,
      environment: resolvedEnvironment,
      envKeys: resolvedEnvKeys,
      ownerUserId: pairing.userId,
      ownerLogin: pairing.userLogin,
    });
    return Response.json(response, { status: 202 });
  } catch (error) {
    if (isRateLimitError(error)) {
      return rateLimitResponse(error);
    }
    console.error("Failed to create session:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create sandbox session",
      },
      { status: 500 }
    );
  }
}
