import { buildRunnerSharedScript } from "../runner-shared";

export function buildClaudeAgentRunnerScript(
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

  return buildRunnerSharedScript({
    taskFileId,
    extraImports: `import { query } from "@anthropic-ai/claude-agent-sdk";`,
    envSetup: `
const ANTHROPIC_PROXY_TOKEN = ${JSON.stringify(anthropicProxyToken)};
const ANTHROPIC_PROXY_BASE_URL = ${JSON.stringify(anthropicBaseUrl)};
const SELECTED_ANTHROPIC_MODEL =
  typeof process.env.ANTHROPIC_MODEL === "string" &&
  process.env.ANTHROPIC_MODEL.trim()
    ? process.env.ANTHROPIC_MODEL.trim()
    : null;

// Prefer an explicit sandbox Anthropic key when present, and fall back to the
// platform proxy token only when the sandbox does not already have one.
if (
  typeof process.env.ANTHROPIC_API_KEY !== "string" ||
  !process.env.ANTHROPIC_API_KEY.trim()
) {
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_PROXY_TOKEN;
  process.env.ANTHROPIC_BASE_URL = ANTHROPIC_PROXY_BASE_URL;
} else {
  delete process.env.ANTHROPIC_BASE_URL;
}
`,
    main: `
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

const openBlocks = new Map();
let sawThinkingDelta = false;
let sawResponseDelta = false;

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

const options = {
  allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  permissionMode: "acceptEdits",
  includePartialMessages: true,
  thinking: { type: "adaptive" },
  ...(SELECTED_ANTHROPIC_MODEL ? { model: SELECTED_ANTHROPIC_MODEL } : {}),
  ${resumeLine}
};

for await (const message of query({ prompt: ${escapedPrompt}, options })) {
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
`,
  });
}
