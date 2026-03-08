import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  buildCodexAgentRunnerScript,
  buildShellCommandRunnerScript,
  readAgentResult,
  selectFinalAgentResult,
} from "../lib/agent-runner.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

test("selectFinalAgentResult prefers the explicit SDK result over streamed or assistant text", () => {
  const selected = selectFinalAgentResult({
    sdkResult: "Final SDK result",
    responseText: "Streamed response text",
    assistantText: "Assistant block text",
    errorText: null,
    agentSessionId: "agent_123",
  });

  assert.deepEqual(selected, {
    result: "Final SDK result",
    agentSessionId: "agent_123",
    source: "sdk_result",
  });
});

test("selectFinalAgentResult prefers the accumulated response stream when no SDK result is available", () => {
  const selected = selectFinalAgentResult({
    sdkResult: null,
    responseText: "First part\nSecond part\n",
    assistantText: "Short assistant fallback",
    errorText: null,
    agentSessionId: "agent_456",
  });

  assert.deepEqual(selected, {
    result: "First part\nSecond part",
    agentSessionId: "agent_456",
    source: "response_stream",
  });
});

test("selectFinalAgentResult turns task errors into deterministic error results", () => {
  const selected = selectFinalAgentResult({
    sdkResult: "Should not win",
    responseText: "Should not win either",
    assistantText: "Also ignored",
    errorText: "Runner timed out",
    agentSessionId: "agent_789",
  });

  assert.deepEqual(selected, {
    result: "Error: Runner timed out",
    agentSessionId: "agent_789",
    source: "error",
  });
});

test("readAgentResult infers a fallback source for legacy result payloads", async () => {
  const sandbox = new FakeSandbox();
  sandbox.setFile(
    "/vercel/sandbox/.result-file_123.json",
    JSON.stringify({
      result: "Legacy assistant text",
      agentSessionId: "agent_legacy",
    })
  );

  const result = await readAgentResult(sandbox as never, "file_123");

  assert.deepEqual(result, {
    result: "Legacy assistant text",
    agentSessionId: "agent_legacy",
    source: "assistant_blocks",
  });
});

test("buildShellCommandRunnerScript includes the configured command and cwd", () => {
  const script = buildShellCommandRunnerScript({
    prompt: "",
    cmd: "bash",
    args: ["-lc", "wc -l /vercel/sandbox/wordcount.txt"],
    cwd: "/vercel/sandbox",
    promptMode: "none",
    promptEnvKey: null,
    taskFileId: "task_shell",
  });

  assert.match(script, /Running shell command/);
  assert.match(script, /wc -l \/vercel\/sandbox\/wordcount\.txt/);
  assert.match(script, /"\/vercel\/sandbox"/);
});

