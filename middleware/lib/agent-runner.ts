import type { Sandbox } from "@vercel/sandbox";
import { encodeAnthropicProxyToken } from "./tokens";
import { SANDBOX_ENV_PATH } from "./sandbox-environment";

export const RUNNER_MAX_RUNTIME_MS = 20 * 60 * 1000;
export const RUNNER_IDLE_WARNING_MS = 2 * 60 * 1000;
export const RUNNER_IDLE_FAILURE_MS = 12 * 60 * 1000;
export const RUNNER_HEARTBEAT_MS = 15 * 1000;
export const RUNNER_MONITOR_INTERVAL_MS = 5 * 1000;

const COMMAND_OUTPUT_TAIL_CHARS = 1_200;

export interface AgentCommandState {
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
}

export type AgentResultSource =
  | "sdk_result"
  | "response_stream"
  | "assistant_blocks"
  | "error"
  | "empty";

export interface AgentTaskResultPayload {
  result: string;
  agentSessionId: string | null;
  source: AgentResultSource;
}

function normalizeResultCandidate(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedEnd = value.trimEnd();
  return trimmedEnd.trim() ? trimmedEnd : null;
}

function coerceErrorResult(value: string): string {
  return value.startsWith("Error:") ? value : `Error: ${value}`;
}

function isAgentResultSource(value: unknown): value is AgentResultSource {
  return (
    value === "sdk_result" ||
    value === "response_stream" ||
    value === "assistant_blocks" ||
    value === "error" ||
    value === "empty"
  );
}

export function selectFinalAgentResult(args: {
  sdkResult?: string | null;
  responseText?: string | null;
  assistantText?: string | null;
  errorText?: string | null;
  agentSessionId: string | null;
}): AgentTaskResultPayload {
  const errorText = normalizeResultCandidate(args.errorText);
  if (errorText) {
    return {
      result: coerceErrorResult(errorText),
      agentSessionId: args.agentSessionId,
      source: "error",
    };
  }

  const sdkResult = normalizeResultCandidate(args.sdkResult);
  if (sdkResult) {
    return {
      result: sdkResult,
      agentSessionId: args.agentSessionId,
      source: "sdk_result",
    };
  }

  const responseText = normalizeResultCandidate(args.responseText);
  if (responseText) {
    return {
      result: responseText,
      agentSessionId: args.agentSessionId,
      source: "response_stream",
    };
  }

  const assistantText = normalizeResultCandidate(args.assistantText);
  if (assistantText) {
    return {
      result: assistantText,
      agentSessionId: args.agentSessionId,
      source: "assistant_blocks",
    };
  }

  return {
    result: "Error: Agent produced no output",
    agentSessionId: args.agentSessionId,
    source: "empty",
  };
}

function isMissingSandboxFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not found") ||
    message.includes("No such file") ||
    message.includes("ENOENT")
  );
}

function tailCommandOutput(output: string | null): string | null {
  if (!output) return null;
  if (output.length <= COMMAND_OUTPUT_TAIL_CHARS) {
    return output.trim() || null;
  }

  return output.slice(-COMMAND_OUTPUT_TAIL_CHARS).trim() || null;
}

export function buildUnexpectedRunnerExitMessage(
  command: Pick<AgentCommandState, "exitCode" | "stdout" | "stderr">
): string {
  const base =
    command.exitCode === 0
      ? "Agent runner exited without writing a result."
      : `Agent runner exited unexpectedly with code ${command.exitCode}.`;
  const details: string[] = [];

  const stderrTail = tailCommandOutput(command.stderr);
  const stdoutTail = tailCommandOutput(command.stdout);

  if (stderrTail) {
    details.push(`stderr:\n${stderrTail}`);
  }
  if (stdoutTail) {
    details.push(`stdout:\n${stdoutTail}`);
  }

  if (details.length === 0) {
    return `${base} Check the sandbox console for the last SDK event.`;
  }

  return `${base}\n\n${details.join("\n\n")}`;
}

