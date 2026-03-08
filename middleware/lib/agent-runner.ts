import type { Sandbox } from "@vercel/sandbox";
import type { ExecutionStrategy } from "./template-service-types";
import { encodeAnthropicProxyToken } from "./tokens";
import {
  buildClaudeAgentRunnerScript,
} from "./runners/claude-agent-runner";
import {
  buildCodexAgentRunnerScript,
} from "./runners/codex-agent-runner";
import { buildShellCommandRunnerScript } from "./runners/shell-command-runner";
export {
  buildClaudeAgentRunnerScript as buildRunnerScript,
} from "./runners/claude-agent-runner";
export { buildCodexAgentRunnerScript } from "./runners/codex-agent-runner";
export { buildShellCommandRunnerScript } from "./runners/shell-command-runner";
export {
  RUNNER_MAX_RUNTIME_MS,
  RUNNER_IDLE_WARNING_MS,
  RUNNER_IDLE_FAILURE_MS,
  RUNNER_HEARTBEAT_MS,
  RUNNER_MONITOR_INTERVAL_MS,
  type AgentCommandState,
  type AgentResultSource,
  type AgentTaskResultPayload,
  selectFinalAgentResult,
  buildUnexpectedRunnerExitMessage,
  readAgentLogs,
  readAgentResult,
  readAgentCommandState,
} from "./runner-shared";

/**
 * Writes the runner script to the sandbox and starts it in detached mode.
 * Returns the command ID for polling.
 */
export async function startAgentTask(
  sandbox: Sandbox,
  prompt: string,
  taskFileId: string,
  resumeSessionId: string | null,
  anthropicBaseUrl: string | null,
  executionStrategy: ExecutionStrategy = { kind: "claude-agent" }
): Promise<string> {
  let script: string;

  if (executionStrategy.kind === "claude-agent") {
    if (!anthropicBaseUrl) {
      throw new Error(
        "Claude agent tasks require an Anthropic proxy base URL."
      );
    }
    const anthropicProxyToken = encodeAnthropicProxyToken({
      sandboxId: sandbox.sandboxId,
      taskFileId,
    });
    script = buildClaudeAgentRunnerScript(
      prompt,
      taskFileId,
      resumeSessionId,
      anthropicProxyToken,
      anthropicBaseUrl
    );
  } else if (executionStrategy.kind === "shell-command") {
    script = buildShellCommandRunnerScript({
      prompt,
      cmd: executionStrategy.cmd,
      args: executionStrategy.args,
      cwd: executionStrategy.cwd,
      promptMode: executionStrategy.promptMode,
      promptEnvKey: executionStrategy.promptEnvKey,
      taskFileId,
    });
  } else {
    script = buildCodexAgentRunnerScript({
      prompt,
      taskFileId,
      resumeSessionId,
    });
  }

  await sandbox.writeFiles([
    {
      path: `/vercel/sandbox/.task-${taskFileId}.mjs`,
      content: Buffer.from(script),
    },
  ]);

  const command = await sandbox.runCommand({
    cmd: "node",
    args: [`/vercel/sandbox/.task-${taskFileId}.mjs`],
    detached: true,
  });

  return command.cmdId;
}
