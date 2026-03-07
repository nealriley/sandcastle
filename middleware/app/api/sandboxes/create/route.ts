import { NextRequest } from "next/server";
import { getWebsiteUser } from "@/auth";
import { tokenConfigurationErrorResponse } from "@/lib/auth";
import { createOwnedSandboxTask, MAX_PROMPT_LENGTH, VALID_RUNTIMES } from "@/lib/create-owned-sandbox";
import {
  resolveTemplatePrompt,
  resolveTemplateEnvironment,
} from "@/lib/templates";
import {
  getDefaultTemplateSlug,
  resolveLaunchableTemplateBySlug,
} from "@/lib/template-service";
import {
  normalizeSandboxEnvironment,
  type SandboxEnvironmentEntryInput,
} from "@/lib/sandbox-environment";
import {
  enforceSessionCreateLimits,
  isRateLimitError,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { assertSessionStartTokenConfiguration } from "@/lib/tokens";
import { buildTemplateValidationUrl } from "@/lib/url";
import type { RuntimeName } from "@/lib/types";

export async function POST(req: NextRequest) {
  const user = await getWebsiteUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with GitHub before creating a sandbox." },
      { status: 401 }
    );
  }

  let body: {
    prompt?: string;
    runtime?: string;
    templateSlug?: string;
    environment?: SandboxEnvironmentEntryInput[];
  };
  try {
    body = (await req.json()) as {
      prompt?: string;
      runtime?: string;
      templateSlug?: string;
      environment?: SandboxEnvironmentEntryInput[];
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const {
    prompt = "",
    runtime = "node24",
    templateSlug = getDefaultTemplateSlug(),
    environment = [],
  } = body;

  if (typeof prompt !== "string") {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
      { status: 413 }
    );
  }

  if (!VALID_RUNTIMES.includes(runtime as RuntimeName)) {
    return Response.json(
      {
        error: `Invalid runtime '${runtime}'. Must be one of: ${VALID_RUNTIMES.join(", ")}`,
      },
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

  const template = await resolveLaunchableTemplateBySlug(templateSlug, user.id);
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

  let normalizedEnvironment;
  try {
    normalizedEnvironment = normalizeSandboxEnvironment(environment);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid sandbox environment configuration.",
      },
      { status: 400 }
    );
  }

  const resolvedEnvironment = resolveTemplateEnvironment(
    template,
    normalizedEnvironment.env,
    {
      templateValidationUrl: buildTemplateValidationUrl(req),
    }
  );
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
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

  try {
    assertSessionStartTokenConfiguration();
  } catch (error) {
    return tokenConfigurationErrorResponse(error);
  }

  try {
    await enforceSessionCreateLimits(user.id);
    const response = await createOwnedSandboxTask(req, {
      prompt,
      runtime: requestedRuntime,
      template,
      environment: resolvedEnvironment,
      envKeys: resolvedEnvKeys,
      ownerUserId: user.id,
      ownerLogin: user.login,
    });

    return Response.json(response, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      return rateLimitResponse(error);
    }

    console.error("Failed to create website sandbox:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create sandbox",
      },
      { status: 500 }
    );
  }
}
