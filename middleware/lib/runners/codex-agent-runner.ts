import { buildRunnerSharedScript } from "../runner-shared";

export function buildCodexAgentRunnerScript(args: {
  prompt: string;
  taskFileId: string;
  resumeSessionId: string | null;
  sandboxRoot?: string;
}): string {
  const resumeSessionLiteral =
    args.resumeSessionId == null ? "null" : JSON.stringify(args.resumeSessionId);

  return buildRunnerSharedScript({
    taskFileId: args.taskFileId,
    sandboxRoot: args.sandboxRoot,
    extraImports: `
import { existsSync, mkdirSync, readFileSync as readFileSyncFs, writeFileSync as writeFileSyncFs } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
`,
    main: `
const OPENAI_MODULE_SPECIFIER = process.env.OPENAI_MODULE_SPECIFIER || "openai";
const OPENAI_PACKAGE_SPEC = process.env.OPENAI_PACKAGE_SPEC || "openai";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2-codex";
const RESUME_SESSION_ID = ${resumeSessionLiteral};
const MAX_TOOL_ITERATIONS = 24;
const MAX_TOOL_RESULT_CHARS = 12_000;
const DEFAULT_BASH_TIMEOUT_MS = 120_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const requireFromTask = createRequire(import.meta.url);

function sanitizeConversationId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "codex";
}

const conversationId = sanitizeConversationId(
  RESUME_SESSION_ID || "codex-" + TASK_FILE_ID
);
const CONVERSATION_PATH =
  SANDBOX_ROOT + "/.codex-conversation-" + conversationId + ".json";

function truncateToolResult(value) {
  const text = String(value || "");
  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return text;
  }
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + "\\n...truncated...";
}

function resolveSandboxPath(inputPath, cwd) {
  const baseDir = cwd ? resolve(cwd) : SANDBOX_ROOT;
  const candidate = resolve(baseDir, String(inputPath || ""));
  if (candidate === SANDBOX_ROOT || candidate.startsWith(SANDBOX_ROOT + "/")) {
    return candidate;
  }

  throw new Error("Path must stay within " + SANDBOX_ROOT + ".");
}

function displaySandboxPath(path) {
  const rel = relative(SANDBOX_ROOT, path);
  return rel ? rel : ".";
}

function persistConversation(messages) {
  writeFileSyncFs(CONVERSATION_PATH, JSON.stringify(messages, null, 2));
}

function loadConversation() {
  if (!existsSync(CONVERSATION_PATH)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSyncFs(CONVERSATION_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractAssistantText(message) {
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message?.content)) {
    return null;
  }

  const text = message.content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part?.type === "text" && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");

  return text.trim() ? text : null;
}

function parseToolArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(rawArgs);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    throw new Error(
      "Tool arguments were not valid JSON: " +
        String(error instanceof Error ? error.message : error)
    );
  }
}

function countOccurrences(haystack, needle) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = haystack.indexOf(needle, index);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    index = nextIndex + needle.length;
  }
}

function readTool(args) {
  const target = resolveSandboxPath(args.file_path || args.path, SANDBOX_ROOT);
  const content = readFileSyncFs(target, "utf8");
  const startLine =
    typeof args.start_line === "number" && Number.isInteger(args.start_line)
      ? Math.max(args.start_line, 1)
      : 1;
  const endLine =
    typeof args.end_line === "number" && Number.isInteger(args.end_line)
      ? Math.max(args.end_line, startLine)
      : null;

  const lines = content.split("\\n");
  const slice = lines.slice(startLine - 1, endLine == null ? undefined : endLine);
  const numbered = slice
    .map((line, index) => String(startLine + index).padStart(6, " ") + " | " + line)
    .join("\\n");

  return truncateToolResult(numbered || content);
}

function writeTool(args) {
  const target = resolveSandboxPath(args.file_path || args.path, SANDBOX_ROOT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSyncFs(target, String(args.content || ""), "utf8");
  return "Wrote " + displaySandboxPath(target) + ".";
}

function editTool(args) {
  const target = resolveSandboxPath(args.file_path || args.path, SANDBOX_ROOT);
  const oldString = String(args.old_string || "");
  const newString = String(args.new_string || "");
  const replaceAll = args.replace_all === true;
  const content = readFileSyncFs(target, "utf8");

  if (!oldString) {
    throw new Error("Edit requires old_string.");
  }

  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0) {
    throw new Error("old_string was not found in " + displaySandboxPath(target) + ".");
  }

  if (!replaceAll && occurrences > 1) {
    throw new Error(
      "old_string matched " + String(occurrences) + " times. Use replace_all or be more specific."
    );
  }

  const nextContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  writeFileSyncFs(target, nextContent, "utf8");
  return "Edited " + displaySandboxPath(target) + ".";
}

function bashTool(args) {
  const command = String(args.command || "");
  if (!command.trim()) {
    throw new Error("Bash requires a command.");
  }

  const cwd = args.cwd ? resolveSandboxPath(args.cwd, SANDBOX_ROOT) : SANDBOX_ROOT;
  const timeoutMs =
    typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
      ? Math.max(1_000, Math.min(args.timeout_ms, DEFAULT_BASH_TIMEOUT_MS))
      : DEFAULT_BASH_TIMEOUT_MS;
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const summary = [
    "cwd: " + displaySandboxPath(cwd),
    "exitCode: " + String(result.status == null ? -1 : result.status),
    stdout.trim() ? "stdout:\\n" + stdout.trim() : "",
    stderr.trim() ? "stderr:\\n" + stderr.trim() : "",
  ]
    .filter(Boolean)
    .join("\\n\\n");

  return truncateToolResult(summary || "Command finished.");
}

function globTool(args) {
  const cwd = args.cwd ? resolveSandboxPath(args.cwd, SANDBOX_ROOT) : SANDBOX_ROOT;
  const pattern = String(args.pattern || "").trim();
  if (!pattern) {
    throw new Error("Glob requires a pattern.");
  }

  const fullPattern =
    pattern.startsWith("/") ? resolveSandboxPath(pattern, SANDBOX_ROOT) : resolve(cwd, pattern);
  const result = spawnSync(
    "bash",
    ["-lc", 'shopt -s globstar dotglob nullglob; compgen -G "$PATTERN" || true'],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATTERN: fullPattern,
      },
    }
  );

  const matches = String(result.stdout || "")
    .split("\\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return displaySandboxPath(resolveSandboxPath(line, SANDBOX_ROOT));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return truncateToolResult(matches.length > 0 ? matches.join("\\n") : "No matches.");
}

function grepTool(args) {
  const cwd = args.cwd ? resolveSandboxPath(args.cwd, SANDBOX_ROOT) : SANDBOX_ROOT;
  const pattern = String(args.pattern || "").trim();
  if (!pattern) {
    throw new Error("Grep requires a pattern.");
  }

  const root = args.path ? resolveSandboxPath(args.path, cwd) : cwd;
  const result = spawnSync(
    "bash",
    [
      "-lc",
      'grep -RIn --binary-files=without-match -- "$PATTERN" "$SEARCH_ROOT" || true',
    ],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PATTERN: pattern,
        SEARCH_ROOT: root,
      },
    }
  );

  const output = String(result.stdout || "").trim();
  return truncateToolResult(output || "No matches.");
}

function classifyToolUse(name, args) {
  if (name === "Bash") {
    return {
      phase: "coding",
      text: "Running shell command: " + truncateText(String(args.command || ""), 80),
    };
  }

  if (name === "Read" || name === "Glob" || name === "Grep") {
    return {
      phase: "coding",
      text: "Inspecting files with " + name,
    };
  }

  return {
    phase: "coding",
    text: "Updating files with " + name,
  };
}

function executeTool(name, args) {
  switch (name) {
    case "Read":
      return readTool(args);
    case "Write":
      return writeTool(args);
    case "Edit":
      return editTool(args);
    case "Bash":
      return bashTool(args);
    case "Glob":
      return globTool(args);
    case "Grep":
      return grepTool(args);
    default:
      throw new Error("Unsupported tool: " + String(name));
  }
}

const developerPrompt = [
  "You are Codex running inside a Sandcastle sandbox.",
  "Use tools to inspect and modify files under " + SANDBOX_ROOT + " only.",
  "Prefer direct, minimal changes and keep the final answer concise.",
  "When a task is complete, respond with a short natural-language summary.",
].join("\\n");

function isMissingModuleError(error) {
  const message = String(error instanceof Error ? error.message : error);
  return (
    message.includes("Cannot find package") ||
    message.includes("Cannot find module") ||
    message.includes("ERR_MODULE_NOT_FOUND") ||
    message.includes("MODULE_NOT_FOUND")
  );
}

function installOpenAiPackage() {
  setPhase("installing", "Installing OpenAI SDK");
  markProgress("sdk_status", "Installing OpenAI SDK in sandbox", {
    phase: "installing",
    package: OPENAI_PACKAGE_SPEC,
  });

  const install = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      SANDBOX_ROOT,
      "--no-save",
      "--no-package-lock",
      "--no-fund",
      "--no-audit",
      OPENAI_PACKAGE_SPEC,
    ],
    {
      cwd: SANDBOX_ROOT,
      encoding: "utf8",
      timeout: DEFAULT_INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    }
  );

  const stdout = String(install.stdout || "").trim();
  const stderr = String(install.stderr || "").trim();

  if (stdout) {
    logSdkMessage("sdk_status", stdout, {
      phase: "installing",
      source: "npm_stdout",
    });
  }

  if (stderr) {
    logSdkMessage("sdk_status", stderr, {
      phase: "installing",
      source: "npm_stderr",
    });
  }

  if (install.status !== 0) {
    const installError =
      install.error instanceof Error ? install.error.message : "";
    throw new Error(
      "Failed to install the OpenAI SDK in this sandbox." +
        (installError ? " " + truncateText(installError, 240) : "") +
        (stderr ? " " + truncateText(stderr, 400) : "")
    );
  }
}

async function importOpenAiModule() {
  if (OPENAI_MODULE_SPECIFIER !== "openai") {
    const imported = await import(OPENAI_MODULE_SPECIFIER);
    return imported.default || imported.OpenAI;
  }

  let resolvedModulePath;
  try {
    resolvedModulePath = requireFromTask.resolve("openai");
  } catch (error) {
    if (!isMissingModuleError(error)) {
      throw error;
    }

    installOpenAiPackage();
    resolvedModulePath = requireFromTask.resolve("openai");
  }

  const imported = await import(pathToFileURL(resolvedModulePath).href);
  return imported.default || imported.OpenAI;
}

if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.trim()) {
  throw new Error("OPENAI_API_KEY is not configured in this sandbox.");
}

let OpenAI;
try {
  OpenAI = await importOpenAiModule();
} catch (error) {
  throw new Error(
    "Failed to load the OpenAI SDK for the Codex runner. (" +
      String(error instanceof Error ? error.message : error) +
      ")"
  );
}

if (typeof OpenAI !== "function") {
  throw new Error("The openai module did not export a usable client constructor.");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

const tools = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a text file inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Write",
      description: "Write a complete file inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Edit",
      description: "Replace text in an existing file inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Bash",
      description: "Run a bash command inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeout_ms: { type: "integer" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Glob",
      description: "Find files matching a glob pattern inside the sandbox.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          cwd: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Grep",
      description: "Search files inside the sandbox with grep.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          cwd: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
];

let messages = loadConversation();
if (!Array.isArray(messages) || messages.length === 0) {
  messages = [{ role: "developer", content: developerPrompt }];
}
messages.push({ role: "user", content: ${JSON.stringify(args.prompt)} });
persistConversation(messages);

agentSessionId = conversationId;
setPhase(
  "prompting",
  RESUME_SESSION_ID ? "Codex conversation resumed" : "Codex conversation initialized",
  { sessionId: conversationId }
);

for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
  setPhase("thinking", "Codex is planning the next step");
  log("sdk_status", "Calling OpenAI chat completion", {
    phase: "thinking",
    iteration: iteration + 1,
    model: OPENAI_MODEL,
  });

  const completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.2,
  });

  log("sdk_status", "OpenAI chat completion received", {
    phase: "thinking",
    iteration: iteration + 1,
    requestId: completion?._request_id || null,
  });

  const choice = completion?.choices?.[0];
  const message = choice?.message;
  if (!message) {
    throw new Error("OpenAI returned no assistant message.");
  }

  const assistantTextValue = extractAssistantText(message);
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    messages.push({
      role: "assistant",
      content: assistantTextValue,
      tool_calls: message.tool_calls,
    });
    persistConversation(messages);

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall?.function?.name || "unknown";
      const toolArgs = parseToolArgs(toolCall?.function?.arguments || "{}");
      const toolState = classifyToolUse(toolName, toolArgs);
      setPhase(toolState.phase, toolState.text, {
        tool: toolName,
        input: truncateText(stringifyValue(toolArgs), 240),
      });
      markProgress("tool_use", toolState.text, {
        phase: toolState.phase,
        tool: toolName,
        input: truncateText(stringifyValue(toolArgs), 240),
      });

      let toolResult;
      try {
        toolResult = executeTool(toolName, toolArgs);
      } catch (error) {
        toolResult =
          "Error: " +
          String(error instanceof Error ? error.message : error);
      }

      const toolResultText = truncateToolResult(toolResult);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResultText,
      });
      persistConversation(messages);
      markProgress("tool_use_summary", truncateText(toolResultText, 800), {
        phase: "coding",
        tool: toolName,
      });
    }

    continue;
  }

  if (!assistantTextValue) {
    throw new Error("Codex returned no final text response.");
  }

  setPhase("coding", "Codex is responding");
  responseText = assistantTextValue;
  sdkResultText = assistantTextValue;
  messages.push({
    role: "assistant",
    content: assistantTextValue,
  });
  persistConversation(messages);
  markProgress("response_delta", assistantTextValue, {
    phase: "coding",
  });
  markProgress("assistant", truncateText(assistantTextValue, 800), {
    phase: "coding",
  });
  break;
}

if (!sdkResultText && !responseText) {
  throw new Error(
    "Codex reached the tool iteration limit without producing a final response."
  );
}
`,
  });
}