/**
 * Generates the Node.js script that runs inside the Vercel Sandbox.
 *
 * This script:
 * 1. Imports the Claude Agent SDK
 * 2. Calls query() with the user's prompt (optionally resuming a session)
 * 3. Collects the final result text + session ID
 * 4. Writes a structured JSON result file for the middleware to read
 */
export function buildRunnerScript(
  prompt: string,
  taskFileId: string,
  resumeSessionId: string | null,
  anthropicProxyToken: string,
  anthropicBaseUrl: string
): string {
  const escapedPrompt = JSON.stringify(prompt);
  const resumeLine = resumeSessionId
    ? `resume: ${JSON.stringify(resumeSessionId)},`
    : "";

  return `
// ── Imports (hoisted by ESM before any runtime code) ────────────
import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";

// ── Constants ───────────────────────────────────────────────────
const TASK_FILE_ID = ${JSON.stringify(taskFileId)};
const ANTHROPIC_PROXY_TOKEN = ${JSON.stringify(anthropicProxyToken)};
const ANTHROPIC_PROXY_BASE_URL = ${JSON.stringify(anthropicBaseUrl)};
const SANDBOX_ENV_PATH = ${JSON.stringify(SANDBOX_ENV_PATH)};
const RESULT_PATH = "/vercel/sandbox/.result-" + TASK_FILE_ID + ".json";
const LOG_PATH = "/vercel/sandbox/.log-" + TASK_FILE_ID + ".jsonl";
const MAX_RUNTIME_MS = ${RUNNER_MAX_RUNTIME_MS};
const IDLE_WARNING_MS = ${RUNNER_IDLE_WARNING_MS};
const IDLE_FAILURE_MS = ${RUNNER_IDLE_FAILURE_MS};
const HEARTBEAT_MS = ${RUNNER_HEARTBEAT_MS};
const MONITOR_INTERVAL_MS = ${RUNNER_MONITOR_INTERVAL_MS};

// Load the sandbox-specific environment bundle from disk so follow-up tasks keep
// seeing the same user-provided variables even though the installed SDK client
// does not yet support create-time sandbox env serialization.
try {
  const sandboxEnv = JSON.parse(readFileSync(SANDBOX_ENV_PATH, "utf-8"));
  if (sandboxEnv && typeof sandboxEnv === "object") {
    for (const [key, value] of Object.entries(sandboxEnv)) {
      if (typeof value === "string") {
        process.env[key] = value;
      }
    }
  }
} catch {
  // Missing or invalid env file is non-fatal.
}

// Preserve the sandbox environment and only layer the Anthropic proxy vars on top.
process.env.ANTHROPIC_API_KEY = ANTHROPIC_PROXY_TOKEN;
process.env.ANTHROPIC_BASE_URL = ANTHROPIC_PROXY_BASE_URL;

// ── Logging helper ──────────────────────────────────────────────
// Appends a JSONL line to the log file for real-time progress tracking.
// The middleware reads this file to stream logs to the browser.
let currentPhase = "queued";
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastIdleWarningBucket = 0;

function log(type, text, extra) {
  try {
    const entry = {
      ts: Date.now(),
      type,
      text,
      phase: currentPhase,
      progressAt: lastProgressAt,
      ...extra,
    };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\\n");
  } catch {
    // Non-fatal — don't let logging failures break the agent
  }
}

function markProgress(type, text, extra) {
  lastProgressAt = Date.now();
  log(type, text, { progressAt: lastProgressAt, ...extra });
}

function setPhase(phase, text, extra) {
  currentPhase = phase;
  markProgress("phase", text, { phase, ...extra });
}

function classifyBashCommand(command) {
  const normalized = String(command || "").replace(/\\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return { phase: "coding", text: "Running Bash command" };
  }

  if (
    /(npm|pnpm|yarn|bun|pip|pip3|uv|poetry|cargo|go)(\\s+\\w+)*\\s+(install|add|sync|get|fetch|restore)\\b/.test(normalized) ||
    /apt(-get)?\\s+install\\b/.test(normalized)
  ) {
    return { phase: "installing", text: "Installing dependencies" };
  }

  if (
    /(npm|pnpm|yarn|bun)\\s+(run\\s+)?(dev|start|serve|preview)\\b/.test(normalized) ||
    /(next|vite|webpack-dev-server|nodemon)\\b/.test(normalized) ||
    /python3?\\s+-m\\s+http\\.server\\b/.test(normalized)
  ) {
    return { phase: "preview-starting", text: "Starting a preview server" };
  }

  return {
    phase: "coding",
    text: "Running command: " + normalized.slice(0, 80),
  };
}

function classifyToolUse(name, inputText) {
  if (name === "Bash") {
    return classifyBashCommand(inputText);
  }

  if (name === "Read" || name === "Glob" || name === "Grep") {
    return { phase: "coding", text: "Inspecting files with " + name };
  }

  if (name === "Write" || name === "Edit") {
    return { phase: "coding", text: "Updating files with " + name };
  }

  return { phase: "coding", text: "Using " + name };
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickMessageText(message, keys, fallback) {
  for (const key of keys) {
    if (typeof message?.[key] === "string" && message[key]) {
      return message[key];
    }
  }

  if (fallback) {
    return fallback;
  }

  return stringifyValue(message);
}

function logSdkMessage(type, message, extra) {
  markProgress(type, truncateText(message, 800), extra);
}

function formatDuration(ms) {
  if (ms < 1_000) return "under 1s";

  const totalSeconds = Math.floor(ms / 1_000);
  if (totalSeconds < 60) return totalSeconds + "s";

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? minutes + "m " + seconds + "s" : minutes + "m";
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? hours + "h " + remMinutes + "m" : hours + "h";
}

function buildTimeoutMessage(kind, runtimeMs, idleMs) {
  const phaseText = currentPhase ? " Last phase: " + currentPhase + "." : "";
  if (kind === "idle") {
    return "Agent stopped making progress for " + formatDuration(idleMs) + " and was stopped after " + formatDuration(runtimeMs) + "." + phaseText + " Try breaking the task into smaller steps or checking the sandbox console for the last visible activity.";
  }
  return "Agent exceeded the runtime limit after " + formatDuration(runtimeMs) + "." + phaseText + " Try breaking the task into smaller steps or continuing from the latest session state.";
}

function failRunner(message) {
  console.error(message);
  currentPhase = "failed";
  markProgress("error", message, {
    phase: "failed",
    runtimeMs: Date.now() - startedAt,
  });
  writeResult(
    selectFinalResult({
      sdkResult: sdkResultText,
      responseText,
      assistantText,
      errorText: message,
      agentSessionId,
    })
  );
  process.exit(1);
}

const streamBuffers = {
  thinking: { text: "", lastFlushAt: 0, type: "thinking_delta", phase: "thinking" },
  response: { text: "", lastFlushAt: 0, type: "response_delta", phase: "coding" },
  toolInput: { text: "", lastFlushAt: 0, type: "tool_input_delta", phase: "coding" },
};

const openBlocks = new Map();
let sawThinkingDelta = false;
let sawResponseDelta = false;

function flushStreamBuffer(kind) {
  if (!kind || !streamBuffers[kind]) {
    return;
  }

  const buffer = streamBuffers[kind];
  if (!buffer.text) {
    return;
  }

  const text = buffer.text;
  buffer.text = "";
  buffer.lastFlushAt = Date.now();
  markProgress(buffer.type, text, { phase: buffer.phase });
}

function flushAllStreamBuffers() {
  flushStreamBuffer("thinking");
  flushStreamBuffer("response");
  flushStreamBuffer("toolInput");
}

function appendStreamChunk(kind, chunk, extra) {
  if (!chunk || !streamBuffers[kind]) {
    return;
  }

  const buffer = streamBuffers[kind];
  buffer.text += chunk;

  const now = Date.now();
  const shouldFlush =
    buffer.text.length >= 220 ||
    String(chunk).includes("\\n") ||
    now - buffer.lastFlushAt >= 800;

  if (!shouldFlush) {
    return;
  }

  const text = buffer.text;
  buffer.text = "";
  buffer.lastFlushAt = now;
  markProgress(buffer.type, text, { phase: buffer.phase, ...extra });
}

function handleStreamEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (event.type === "content_block_start") {
    const block = event.content_block || {};

    if (block.type === "thinking") {
      openBlocks.set(event.index, "thinking");
      if (currentPhase !== "thinking") {
        setPhase("thinking", "Claude is reasoning through the task");
      }
      return;
    }

    if (block.type === "text") {
      openBlocks.set(event.index, "response");
      if (
        currentPhase === "queued" ||
        currentPhase === "booting" ||
        currentPhase === "prompting" ||
        currentPhase === "thinking"
      ) {
        setPhase("coding", "Claude is responding");
      }
      return;
    }

    if (block.type === "tool_use") {
      openBlocks.set(event.index, "toolInput");
      const inputStr =
        typeof block.input === "string"
          ? block.input
          : stringifyValue(block.input || {});
      const toolPhase = classifyToolUse(block.name || "Tool", inputStr);
      if (toolPhase.phase !== currentPhase) {
        setPhase(toolPhase.phase, toolPhase.text, {
          tool: block.name,
          input: truncateText(inputStr, 200),
        });
      }
    }

    return;
  }

  if (event.type === "content_block_delta") {
    const delta = event.delta || {};

    if (delta.type === "thinking_delta" && delta.thinking) {
      sawThinkingDelta = true;
      if (currentPhase !== "thinking") {
        setPhase("thinking", "Claude is reasoning through the task");
      }
      appendStreamChunk("thinking", delta.thinking, { phase: "thinking" });
      return;
    }

    if (delta.type === "text_delta" && delta.text) {
      sawResponseDelta = true;
      if (
        currentPhase === "queued" ||
        currentPhase === "booting" ||
        currentPhase === "prompting" ||
        currentPhase === "thinking"
      ) {
        setPhase("coding", "Claude is responding");
      }
      appendStreamChunk("response", delta.text, { phase: "coding" });
      return;
    }

    if (delta.type === "input_json_delta" && delta.partial_json) {
      appendStreamChunk("toolInput", delta.partial_json, { phase: currentPhase });
    }

    return;
  }

  if (event.type === "content_block_stop") {
    const kind = openBlocks.get(event.index);
    flushStreamBuffer(kind);
    openBlocks.delete(event.index);
    return;
  }

  if (event.type === "message_stop") {
    flushAllStreamBuffers();
  }
}

function normalizeResultText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedEnd = value.trimEnd();
  return trimmedEnd.trim() ? trimmedEnd : null;
}

function coerceErrorText(value) {
  return value.startsWith("Error:") ? value : "Error: " + value;
}

function selectFinalResult(input) {
  const errorText = normalizeResultText(input.errorText);
  if (errorText) {
    return {
      result: coerceErrorText(errorText),
      agentSessionId: input.agentSessionId || null,
      source: "error",
    };
  }

  const sdkResult = normalizeResultText(input.sdkResult);
  if (sdkResult) {
    return {
      result: sdkResult,
      agentSessionId: input.agentSessionId || null,
      source: "sdk_result",
    };
  }

  const responseText = normalizeResultText(input.responseText);
  if (responseText) {
    return {
      result: responseText,
      agentSessionId: input.agentSessionId || null,
      source: "response_stream",
    };
  }

  const assistantText = normalizeResultText(input.assistantText);
  if (assistantText) {
    return {
      result: assistantText,
      agentSessionId: input.agentSessionId || null,
      source: "assistant_blocks",
    };
  }

  return {
    result: "Error: Agent produced no output",
    agentSessionId: input.agentSessionId || null,
    source: "empty",
  };
}

// ── Global error handler ────────────────────────────────────────
// Ensures a result file is ALWAYS written, even on unhandled errors.
function writeResult(payload) {
  try {
    writeFileSync(RESULT_PATH, JSON.stringify(payload));
  } catch (e) {
    console.error("FATAL: could not write result file:", e);
  }
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in agent runner:", err);
  currentPhase = "failed";
  markProgress("error", "uncaughtException: " + String(err?.message || err), {
    phase: "failed",
  });
  writeResult(
    selectFinalResult({
      sdkResult: sdkResultText,
      responseText,
      assistantText,
      errorText: "uncaughtException — " + String(err?.message || err),
      agentSessionId,
    })
  );
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in agent runner:", reason);
  currentPhase = "failed";
  markProgress("error", "unhandledRejection: " + String(reason), {
    phase: "failed",
  });
  writeResult(
    selectFinalResult({
      sdkResult: sdkResultText,
      responseText,
      assistantText,
      errorText: "unhandledRejection — " + String(reason),
      agentSessionId,
    })
  );
  process.exit(1);
});

const heartbeatId = setInterval(() => {
  const now = Date.now();
  log("heartbeat", "Task heartbeat", {
    phase: currentPhase,
    idleMs: now - lastProgressAt,
    runtimeMs: now - startedAt,
  });
}, HEARTBEAT_MS);
heartbeatId.unref();

const monitorId = setInterval(() => {
  const now = Date.now();
  const runtimeMs = now - startedAt;
  const idleMs = now - lastProgressAt;

  if (runtimeMs >= MAX_RUNTIME_MS) {
    failRunner(buildTimeoutMessage("runtime", runtimeMs, idleMs));
    return;
  }

  if (idleMs >= IDLE_FAILURE_MS) {
    failRunner(buildTimeoutMessage("idle", runtimeMs, idleMs));
    return;
  }

  if (idleMs >= IDLE_WARNING_MS) {
    const bucket = Math.floor(idleMs / IDLE_WARNING_MS);
    if (bucket > lastIdleWarningBucket) {
      lastIdleWarningBucket = bucket;
      log("runner_warning", "No new progress for " + formatDuration(idleMs) + ". Waiting for Claude to continue.", {
        phase: currentPhase,
        idleMs,
        runtimeMs,
      });
    }
  }
}, MONITOR_INTERVAL_MS);
monitorId.unref();

// ── Main agent execution ────────────────────────────────────────
setPhase("booting", "Sandbox task booting");

let agentSessionId = null;
let sdkResultText = null;
let responseText = "";
let assistantText = "";
let errorText = null;

try {
  const options = {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    includePartialMessages: true,
    thinking: { type: "adaptive" },
    ${resumeLine}
  };

  for await (const message of query({ prompt: ${escapedPrompt}, options })) {
    // Capture session ID from init message
    if (message.type === "system" && message.subtype === "init") {
      agentSessionId = message.session_id;
      setPhase(
        "prompting",
        ${resumeSessionId ? JSON.stringify("Claude session resumed") : JSON.stringify("Claude session initialized")},
        { sessionId: message.session_id }
      );
    }

    if (message.type === "system" && message.subtype !== "init") {
      logSdkMessage(
        "sdk_system",
        pickMessageText(
          message,
          ["message", "text"],
          "System event: " + String(message.subtype || "unknown")
        ),
        { subtype: message.subtype || null }
      );
    }

    if (message.type === "stream_event" && message.event) {
      if (
        message.event.type === "content_block_delta" &&
        message.event.delta?.type === "text_delta" &&
        message.event.delta?.text
      ) {
        responseText += message.event.delta.text;
      }
      handleStreamEvent(message.event);
    }

    if (message.type === "status") {
      logSdkMessage(
        "sdk_status",
        pickMessageText(message, ["message", "text", "status"], "SDK status update")
      );
    }

    if (message.type === "task_started") {
      logSdkMessage(
        "task_started",
        pickMessageText(message, ["message", "text", "content"], "Task started")
      );
    }

    if (message.type === "task_progress") {
      logSdkMessage(
        "task_progress",
        pickMessageText(message, ["message", "text", "content"], "Task progress update")
      );
    }

    if (message.type === "tool_progress") {
      logSdkMessage(
        "tool_progress",
        pickMessageText(message, ["message", "text", "content"], "Tool progress update")
      );
    }

    if (message.type === "tool_use_summary") {
      logSdkMessage(
        "tool_use_summary",
        pickMessageText(message, ["message", "summary", "text"], "Tool use summary")
      );
    }

    // Log and capture assistant text + tool use blocks
    if (message.type === "assistant" && message.content) {
      flushAllStreamBuffers();
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const block of blocks) {
        if (block.type === "thinking" && block.thinking && !sawThinkingDelta) {
          if (currentPhase !== "thinking") {
            setPhase("thinking", "Claude is reasoning through the task");
          }
          markProgress("thinking_delta", truncateText(block.thinking, 800), {
            phase: "thinking",
          });
        }
        if (block.type === "text" && block.text) {
          assistantText += block.text;
          if (
            currentPhase === "queued" ||
            currentPhase === "booting" ||
            currentPhase === "prompting" ||
            currentPhase === "thinking"
          ) {
            setPhase("coding", "Agent is responding");
          }
          // Truncate long text to keep log file manageable
          const text = block.text.length > 500
            ? block.text.slice(0, 500) + "..."
            : block.text;
          if (!sawResponseDelta) {
            markProgress("response_delta", block.text, { phase: "coding" });
            sawResponseDelta = true;
          }
          markProgress("assistant", text);
        }
        if (block.type === "tool_use") {
          const inputStr = typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input);
          // Show tool name + truncated input
          const preview = inputStr.length > 200
            ? inputStr.slice(0, 200) + "..."
            : inputStr;
          const toolPhase = classifyToolUse(block.name, inputStr);
          if (toolPhase.phase !== currentPhase) {
            setPhase(toolPhase.phase, toolPhase.text, {
              tool: block.name,
              input: preview,
            });
          } else {
            markProgress("tool_use", toolPhase.text, {
              phase: currentPhase,
              tool: block.name,
              input: preview,
            });
          }
        }
      }

    }

    // Log tool results
    if (message.type === "result" || ("result" in message && message.result)) {
      flushAllStreamBuffers();
      const r = message.result || "";
      sdkResultText = r;
      setPhase("complete", "Task complete");
      markProgress("result", r.length > 500 ? r.slice(0, 500) + "..." : r, {
        phase: "complete",
      });
    }

    if (
      ![
        "assistant",
        "result",
        "status",
        "stream_event",
        "system",
        "task_started",
        "task_progress",
        "tool_progress",
        "tool_use_summary",
      ].includes(message.type)
    ) {
      logSdkMessage("sdk_event", stringifyValue(message), {
        sdkType: message.type || "unknown",
      });
    }
  }
} catch (err) {
  errorText = err instanceof Error ? err.message : String(err);
  setPhase("failed", "Task failed");
  markProgress("error", coerceErrorText(errorText), { phase: "failed" });
}

clearInterval(heartbeatId);
clearInterval(monitorId);

const finalResult = selectFinalResult({
  sdkResult: sdkResultText,
  responseText,
  assistantText,
  errorText,
  agentSessionId,
});

if (finalResult.result.startsWith("Error:")) {
  if (currentPhase !== "failed") {
    setPhase("failed", "Task failed");
  }
} else if (currentPhase !== "complete") {
  setPhase("complete", "Task complete");
}

log("done", "Task complete", {
  phase: currentPhase,
  resultSource: finalResult.source,
});

writeResult(finalResult);
console.log("__AGENT_DONE__");
`;
}