test("shell-command runner writes stdout as the final result", async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shell-runner-"));
  const taskFileId = "task_shell_success";
  const scriptPath = path.join(sandboxRoot, ".task-shell-success.mjs");
  const resultPath = path.join(sandboxRoot, `.result-${taskFileId}.json`);
  const logPath = path.join(sandboxRoot, `.log-${taskFileId}.jsonl`);

  try {
    await fs.writeFile(
      path.join(sandboxRoot, ".sandcastle-env.json"),
      "{}",
      "utf8"
    );
    await fs.writeFile(
      scriptPath,
      buildShellCommandRunnerScript({
        prompt: "",
        cmd: "bash",
        args: ["-lc", "printf '4 wordcount.txt\\n'"],
        cwd: sandboxRoot,
        promptMode: "none",
        promptEnvKey: null,
        taskFileId,
        sandboxRoot,
      }),
      "utf8"
    );

    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: sandboxRoot,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
      result: string;
      agentSessionId: string | null;
      source: string;
    };
    const logText = await fs.readFile(logPath, "utf8");

    assert.deepEqual(result, {
      result: "4 wordcount.txt",
      agentSessionId: null,
      source: "response_stream",
    });
    assert.match(logText, /task_started/);
    assert.match(logText, /"resultSource":"response_stream"/);
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("shell-command runner can pass the initial prompt through an environment variable", async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shell-runner-"));
  const taskFileId = "task_shell_prompt_env";
  const scriptPath = path.join(sandboxRoot, ".task-shell-prompt-env.mjs");
  const resultPath = path.join(sandboxRoot, `.result-${taskFileId}.json`);

  try {
    await fs.writeFile(
      path.join(sandboxRoot, ".sandcastle-env.json"),
      "{}",
      "utf8"
    );
    await fs.writeFile(
      scriptPath,
      buildShellCommandRunnerScript({
        prompt: "/vercel/sandbox/custom.txt",
        cmd: "bash",
        args: ["-lc", 'printf "%s" "$WORDCOUNT_TARGET"'],
        cwd: sandboxRoot,
        promptMode: "env",
        promptEnvKey: "WORDCOUNT_TARGET",
        taskFileId,
        sandboxRoot,
      }),
      "utf8"
    );

    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: sandboxRoot,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
      result: string;
      agentSessionId: string | null;
      source: string;
    };

    assert.deepEqual(result, {
      result: "/vercel/sandbox/custom.txt",
      agentSessionId: null,
      source: "response_stream",
    });
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("shell-command runner captures stderr and exit code as an error result", async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shell-runner-"));
  const taskFileId = "task_shell_fail";
  const scriptPath = path.join(sandboxRoot, ".task-shell-fail.mjs");
  const resultPath = path.join(sandboxRoot, `.result-${taskFileId}.json`);
  const logPath = path.join(sandboxRoot, `.log-${taskFileId}.jsonl`);

  try {
    await fs.writeFile(
      path.join(sandboxRoot, ".sandcastle-env.json"),
      "{}",
      "utf8"
    );
    await fs.writeFile(
      scriptPath,
      buildShellCommandRunnerScript({
        prompt: "",
        cmd: "bash",
        args: ["-lc", "printf 'runner exploded\\n' >&2; exit 7"],
        cwd: sandboxRoot,
        promptMode: "none",
        promptEnvKey: null,
        taskFileId,
        sandboxRoot,
      }),
      "utf8"
    );

    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: sandboxRoot,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
      result: string;
      agentSessionId: string | null;
      source: string;
    };
    const logText = await fs.readFile(logPath, "utf8");

    assert.deepEqual(result, {
      result: "Error: runner exploded",
      agentSessionId: null,
      source: "error",
    });
    assert.match(logText, /runner exploded/);
    assert.match(logText, /"exitCode":7/);
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("buildCodexAgentRunnerScript includes the OpenAI SDK install fallback", () => {
  const script = buildCodexAgentRunnerScript({
    prompt: "Inspect the repo and summarize the result.",
    taskFileId: "task_codex_builder",
    resumeSessionId: null,
  });

  assert.match(script, /OPENAI_PACKAGE_SPEC/);
  assert.match(script, /npm",\s*\[/);
  assert.match(script, /Installing OpenAI SDK/);
  assert.match(script, /gpt-5\.2-codex/);
});

test("codex-agent runner can execute a tool loop with a mocked OpenAI client", async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
  const taskFileId = "task_codex_success";
  const scriptPath = path.join(sandboxRoot, ".task-codex-success.mjs");
  const resultPath = path.join(sandboxRoot, `.result-${taskFileId}.json`);
  const logPath = path.join(sandboxRoot, `.log-${taskFileId}.jsonl`);
  const mockModulePath = path.join(sandboxRoot, "mock-openai.mjs");
  const notePath = path.join(sandboxRoot, "notes.txt");

  try {
    await fs.writeFile(
      path.join(sandboxRoot, ".sandcastle-env.json"),
      JSON.stringify(
        {
          OPENAI_API_KEY: "sk-test",
          OPENAI_MODEL: "gpt-test-codex",
          OPENAI_MODULE_SPECIFIER: pathToFileURL(mockModulePath).href,
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      mockModulePath,
      `
let callCount = 0;

export default class OpenAI {
  constructor(config) {
    this.config = config;
    this.chat = {
      completions: {
        create: async ({ messages, tools, model }) => {
          callCount += 1;
          if (callCount === 1) {
            return {
              _request_id: "req_first",
              choices: [
                {
                  message: {
                    content: "Creating notes.txt now.",
                    tool_calls: [
                      {
                        id: "tool_write_1",
                        type: "function",
                        function: {
                          name: "Write",
                          arguments: JSON.stringify({
                            file_path: "notes.txt",
                            content: "hello from codex\\n",
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          }

          if (!Array.isArray(messages) || !Array.isArray(tools) || model !== "gpt-test-codex") {
            throw new Error("Unexpected chat completion input.");
          }

          return {
            _request_id: "req_second",
            choices: [
              {
                message: {
                  content: "Created notes.txt and finished the task.",
                },
              },
            ],
          };
        },
      },
    };
  }
}
`,
      "utf8"
    );
    await fs.writeFile(
      scriptPath,
      buildCodexAgentRunnerScript({
        prompt: "Create notes.txt and confirm that it exists.",
        taskFileId,
        resumeSessionId: null,
        sandboxRoot,
      }),
      "utf8"
    );

    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: sandboxRoot,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
      result: string;
      agentSessionId: string | null;
      source: string;
    };
    const logText = await fs.readFile(logPath, "utf8");
    const noteText = await fs.readFile(notePath, "utf8");

    assert.deepEqual(result, {
      result: "Created notes.txt and finished the task.",
      agentSessionId: "codex-task_codex_success",
      source: "sdk_result",
    });
    assert.equal(noteText, "hello from codex\n");
    assert.match(logText, /"type":"tool_use"/);
    assert.match(logText, /"tool":"Write"/);
    assert.match(logText, /req_first/);
    assert.match(logText, /"resultSource":"sdk_result"/);
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});

test("codex-agent runner writes a deterministic error when OPENAI_API_KEY is missing", async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-runner-"));
  const taskFileId = "task_codex_missing_key";
  const scriptPath = path.join(sandboxRoot, ".task-codex-missing-key.mjs");
  const resultPath = path.join(sandboxRoot, `.result-${taskFileId}.json`);
  const logPath = path.join(sandboxRoot, `.log-${taskFileId}.jsonl`);

  try {
    await fs.writeFile(
      path.join(sandboxRoot, ".sandcastle-env.json"),
      "{}",
      "utf8"
    );
    await fs.writeFile(
      scriptPath,
      buildCodexAgentRunnerScript({
        prompt: "Do some work.",
        taskFileId,
        resumeSessionId: "resume/123",
        sandboxRoot,
      }),
      "utf8"
    );

    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      cwd: sandboxRoot,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
      result: string;
      agentSessionId: string | null;
      source: string;
    };
    const logText = await fs.readFile(logPath, "utf8");

    assert.deepEqual(result, {
      result: "Error: OPENAI_API_KEY is not configured in this sandbox.",
      agentSessionId: null,
      source: "error",
    });
    assert.match(logText, /OPENAI_API_KEY is not configured in this sandbox/);
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
});
