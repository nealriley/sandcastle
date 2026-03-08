import { buildRunnerSharedScript } from "../runner-shared";

export function buildShellCommandRunnerScript(args: {
  prompt: string;
  cmd: string;
  args: string[];
  cwd: string | null;
  promptMode: "none" | "env";
  promptEnvKey: string | null;
  taskFileId: string;
  sandboxRoot?: string;
}): string {
  return buildRunnerSharedScript({
    taskFileId: args.taskFileId,
    sandboxRoot: args.sandboxRoot,
    extraImports: `import { spawn } from "node:child_process";`,
    main: `
const command = ${JSON.stringify(args.cmd)};
const commandArgs = ${JSON.stringify(args.args)};
const commandCwd = ${JSON.stringify(args.cwd)};
const promptText = ${JSON.stringify(args.prompt)};
const promptMode = ${JSON.stringify(args.promptMode)};
const promptEnvKey = ${JSON.stringify(args.promptEnvKey)};
const commandText = [command, ...commandArgs].filter(Boolean).join(" ").trim();
const childEnv =
  promptMode === "env" && promptEnvKey
    ? {
        ...process.env,
        [promptEnvKey]: promptText,
      }
    : process.env;

setPhase("coding", "Running shell command");
markProgress(
  "task_started",
  commandText
    ? "Running shell command: " + truncateText(commandText, 200)
    : "Running shell command",
  {
    phase: "coding",
    command: commandText || command,
    cwd: commandCwd,
  }
);

const child = spawn(command, commandArgs, {
  cwd: commandCwd || undefined,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdoutTextLocal = "";
let stderrTextLocal = "";

child.stdout?.setEncoding("utf8");
child.stderr?.setEncoding("utf8");

child.stdout?.on("data", (chunk) => {
  const text = String(chunk);
  stdoutTextLocal += text;
  appendStreamChunk("response", text, {
    phase: "coding",
    stream: "stdout",
  });
});

child.stderr?.on("data", (chunk) => {
  const text = String(chunk);
  stderrTextLocal += text;
  markProgress("task_progress", truncateText("[stderr] " + text, 800), {
    phase: "coding",
    stream: "stderr",
  });
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (typeof code === "number") {
      resolve(code);
      return;
    }

    reject(
      new Error(
        signal
          ? "Shell command terminated by signal " + signal
          : "Shell command exited without an exit code."
      )
    );
  });
});

flushAllStreamBuffers();

const normalizedStdout = normalizeResultText(stdoutTextLocal);
const normalizedStderr = normalizeResultText(stderrTextLocal);

if (exitCode === 0) {
  responseText =
    normalizedStdout ||
    normalizedStderr ||
    "Command completed successfully.";
  setPhase("complete", "Shell command complete");
  markProgress("result", truncateText(responseText, 800), {
    phase: "complete",
    exitCode,
  });
} else {
  errorText =
    normalizedStderr ||
    normalizedStdout ||
    "Shell command exited with code " + String(exitCode) + ".";
  setPhase("failed", "Shell command failed");
  markProgress("error", coerceErrorText(errorText), {
    phase: "failed",
    exitCode,
  });
}
`,
  });
}