/**
 * Writes the runner script to the sandbox and starts it in detached mode.
 * Returns the command ID for polling.
 */
export async function startAgentTask(
  sandbox: Sandbox,
  prompt: string,
  taskFileId: string,
  resumeSessionId: string | null,
  anthropicBaseUrl: string
): Promise<string> {
  const anthropicProxyToken = encodeAnthropicProxyToken({
    sandboxId: sandbox.sandboxId,
    taskFileId,
  });
  const script = buildRunnerScript(
    prompt,
    taskFileId,
    resumeSessionId,
    anthropicProxyToken,
    anthropicBaseUrl
  );

  // Write the runner script
  await sandbox.writeFiles([
    {
      path: `/vercel/sandbox/.task-${taskFileId}.mjs`,
      content: Buffer.from(script),
    },
  ]);

  // Start in detached mode — returns immediately with a Command object
  const command = await sandbox.runCommand({
    cmd: "node",
    args: [`/vercel/sandbox/.task-${taskFileId}.mjs`],
    detached: true,
  });

  return command.cmdId;
}

/**
 * Reads the incremental log file written by the runner script.
 *
 * Returns:
 * - The raw JSONL string if the file exists (may be empty string)
 * - null if the file doesn't exist yet (task hasn't started logging)
 * - Throws on unexpected errors (sandbox unreachable, etc.)
 */
