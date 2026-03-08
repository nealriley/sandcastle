import assert from "node:assert/strict";
import test from "node:test";
import {
  applyExecutionStrategyEnvironmentDefaults,
  cloneExecutionStrategy,
  executionStrategyAcceptsPrompts,
  executionStrategyAllowsFollowUps,
  executionStrategyRequiredEnvironmentKeys,
  findMissingExecutionStrategyEnvironmentKeys,
  executionStrategyRequiresAnthropicProxy,
  formatShellCommand,
} from "../lib/execution-strategy";

test("executionStrategy helpers model shell-command prompt restrictions", () => {
  assert.equal(executionStrategyAcceptsPrompts("claude-agent"), true);
  assert.equal(executionStrategyAllowsFollowUps("claude-agent"), true);
  assert.equal(executionStrategyRequiresAnthropicProxy("claude-agent"), true);

  assert.equal(executionStrategyAcceptsPrompts("shell-command"), false);
  assert.equal(executionStrategyAllowsFollowUps("shell-command"), false);
  assert.equal(executionStrategyRequiresAnthropicProxy("shell-command"), false);
  assert.equal(
    executionStrategyAcceptsPrompts({
      kind: "shell-command",
      cmd: "bash",
      args: ["-lc", "echo hello"],
      cwd: "/vercel/sandbox",
      promptMode: "env",
      promptEnvKey: "WORDCOUNT_TARGET",
    }),
    true
  );
  assert.equal(
    executionStrategyAllowsFollowUps({
      kind: "shell-command",
      cmd: "bash",
      args: ["-lc", "echo hello"],
      cwd: "/vercel/sandbox",
      promptMode: "env",
      promptEnvKey: "WORDCOUNT_TARGET",
    }),
    false
  );
  assert.deepEqual(executionStrategyRequiredEnvironmentKeys("codex-agent"), [
    "OPENAI_API_KEY",
  ]);
  assert.deepEqual(
    findMissingExecutionStrategyEnvironmentKeys("codex-agent", {}),
    ["OPENAI_API_KEY"]
  );
  assert.deepEqual(
    findMissingExecutionStrategyEnvironmentKeys("codex-agent", {
      OPENAI_API_KEY: "sk-test",
    }),
    []
  );
  assert.deepEqual(
    findMissingExecutionStrategyEnvironmentKeys("claude-agent", {}),
    ["ANTHROPIC_API_KEY"]
  );
});

test("cloneExecutionStrategy preserves shell-command configuration", () => {
  const strategy = {
    kind: "shell-command" as const,
    cmd: "bash",
    args: ["-lc", "wc -l /vercel/sandbox/wordcount.txt"],
    cwd: "/vercel/sandbox",
    promptMode: "env" as const,
    promptEnvKey: "WORDCOUNT_TARGET",
  };

  const cloned = cloneExecutionStrategy(strategy);

  assert.deepEqual(cloned, strategy);
  assert.notEqual(cloned, strategy);
  assert.equal(formatShellCommand(strategy), "bash -lc wc -l /vercel/sandbox/wordcount.txt");
});

test("applyExecutionStrategyEnvironmentDefaults falls back to platform provider keys", () => {
  assert.deepEqual(
    applyExecutionStrategyEnvironmentDefaults(
      { kind: "claude-agent" },
      {},
      ({ ANTHROPIC_API_KEY: "platform-anthropic" } as unknown as NodeJS.ProcessEnv)
    ),
    { ANTHROPIC_API_KEY: "platform-anthropic" }
  );
  assert.deepEqual(
    applyExecutionStrategyEnvironmentDefaults(
      { kind: "codex-agent" },
      {},
      ({ OPENAI_API_KEY: "platform-openai" } as unknown as NodeJS.ProcessEnv)
    ),
    { OPENAI_API_KEY: "platform-openai" }
  );
});
