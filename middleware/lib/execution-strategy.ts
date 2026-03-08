import type { ExecutionStrategy } from "./template-service-types.js";

export type ExecutionStrategyKind = ExecutionStrategy["kind"];

function normalizeExecutionStrategyKind(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined
): ExecutionStrategyKind | null {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    return input;
  }

  return input.kind;
}

export function cloneExecutionStrategy(
  strategy: ExecutionStrategy
): ExecutionStrategy {
  if (strategy.kind === "shell-command") {
    return {
      kind: "shell-command",
      cmd: strategy.cmd,
      args: [...strategy.args],
      cwd: strategy.cwd,
      promptMode: strategy.promptMode,
      promptEnvKey: strategy.promptEnvKey,
    };
  }

  return { kind: strategy.kind };
}

export function executionStrategyAcceptsPrompts(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined
): boolean {
  if (!input) {
    return true;
  }

  if (typeof input === "string") {
    return input !== "shell-command";
  }

  if (input.kind !== "shell-command") {
    return true;
  }

  return input.promptMode !== "none";
}

export function executionStrategyAllowsFollowUps(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined
): boolean {
  return normalizeExecutionStrategyKind(input) !== "shell-command";
}

export function executionStrategyRequiresAnthropicProxy(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined
): boolean {
  return normalizeExecutionStrategyKind(input) === "claude-agent";
}

export function executionStrategyRequiredEnvironmentKeys(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined
): string[] {
  switch (normalizeExecutionStrategyKind(input)) {
    case "claude-agent":
      return ["ANTHROPIC_API_KEY"];
    case "codex-agent":
      return ["OPENAI_API_KEY"];
    default:
      return [];
  }
}

export function findMissingExecutionStrategyEnvironmentKeys(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined,
  environment: Record<string, string>
): string[] {
  return executionStrategyRequiredEnvironmentKeys(input).filter((key) => {
    const value = environment[key];
    return typeof value !== "string" || !value.trim();
  });
}

export function applyExecutionStrategyEnvironmentDefaults(
  input: ExecutionStrategy | ExecutionStrategyKind | null | undefined,
  environment: Record<string, string>,
  platformEnvironment: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const resolved = { ...environment };
  const kind = normalizeExecutionStrategyKind(input);

  if (
    kind === "claude-agent" &&
    (!resolved.ANTHROPIC_API_KEY || !resolved.ANTHROPIC_API_KEY.trim()) &&
    typeof platformEnvironment.ANTHROPIC_API_KEY === "string" &&
    platformEnvironment.ANTHROPIC_API_KEY.trim()
  ) {
    resolved.ANTHROPIC_API_KEY = platformEnvironment.ANTHROPIC_API_KEY.trim();
  }

  if (
    kind === "codex-agent" &&
    (!resolved.OPENAI_API_KEY || !resolved.OPENAI_API_KEY.trim()) &&
    typeof platformEnvironment.OPENAI_API_KEY === "string" &&
    platformEnvironment.OPENAI_API_KEY.trim()
  ) {
    resolved.OPENAI_API_KEY = platformEnvironment.OPENAI_API_KEY.trim();
  }

  return resolved;
}

export function formatShellCommand(
  strategy: Extract<ExecutionStrategy, { kind: "shell-command" }>
): string {
  return [strategy.cmd, ...strategy.args].filter(Boolean).join(" ").trim();
}
