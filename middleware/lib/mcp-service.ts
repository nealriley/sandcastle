import { Sandbox } from "@vercel/sandbox";
import {
  buildSessionView,
  buildStoppedSessionResponse,
} from "./session-state";
import { findMissingExecutionStrategyEnvironmentKeys } from "./execution-strategy";
import { listOwnedSessions, findOwnedSessionBySandboxId, touchOwnedSession } from "./session-ownership";
import { restoreOwnedSandboxSession } from "./owned-sandbox";
import { listLaunchableTemplateSummaries, resolveLaunchableTemplateBySlug } from "./template-service";
import { normalizeSandboxEnvironment, type SandboxEnvironmentEntryInput } from "./sandbox-environment";
import { listUserEnvironmentVariables } from "./user-environment";
import { resolveTemplateEnvironment, resolveTemplatePrompt } from "./templates";
import { MAX_PROMPT_LENGTH, VALID_RUNTIMES, createOwnedSandboxTask } from "./create-owned-sandbox";
import {
  MAX_TEXT_FILE_BYTES,
  normalizeReadableSandboxPath,
} from "./sandbox-file-access";
import type {
  RuntimeName,
  SessionToken,
  SessionViewResponse,
  TaskResponse,
} from "./types.js";

const DEFAULT_PORTS = [3000, 5173, 8888];

type McpOwner = {
  userId: string;
  userLogin: string | null;
};

function fallbackSessionToken(record: {
  sessionKey: string;
  sandboxId: string;
  runtime: RuntimeName;
  ports: number[];
  createdAt: number;
  latestViewToken: string;
  ownerUserId: string;
  ownerLogin: string | null;
}): SessionToken {
  return {
    sessionKey: record.sessionKey,
    sandboxId: record.sandboxId,
    agentSessionId: null,
    runtime: record.runtime,
    ports:
      Array.isArray(record.ports) && record.ports.length > 0
        ? record.ports
        : DEFAULT_PORTS,
    createdAt: record.createdAt,
    viewToken: record.latestViewToken,
    ownerUserId: record.ownerUserId,
    ownerLogin: record.ownerLogin,
  };
}

export function getMcpOwnerFromAuth(extra: {
  authInfo?: { extra?: Record<string, unknown> };
}): McpOwner {
  const ownerUserId =
    typeof extra.authInfo?.extra?.ownerUserId === "string"
      ? extra.authInfo.extra.ownerUserId
      : null;
  const ownerLogin =
    typeof extra.authInfo?.extra?.ownerLogin === "string"
      ? extra.authInfo.extra.ownerLogin
      : null;

  if (!ownerUserId) {
    throw new Error("MCP request is missing the authorized Sandcastle owner.");
  }

  return {
    userId: ownerUserId,
    userLogin: ownerLogin,
  };
}

export async function listMcpTemplates(owner: McpOwner) {
  return listLaunchableTemplateSummaries(owner.userId);
}

export async function listMcpSandboxes(
  req: Request,
  owner: McpOwner,
  includeStopped = true
) {
  const owned = await listOwnedSessions(owner.userId);
  const sandboxes = [];

  for (const record of owned) {
    if (!includeStopped && record.status !== "active") {
      continue;
    }

    const restored = await restoreOwnedSandboxSession(record);
    if (!restored && record.status === "active" && !includeStopped) {
      continue;
    }

    const effectiveStatus =
      record.status === "active" && !restored ? "stopped" : record.status;
    sandboxes.push({
      sandboxId: record.sandboxId,
      sandboxUrl: new URL(`/sandboxes/${encodeURIComponent(record.latestViewToken)}`, req.url).toString(),
      status: effectiveStatus,
      templateSlug: record.templateSlug ?? null,
      templateName: record.templateName ?? null,
      runtime: record.runtime,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      latestPrompt: record.latestPrompt,
    });
  }

  return sandboxes;
}

