import { NextRequest } from "next/server";
import { getWebsiteUser } from "@/auth";
import { tokenConfigurationErrorResponse } from "@/lib/auth";
import { createOwnedSandboxTask, MAX_PROMPT_LENGTH, VALID_RUNTIMES } from "@/lib/create-owned-sandbox";
import {
  executionStrategyAcceptsPrompts,
  findMissingExecutionStrategyEnvironmentKeys,
} from "@/lib/execution-strategy";
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

  if (prompt != null && typeof prompt !== "string") {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }
  const promptText = typeof prompt === "string" ? prompt : "";

  if (promptText.length > MAX_PROMPT_LENGTH) {
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

  if (
    executionStrategyAcceptsPrompts(template.executionStrategy) &&
    !promptText.trim() &&
    !template.defaultPrompt
  ) {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
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
  const missingStrategyEnvKeys = findMissingExecutionStrategyEnvironmentKeys(
    template.executionStrategy,
    resolvedEnvironment
  );

  if (missingStrategyEnvKeys.length > 0) {
    return Response.json(
      {
        error: `${template.name} requires ${missingStrategyEnvKeys.join(", ")} before launch.`,
      },
      { status: 400 }
    );
  }

  try {
    resolveTemplatePrompt(template, promptText, resolvedEnvironment);
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
      prompt: promptText,
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