export async function readAgentLogs(
  sandbox: Sandbox,
  taskFileId: string
): Promise<string | null> {
  try {
    const buffer = await sandbox.readFileToBuffer({
      path: `/vercel/sandbox/.log-${taskFileId}.jsonl`,
    });
    if (!buffer) return null;
    return buffer.toString("utf-8");
  } catch (err: unknown) {
    if (isMissingSandboxFileError(err)) {
      return null;
    }
    console.error("Unexpected error reading agent logs:", err);
    throw err;
  }
}

/**
 * Reads the result file written by the runner script.
 *
 * Returns:
 * - The parsed result object if the file exists and is valid JSON
 * - null if the file doesn't exist yet (task still running)
 * - Throws on unexpected errors (sandbox unreachable, JSON parse failure)
 *   so the caller can distinguish "still running" from "broken".
 */
export async function readAgentResult(
  sandbox: Sandbox,
  taskFileId: string
): Promise<AgentTaskResultPayload | null> {
  try {
    const buffer = await sandbox.readFileToBuffer({
      path: `/vercel/sandbox/.result-${taskFileId}.json`,
    });
    if (!buffer) return null;
    const parsed = JSON.parse(buffer.toString("utf-8")) as {
      result?: unknown;
      agentSessionId?: unknown;
      source?: unknown;
    };
    const result =
      typeof parsed.result === "string"
        ? parsed.result
        : "Error: Agent produced no output";
    return {
      result,
      agentSessionId:
        typeof parsed.agentSessionId === "string" ? parsed.agentSessionId : null,
      source: isAgentResultSource(parsed.source)
        ? parsed.source
        : result.startsWith("Error:")
          ? "error"
          : "assistant_blocks",
    };
  } catch (err: unknown) {
    if (isMissingSandboxFileError(err)) {
      return null;
    }
    console.error("Unexpected error reading agent result:", err);
    throw err;
  }
}

export async function readAgentCommandState(
  sandbox: Sandbox,
  cmdId: string
): Promise<AgentCommandState | null> {
  try {
    const command = await sandbox.getCommand(cmdId);
    if (command.exitCode == null) {
      return {
        exitCode: null,
        stdout: null,
        stderr: null,
      };
    }

    const [stdoutResult, stderrResult] = await Promise.allSettled([
      command.stdout(),
      command.stderr(),
    ]);

    return {
      exitCode: command.exitCode,
      stdout:
        stdoutResult.status === "fulfilled"
          ? tailCommandOutput(stdoutResult.value)
          : null,
      stderr:
        stderrResult.status === "fulfilled"
          ? tailCommandOutput(stderrResult.value)
          : null,
    };
  } catch (err: unknown) {
    if (isMissingSandboxFileError(err)) {
      return null;
    }
    console.warn("Unable to inspect detached agent command:", err);
    return null;
  }
}
