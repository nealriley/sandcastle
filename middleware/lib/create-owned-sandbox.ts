import type { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { randomUUID } from "crypto";
import {
  initializeSessionState,
  makeTaskRecord,
} from "./session-state";
import { touchOwnedSession } from "./session-ownership";
import {
  encodeSessionToken,
  encodeTaskToken,
  encodeViewToken,
} from "./tokens";
import { startAgentTask } from "./agent-runner";
import {
  executionStrategyAcceptsPrompts,
  executionStrategyRequiresAnthropicProxy,
  formatShellCommand,
} from "./execution-strategy";
import {
  buildAnthropicProxyBaseUrl,
  buildSandboxUrl,
} from "./url";
import {
  resolveTemplatePrompt,
  type SandcastleTemplateDefinition,
} from "./templates";
import { writeSandboxEnvironmentFile } from "./sandbox-environment";
import type {
  RuntimeName,
  SessionToken,
  TaskResponse,
} from "./types.js";

export const VALID_RUNTIMES: RuntimeName[] = ["node24", "node22", "python3.13"];
export const MAX_PROMPT_LENGTH = 100_000;

function buildInitialTaskLabel(
  template: SandcastleTemplateDefinition,
  prompt: string
): string {
  if (template.executionStrategy.kind === "shell-command") {
    const promptInput = prompt.trim() || (template.defaultPrompt ?? "");
    if (
      executionStrategyAcceptsPrompts(template.executionStrategy) &&
      promptInput
    ) {
      return `Run shell command with input: ${promptInput}`;
    }

    return `Run shell command: ${formatShellCommand(template.executionStrategy)}`;
  }

  return prompt.trim() || (template.defaultPrompt ?? prompt);
}

function withSandboxEnvironment(
  params: Parameters<typeof Sandbox.create>[0],
  environment: Record<string, string>
): Parameters<typeof Sandbox.create>[0] {
  // The installed SDK types lag the runtime API here. Vercel documents
  // sandbox-level env support, and the underlying client accepts it.
  return {
    ...(params ?? {}),
    env: environment,
  } as unknown as Parameters<typeof Sandbox.create>[0];
}

function resolveTemplateSandboxCreateParams(args: {
  template: SandcastleTemplateDefinition;
  runtime: RuntimeName;
  environment: Record<string, string>;
}): {
  params: Parameters<typeof Sandbox.create>[0];
  actualRuntime: RuntimeName;
} {
  const { template, runtime, environment } = args;
  const baseParams = {
    resources: { vcpus: template.vcpus },
    timeout: template.timeoutMs,
    ports: template.ports,
  };

  if (template.source.kind === "snapshot") {
    const snapshotId = process.env[template.source.snapshotEnvVar];
    if (snapshotId) {
      return {
        params: withSandboxEnvironment(
          {
            ...baseParams,
            source: { type: "snapshot", snapshotId },
          },
          environment
        ),
        actualRuntime: template.source.snapshotRuntime,
      };
    }
  }

  return {
    params: withSandboxEnvironment(
      {
        ...baseParams,
        runtime,
      },
      environment
    ),
    actualRuntime: runtime,
  };
}

export async function createOwnedSandboxTask(
  req: Request | NextRequest,
  args: {
    prompt: string;
    runtime: RuntimeName;
    template: SandcastleTemplateDefinition;
    environment: Record<string, string>;
    envKeys: string[];
    ownerUserId: string;
    ownerLogin: string | null;
  }
): Promise<TaskResponse> {
  const {
    prompt,
    runtime,
    template,
    environment,
    envKeys,
    ownerUserId,
    ownerLogin,
  } = args;

  const launchSpec = resolveTemplateSandboxCreateParams({
    template,
    runtime,
    environment,
  });
  const sandbox = await Sandbox.create(launchSpec.params);

  try {
    const createdAt = Date.now();
    const sessionKey = randomUUID();
    const actualRuntime = launchSpec.actualRuntime;
    const viewToken = encodeViewToken({
      sessionKey,
      sandboxId: sandbox.sandboxId,
      ownerUserId,
      createdAt,
    });

    await template.bootstrap(sandbox, {
      runtime: actualRuntime,
      environment,
    });
    await writeSandboxEnvironmentFile(sandbox, environment);

    const sessionData: SessionToken = {
      sessionKey,
      sandboxId: sandbox.sandboxId,
      agentSessionId: null,
      runtime: actualRuntime,
      ports: template.ports,
      createdAt,
      viewToken,
      ownerUserId,
      ownerLogin,
    };

    const sessionId = encodeSessionToken(sessionData);
    const taskFileId = randomUUID();
    const anthropicBaseUrl = executionStrategyRequiresAnthropicProxy(
      template.executionStrategy
    )
      ? buildAnthropicProxyBaseUrl(req)
      : null;
    const initialPrompt = resolveTemplatePrompt(template, prompt, environment);
    const displayPrompt = buildInitialTaskLabel(template, prompt);

    const cmdId = await startAgentTask(
      sandbox,
      initialPrompt,
      taskFileId,
      null,
      anthropicBaseUrl,
      template.executionStrategy
    );

    const taskId = encodeTaskToken({
      session: sessionData,
      cmdId,
      taskFileId,
      createdAt: Date.now(),
    });
    const taskRecord = makeTaskRecord({
      taskId,
      taskFileId,
      cmdId,
      prompt: displayPrompt,
    });

    await initializeSessionState(sandbox, sessionData, taskRecord);
    await touchOwnedSession({
      session: sessionData,
      updatedAt: taskRecord.updatedAt,
      latestPrompt: displayPrompt,
      status: "active",
      templateSlug: template.slug,
      templateName: template.name,
      executionStrategyKind: template.executionStrategy.kind,
      envKeys,
    });

    const sandboxUrl = buildSandboxUrl(req, viewToken);

    return {
      taskId,
      sandboxId: sandbox.sandboxId,
      sandboxToken: sessionId,
      sessionId,
      templateSlug: template.slug,
      templateName: template.name,
      status: "accepted",
      phase: taskRecord.phase,
      phaseDetail: taskRecord.phaseDetail,
      isComplete: false,
      createdAt: taskRecord.createdAt,
      updatedAt: taskRecord.updatedAt,
      completedAt: taskRecord.completedAt,
      lastLogAt: taskRecord.lastLogAt,
      result: null,
      previewUrl: null,
      previewStatus: "not-ready",
      previewHint: "Waiting for the sandbox task to start.",
      consoleTail: null,
      sandboxUrl,
      logsUrl: sandboxUrl,
      sessionUrl: sandboxUrl,
      authUrl: null,
      errorCode: null,
      recoveryAction: "none",
      recoveryHint: null,
      retryAfterMs: null,
      error: null,
    };
  } catch (error) {
    await sandbox.stop().catch(() => {});
    throw error;
  }
}