export async function launchMcpSandbox(
  req: Request,
  owner: McpOwner,
  input: {
    templateSlug: string;
    prompt?: string;
    runtime?: string;
    environment?: SandboxEnvironmentEntryInput[];
  }
): Promise<TaskResponse> {
  const templateSlug = input.templateSlug?.trim();
  if (!templateSlug) {
    throw new Error("templateSlug is required.");
  }

  const runtime = (input.runtime?.trim() || "node24") as RuntimeName;
  if (!VALID_RUNTIMES.includes(runtime)) {
    throw new Error(`runtime must be one of: ${VALID_RUNTIMES.join(", ")}.`);
  }

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters.`);
  }

  const template = await resolveLaunchableTemplateBySlug(templateSlug, owner.userId);
  if (!template) {
    throw new Error(`Template '${templateSlug}' is not available.`);
  }

  if (!template.supportedRuntimes.includes(runtime)) {
    throw new Error(
      `Template '${template.name}' supports runtimes: ${template.supportedRuntimes.join(", ")}.`
    );
  }

  let normalizedEnvironment;
  try {
    normalizedEnvironment = normalizeSandboxEnvironment(input.environment ?? []);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Invalid sandbox environment configuration."
    );
  }

  const storedVariables = await listUserEnvironmentVariables(owner.userId);
  const storedEnvironment = Object.fromEntries(
    storedVariables.map((variable) => [variable.key, variable.value])
  );
  const resolvedEnvironment = resolveTemplateEnvironment(
    template,
    {
      ...storedEnvironment,
      ...normalizedEnvironment.env,
    },
    {
      templateValidationUrl: new URL("/api/template-validation", req.url).toString(),
    }
  );
  const missingEnvironmentKeys = findMissingExecutionStrategyEnvironmentKeys(
    template.executionStrategy,
    resolvedEnvironment
  );
  if (missingEnvironmentKeys.length > 0) {
    throw new Error(
      `${template.name} requires ${missingEnvironmentKeys.join(", ")} before launch.`
    );
  }

  resolveTemplatePrompt(template, prompt, resolvedEnvironment);

  return createOwnedSandboxTask(req, {
    prompt,
    runtime,
    template,
    environment: resolvedEnvironment,
    envKeys: Object.keys(resolvedEnvironment).sort(),
    ownerUserId: owner.userId,
    ownerLogin: owner.userLogin,
  });
}

export async function getMcpSandboxView(
  req: Request,
  owner: McpOwner,
  sandboxId: string
): Promise<SessionViewResponse> {
  const record = await findOwnedSessionBySandboxId(owner.userId, sandboxId);
  if (!record) {
    throw new Error(`No owned sandbox found for ${sandboxId}.`);
  }

  const restored = await restoreOwnedSandboxSession(record);
  if (!restored || record.status === "stopped") {
    return {
      sessionKey: record.sessionKey,
      sandboxId: record.sandboxId,
      sandboxUrl: new URL(
        `/sandboxes/${encodeURIComponent(record.latestViewToken)}`,
        req.url
      ).toString(),
      templateSlug: record.templateSlug ?? null,
      templateName: record.templateName ?? null,
      executionStrategyKind: record.executionStrategyKind ?? null,
      envKeys: record.envKeys ?? [],
      status: "stopped",
      phase: "stopped",
      phaseDetail: "Sandbox is no longer running.",
      currentTaskId: null,
      latestPrompt: record.latestPrompt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastLogAt: null,
      previewUrl: null,
      previewUrls: [],
      previewStatus: "not-ready",
      previewHint: "Sandbox is stopped.",
      result: null,
      error: null,
      consoleText: "",
      consoleTail: null,
      liveThinking: null,
      liveResponse: null,
      logEntries: [],
      tasks: [],
    };
  }

  const sandbox = await Sandbox.get({ sandboxId: restored.sandboxId });
  const response = await buildSessionView(req, sandbox, restored);
  response.templateSlug = record.templateSlug ?? null;
  response.templateName = record.templateName ?? null;
  response.executionStrategyKind = record.executionStrategyKind ?? null;
  response.envKeys = record.envKeys ?? [];
  return response;
}

export async function readMcpSandboxFile(
  owner: McpOwner,
  sandboxId: string,
  path: string
): Promise<{ path: string; sizeBytes: number; content: string }> {
  const record = await findOwnedSessionBySandboxId(owner.userId, sandboxId);
  if (!record) {
    throw new Error(`No owned sandbox found for ${sandboxId}.`);
  }

  const restored = await restoreOwnedSandboxSession(record);
  if (!restored || record.status === "stopped") {
    throw new Error("Sandbox is stopped and files are no longer available.");
  }

  const normalizedPath = normalizeReadableSandboxPath(path);
  const sandbox = await Sandbox.get({ sandboxId: restored.sandboxId });
  const buffer = await sandbox.readFileToBuffer({ path: normalizedPath });
  if (!buffer) {
    throw new Error("File not found.");
  }

  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (nodeBuffer.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new Error(
      `ReadFile supports files up to ${MAX_TEXT_FILE_BYTES} bytes.`
    );
  }

  const content = new TextDecoder("utf-8", { fatal: true }).decode(nodeBuffer);
  return {
    path: normalizedPath,
    sizeBytes: nodeBuffer.byteLength,
    content,
  };
}

export async function stopMcpSandbox(
  owner: McpOwner,
  sandboxId: string
): Promise<{ sandboxId: string; status: "stopped"; message: string }> {
  const record = await findOwnedSessionBySandboxId(owner.userId, sandboxId);
  if (!record) {
    throw new Error(`No owned sandbox found for ${sandboxId}.`);
  }

  const session = (await restoreOwnedSandboxSession(record)) ?? fallbackSessionToken(record);

  try {
    const sandbox = await Sandbox.get({ sandboxId: session.sandboxId });
    await sandbox.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isAlreadyStopped =
      message.includes("not found") || message.includes("already");
    if (!isAlreadyStopped) {
      throw error;
    }
  }

  await touchOwnedSession({
    session,
    updatedAt: Date.now(),
    latestPrompt: record.latestPrompt,
    status: "stopped",
  });

  return {
    sandboxId: record.sandboxId,
    status: "stopped",
    message: "Sandbox stopped.",
  };
}
