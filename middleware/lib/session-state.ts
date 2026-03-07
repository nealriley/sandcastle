import type { Sandbox } from "@vercel/sandbox";
import {
  buildUnexpectedRunnerExitMessage,
  readAgentCommandState,
  readAgentLogs,
  readAgentResult,
} from "./agent-runner";
import { encodeSessionToken } from "./tokens";
import type {
  PreviewStatus,
  SessionLogEntry,
  SessionState,
  SessionTaskRecord,
  TaskErrorCode,
  SessionToken,
  TaskRecoveryAction,
  SessionViewPreview,
  SessionViewResponse,
  TaskPhase,
  TaskResponse,
  TaskStatus,
} from "./types.js";
import { buildSandboxUrl } from "./url";

const SESSION_STATE_PATH = "/vercel/sandbox/.shgo-session.json";
const STALLED_TASK_IDLE_MS = 90_000;
const MAX_LOG_ENTRIES = 200;
const CONSOLE_TAIL_LINE_COUNT = 20;
const BUSY_RETRY_AFTER_MS = 15_000;
const TASK_ARTIFACT_KEEP_COUNT = 1;

interface ParsedLogEntry extends SessionLogEntry {
  progressAt: number;
}

function createEmptySessionState(session: SessionToken): SessionState {
  return {
    sessionKey: session.sessionKey,
    ownerUserId: session.ownerUserId,
    ownerLogin: session.ownerLogin,
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
    agentSessionId: session.agentSessionId,
    runtime: session.runtime,
    ports: session.ports,
    stoppedAt: null,
    tasks: [],
  };
}

function inferPhaseFromStatus(status: TaskStatus): TaskPhase {
  if (status === "complete") return "complete";
  if (status === "failed") return "failed";
  if (status === "stopped") return "stopped";
  return "queued";
}

function coercePhase(value: unknown): TaskPhase | null {
  switch (value) {
    case "queued":
    case "booting":
    case "prompting":
    case "thinking":
    case "coding":
    case "installing":
    case "preview-starting":
    case "waiting-for-input":
    case "stalled":
    case "complete":
    case "failed":
    case "stopped":
      return value;
    default:
      return null;
  }
}

function normalizeTaskRecord(task: SessionTaskRecord): SessionTaskRecord {
  return {
    ...task,
    phase: coercePhase(task.phase) ?? inferPhaseFromStatus(task.status),
    phaseDetail: task.phaseDetail ?? null,
    lastLogAt: task.lastLogAt ?? null,
    lastLogType: task.lastLogType ?? null,
    artifactsPrunedAt: task.artifactsPrunedAt ?? null,
  };
}

async function writeSessionState(
  sandbox: Sandbox,
  state: SessionState
): Promise<void> {
  await sandbox.writeFiles([
    {
      path: SESSION_STATE_PATH,
      content: Buffer.from(JSON.stringify(state, null, 2)),
    },
  ]);
}

export async function readSessionState(
  sandbox: Sandbox
): Promise<SessionState | null> {
  try {
    const buffer = await sandbox.readFileToBuffer({ path: SESSION_STATE_PATH });
    if (!buffer) return null;

    const parsed = JSON.parse(buffer.toString("utf-8")) as SessionState;
    return {
      ...parsed,
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.map((task) => normalizeTaskRecord(task))
        : [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("not found") ||
      message.includes("No such file") ||
      message.includes("ENOENT")
    ) {
      return null;
    }
    throw err;
  }
}

export function makeTaskRecord(args: {
  taskId: string;
  taskFileId: string;
  cmdId: string;
  prompt: string;
}): SessionTaskRecord {
  const now = Date.now();
  return {
    taskId: args.taskId,
    taskFileId: args.taskFileId,
    cmdId: args.cmdId,
    prompt: args.prompt,
    status: "accepted",
    phase: "queued",
    phaseDetail: "Waiting for the sandbox task to start.",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastLogAt: null,
    lastLogType: null,
    artifactsPrunedAt: null,
    result: null,
    error: null,
  };
}

export async function initializeSessionState(
  sandbox: Sandbox,
  session: SessionToken,
  firstTask: SessionTaskRecord
): Promise<SessionState> {
  const state = createEmptySessionState(session);
  state.updatedAt = firstTask.updatedAt;
  state.tasks = [normalizeTaskRecord(firstTask)];
  await writeSessionState(sandbox, state);
  return state;
}

export async function appendSessionTask(
  sandbox: Sandbox,
  session: SessionToken,
  task: SessionTaskRecord
): Promise<SessionState> {
  const state =
    (await readSessionState(sandbox)) ?? createEmptySessionState(session);
  state.tasks.push(normalizeTaskRecord(task));
  state.updatedAt = task.updatedAt;
  state.stoppedAt = null;
  await writeSessionState(sandbox, state);
  return pruneSessionArtifacts(sandbox, state);
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "complete" || status === "failed" || status === "stopped";
}

function taskArtifactPaths(task: SessionTaskRecord): string[] {
  return [
    `/vercel/sandbox/.task-${task.taskFileId}.mjs`,
    `/vercel/sandbox/.log-${task.taskFileId}.jsonl`,
    `/vercel/sandbox/.result-${task.taskFileId}.json`,
  ];
}

async function pruneSessionArtifacts(
  sandbox: Sandbox,
  state: SessionState
): Promise<SessionState> {
  const keepTaskIds = new Set<string>();
  for (const task of state.tasks.slice(-TASK_ARTIFACT_KEEP_COUNT)) {
    keepTaskIds.add(task.taskId);
  }
  for (const task of state.tasks) {
    if (!isTerminalStatus(task.status)) {
      keepTaskIds.add(task.taskId);
    }
  }

  const pruneCandidates = state.tasks.filter(
    (task) =>
      task.artifactsPrunedAt == null &&
      isTerminalStatus(task.status) &&
      !keepTaskIds.has(task.taskId)
  );

  if (pruneCandidates.length === 0) {
    return state;
  }

  try {
    const cleanupCommand = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        `rm -f -- ${pruneCandidates.flatMap((task) => taskArtifactPaths(task)).join(" ")}`,
      ],
    });

    if (cleanupCommand.exitCode !== 0) {
      console.warn("Failed to prune old sandbox task artifacts.", {
        taskIds: pruneCandidates.map((task) => task.taskId),
        exitCode: cleanupCommand.exitCode,
      });
      return state;
    }
  } catch (error) {
    console.warn("Unable to prune old sandbox task artifacts.", error);
    return state;
  }

  const prunedAt = Date.now();
  const prunedTaskIds = new Set(pruneCandidates.map((task) => task.taskId));
  const nextState: SessionState = {
    ...state,
    tasks: state.tasks.map((task) =>
      prunedTaskIds.has(task.taskId)
        ? { ...task, artifactsPrunedAt: prunedAt }
        : task
    ),
  };
  await writeSessionState(sandbox, nextState);
  return nextState;
}

function inferPhaseFromLogType(type: string): TaskPhase {
  if (type === "thinking_delta") return "thinking";
  if (type === "result" || type === "done") return "complete";
  if (type === "error") return "failed";
  if (type === "start") return "booting";
  if (type === "init") return "prompting";
  return "coding";
}

function buildLiveStream(
  entries: SessionLogEntry[],
  type: "thinking_delta" | "response_delta"
): string | null {
  const text = entries
    .filter((entry) => entry.type === type)
    .map((entry) => entry.text)
    .join("");

  return text.trim() ? text : null;
}

function formatConsoleTimestamp(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

function consoleLabel(type: string): string {
  switch (type) {
    case "phase":
      return "phase";
    case "thinking_delta":
      return "thinking";
    case "response_delta":
      return "response";
    case "tool_input_delta":
      return "tool-input";
    case "assistant":
      return "assistant";
    case "tool_use":
      return "tool";
    case "sdk_status":
      return "sdk-status";
    case "sdk_system":
      return "sdk-system";
    case "task_started":
      return "task-start";
    case "task_progress":
      return "task-progress";
    case "tool_progress":
      return "tool-progress";
    case "tool_use_summary":
      return "tool-summary";
    case "runner_warning":
      return "runner-warning";
    case "result":
      return "result";
    case "error":
      return "error";
    default:
      return type;
  }
}

function isConsoleChunkType(type: string): boolean {
  return (
    type === "thinking_delta" ||
    type === "response_delta" ||
    type === "tool_input_delta"
  );
}

function buildConsoleLines(entries: SessionLogEntry[]): string[] {
  const lines: string[] = [];
  const hasResponseStream = entries.some((entry) => entry.type === "response_delta");

  let chunkBuffer:
    | {
        type: string;
        ts: number;
        text: string;
      }
    | null = null;

  function flushChunkBuffer() {
    if (!chunkBuffer) return;

    const text = chunkBuffer.text.trimEnd();
    if (text) {
      lines.push(
        `[${formatConsoleTimestamp(chunkBuffer.ts)}] ${consoleLabel(
          chunkBuffer.type
        )}: ${text}`
      );
    }

    chunkBuffer = null;
  }

  for (const entry of entries) {
    if (entry.type === "heartbeat") {
      continue;
    }

    if (entry.type === "assistant" && hasResponseStream) {
      continue;
    }

    if (isConsoleChunkType(entry.type)) {
      if (chunkBuffer && chunkBuffer.type === entry.type) {
        chunkBuffer.text += entry.text;
      } else {
        flushChunkBuffer();
        chunkBuffer = {
          type: entry.type,
          ts: entry.ts,
          text: entry.text,
        };
      }
      continue;
    }

    flushChunkBuffer();

    const body = entry.text.trim() || consoleLabel(entry.type);
    let line = `[${formatConsoleTimestamp(entry.ts)}] ${consoleLabel(
      entry.type
    )}: ${body}`;
    if (entry.input) {
      line += `\n${entry.input}`;
    }
    lines.push(line);
  }

  flushChunkBuffer();
  return lines;
}

function buildConsoleText(entries: SessionLogEntry[]): string {
  return buildConsoleLines(entries).join("\n");
}

function buildConsoleTail(consoleText: string): string | null {
  const trimmed = consoleText.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.split("\n").slice(-CONSOLE_TAIL_LINE_COUNT).join("\n");
}

function parseAgentLogEntries(rawLogs: string | null): ParsedLogEntry[] {
  if (!rawLogs) return [];

  const entries: ParsedLogEntry[] = [];
  for (const line of rawLogs.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const ts =
        typeof parsed.ts === "number" ? parsed.ts : Date.now();
      entries.push({
        ts,
        type: typeof parsed.type === "string" ? parsed.type : "log",
        phase:
          coercePhase(parsed.phase) ??
          inferPhaseFromLogType(
            typeof parsed.type === "string" ? parsed.type : "log"
          ),
        text: typeof parsed.text === "string" ? parsed.text : "",
        input: typeof parsed.input === "string" ? parsed.input : null,
        idleMs: typeof parsed.idleMs === "number" ? parsed.idleMs : null,
        progressAt:
          typeof parsed.progressAt === "number" ? parsed.progressAt : ts,
      });
    } catch {
      // Ignore malformed log lines rather than failing the full session view.
    }
  }

  return entries;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return "under 1s";

  const totalSeconds = Math.floor(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function summarizeTaskTelemetry(
  task: SessionTaskRecord,
  rawLogs: string | null
): {
  entries: SessionLogEntry[];
  lastLogAt: number | null;
  lastLogType: string | null;
  lastProgressAt: number;
  phase: TaskPhase;
  phaseDetail: string | null;
} {
  const parsed = parseAgentLogEntries(rawLogs);
  if (parsed.length === 0) {
    return {
      entries: [],
      lastLogAt: null,
      lastLogType: null,
      lastProgressAt: task.updatedAt,
      phase: task.phase,
      phaseDetail: task.phaseDetail,
    };
  }

  const lastEntry = parsed[parsed.length - 1];
  const detailSource =
    [...parsed].reverse().find((entry) => entry.type !== "heartbeat") ??
    lastEntry;
  const lastProgressAt = parsed.reduce(
    (max, entry) => Math.max(max, entry.progressAt),
    task.updatedAt
  );
  const idleMs = Date.now() - lastProgressAt;
  const lastNonTerminalPhase = detailSource.phase ?? task.phase;
  const phase =
    !isTerminalStatus(task.status) && idleMs >= STALLED_TASK_IDLE_MS
      ? "stalled"
      : lastNonTerminalPhase;

  let phaseDetail: string | null = detailSource.text || null;
  if (phase === "stalled") {
    const base = lastNonTerminalPhase === "preview-starting"
      ? "Preview startup has gone quiet."
      : "Task progress has gone quiet.";
    phaseDetail = `${base} No new progress for ${formatDuration(idleMs)}.`;
  } else if (detailSource.type === "heartbeat" && detailSource.idleMs != null) {
    phaseDetail = `Heartbeat received. Last meaningful progress was ${formatDuration(
      detailSource.idleMs
    )} ago.`;
  }

  return {
    entries: parsed.slice(-MAX_LOG_ENTRIES),
    lastLogAt: lastEntry.ts,
    lastLogType: lastEntry.type,
    lastProgressAt,
    phase,
    phaseDetail,
  };
}

export async function reconcileSessionState(
  sandbox: Sandbox,
  session: SessionToken
): Promise<SessionState> {
  const state =
    (await readSessionState(sandbox)) ?? createEmptySessionState(session);
  const previousAgentSessionId = state.agentSessionId;
  let changed = false;
  let nextAgentSessionId = state.agentSessionId;

  const nextTasks: SessionTaskRecord[] = await Promise.all(
    state.tasks.map(async (rawTask): Promise<SessionTaskRecord> => {
      const task = normalizeTaskRecord(rawTask);
      if (isTerminalStatus(task.status)) {
        return task;
      }

      const [resultData, rawLogText, commandState] = await Promise.all([
        readAgentResult(sandbox, task.taskFileId),
        readAgentLogs(sandbox, task.taskFileId),
        readAgentCommandState(sandbox, task.cmdId),
      ]);
      const telemetry = summarizeTaskTelemetry(task, rawLogText);
      let nextStatus: TaskStatus = "accepted";
      if (resultData != null) {
        nextStatus = resultData.result.startsWith("Error:")
          ? "failed"
          : "complete";
      } else if (commandState?.exitCode != null) {
        nextStatus = "failed";
      } else if (telemetry.lastLogAt != null || task.status === "running") {
        nextStatus = "running";
      }

      let nextTask: SessionTaskRecord = {
        ...task,
        status: nextStatus,
        phase: telemetry.phase,
        phaseDetail: telemetry.phaseDetail,
        updatedAt: telemetry.lastProgressAt,
        lastLogAt: telemetry.lastLogAt,
        lastLogType: telemetry.lastLogType,
      };

      if (resultData) {
        if (resultData.agentSessionId) {
          nextAgentSessionId = resultData.agentSessionId;
        }

        const completedAt = Math.max(Date.now(), telemetry.lastProgressAt);
        const failed = resultData.result.startsWith("Error:");
        nextTask = {
          ...nextTask,
          status: failed ? "failed" : "complete",
          phase: failed ? "failed" : "complete",
          phaseDetail: failed ? resultData.result : "Task complete.",
          updatedAt: completedAt,
          completedAt,
          result: failed ? null : resultData.result,
          error: failed ? resultData.result : null,
        };
      } else if (commandState?.exitCode != null) {
        const completedAt = Math.max(
          Date.now(),
          telemetry.lastProgressAt,
          telemetry.lastLogAt ?? 0
        );
        const errorMessage = buildUnexpectedRunnerExitMessage(commandState);
        nextTask = {
          ...nextTask,
          status: "failed",
          phase: "failed",
          phaseDetail: errorMessage,
          updatedAt: completedAt,
          completedAt,
          result: null,
          error: errorMessage,
        };
      }

      if (
        nextTask.status !== task.status ||
        nextTask.phase !== task.phase ||
        nextTask.phaseDetail !== task.phaseDetail ||
        nextTask.updatedAt !== task.updatedAt ||
        nextTask.completedAt !== task.completedAt ||
        nextTask.lastLogAt !== task.lastLogAt ||
        nextTask.lastLogType !== task.lastLogType ||
        nextTask.result !== task.result ||
        nextTask.error !== task.error
      ) {
        changed = true;
      }

      return nextTask;
    })
  );

  state.tasks = nextTasks;
  state.agentSessionId = nextAgentSessionId;
  state.updatedAt = nextTasks.reduce((max, task) => {
    const completedAt = task.completedAt ?? 0;
    const lastLogAt = task.lastLogAt ?? 0;
    return Math.max(max, task.updatedAt, completedAt, lastLogAt);
  }, state.createdAt);

  if (changed || nextAgentSessionId !== previousAgentSessionId) {
    await writeSessionState(sandbox, state);
  }

  return pruneSessionArtifacts(sandbox, state);
}

export function findCurrentTask(state: SessionState): SessionTaskRecord | null {
  for (let index = state.tasks.length - 1; index >= 0; index -= 1) {
    const task = state.tasks[index];
    if (!isTerminalStatus(task.status)) {
      return task;
    }
  }
  return null;
}

export function getSessionStatus(state: SessionState): TaskStatus {
  if (state.stoppedAt) {
    return "stopped";
  }
  const currentTask = findCurrentTask(state);
  if (currentTask) {
    return currentTask.status;
  }
  return state.tasks[state.tasks.length - 1]?.status ?? "stopped";
}

function getResponseTask(state: SessionState): SessionTaskRecord | null {
  return findCurrentTask(state) ?? state.tasks[state.tasks.length - 1] ?? null;
}

function getResponsePhase(task: SessionTaskRecord | null, status: TaskStatus): TaskPhase {
  if (status === "stopped") return "stopped";
  return task?.phase ?? inferPhaseFromStatus(status);
}

function getDefaultPreviewUrl(previews: SessionViewPreview[]): string | null {
  const preferred = previews.find((preview) => preview.port === 3000);
  return preferred?.url ?? previews[0]?.url ?? null;
}

function buildPreviewState(
  previews: SessionViewPreview[],
  task: SessionTaskRecord | null
): { previewStatus: PreviewStatus; previewHint: string | null } {
  if (previews.length > 0) {
    return {
      previewStatus: "ready",
      previewHint: "A preview endpoint is live and ready to open.",
    };
  }

  if (!task) {
    return {
      previewStatus: "not-ready",
      previewHint: "No preview is available for this session yet.",
    };
  }

  if (task.phase === "preview-starting") {
    return {
      previewStatus: "starting",
      previewHint: "A preview server is starting inside the sandbox.",
    };
  }

  if (task.phase === "installing") {
    return {
      previewStatus: "not-ready",
      previewHint: "Dependencies are still being installed before a preview can come up.",
    };
  }

  if (task.phase === "stalled") {
    return {
      previewStatus: "not-ready",
      previewHint: "No preview is ready, and task progress appears stalled.",
    };
  }

  if (task.phase === "failed" || task.status === "failed") {
    return {
      previewStatus: "not-ready",
      previewHint: "The task failed before a preview became ready.",
    };
  }

  if (task.status === "accepted") {
    return {
      previewStatus: "not-ready",
      previewHint: "The task has been accepted and has not started a preview yet.",
    };
  }

  return {
    previewStatus: "not-ready",
    previewHint: "No exposed preview is ready yet.",
  };
}

function inferTaskErrorCode(args: {
  status: TaskStatus;
  phase: TaskPhase;
  errorCode?: TaskErrorCode | null;
}): TaskErrorCode | null {
  if (args.errorCode) {
    return args.errorCode;
  }

  if (args.status === "stopped") {
    return "sandbox_stopped";
  }

  if (args.status === "failed") {
    return "task_failed";
  }

  return null;
}

function inferRecoveryAction(args: {
  status: TaskStatus;
  phase: TaskPhase;
  errorCode: TaskErrorCode | null;
}): TaskRecoveryAction {
  switch (args.errorCode) {
    case "auth_required":
    case "invalid_auth_code":
      return "authenticate";
    case "sandbox_busy":
      return "wait";
    case "sandbox_stopped":
      return "start_new_sandbox";
    case "task_not_found":
      return "check_sandbox";
    case "task_failed":
      return "retry_prompt";
    default:
      if (args.phase === "stalled") {
        return "wait";
      }
      return "none";
  }
}

function inferRecoveryHint(args: {
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  errorCode: TaskErrorCode | null;
}): string | null {
  switch (args.errorCode) {
    case "auth_required":
      return "Open Sandcastle Connect, sign in with GitHub, and retry with a fresh three-word connect code.";
    case "invalid_auth_code":
      return "The connect code is invalid or expired. Open Sandcastle Connect and retry with a fresh three-word code.";
    case "sandbox_busy":
      return "This sandbox is already handling another task. Wait for the current task to finish, then retry the follow-up prompt.";
    case "sandbox_stopped":
      return "This sandbox has ended and cannot accept more work. Start a new sandbox or resume another active sandbox.";
    case "task_not_found":
      return "This task token no longer maps to a task in the sandbox. Check the current sandbox status or send another prompt.";
    case "task_failed":
      return "The latest task failed. Review the console output and retry with another prompt if you want to continue in this sandbox.";
    default:
      if (args.phase === "stalled") {
        return args.phaseDetail
          ? `${args.phaseDetail} Wait a bit longer or inspect the sandbox console before retrying.`
          : "The sandbox has gone quiet. Wait a bit longer or inspect the sandbox console before retrying.";
      }
      return null;
  }
}

function inferRetryAfterMs(args: {
  phase: TaskPhase;
  errorCode: TaskErrorCode | null;
}): number | null {
  if (args.errorCode === "sandbox_busy") {
    return BUSY_RETRY_AFTER_MS;
  }

  if (args.phase === "stalled") {
    return BUSY_RETRY_AFTER_MS;
  }

  return null;
}

function withRecoveryGuidance(
  response: TaskResponse,
  overrides: Partial<
    Pick<
      TaskResponse,
      "errorCode" | "error" | "recoveryAction" | "recoveryHint" | "retryAfterMs"
    >
  > = {}
): TaskResponse {
  const errorCode = inferTaskErrorCode({
    status: response.status,
    phase: response.phase,
    errorCode: overrides.errorCode ?? response.errorCode,
  });
  const recoveryAction =
    overrides.recoveryAction ??
    inferRecoveryAction({
      status: response.status,
      phase: response.phase,
      errorCode,
    });
  const recoveryHint =
    overrides.recoveryHint ??
    inferRecoveryHint({
      status: response.status,
      phase: response.phase,
      phaseDetail: response.phaseDetail,
      errorCode,
    });
  const retryAfterMs =
    overrides.retryAfterMs ??
    inferRetryAfterMs({
      phase: response.phase,
      errorCode,
    });

  return {
    ...response,
    errorCode,
    recoveryAction,
    recoveryHint,
    retryAfterMs,
    error: overrides.error ?? response.error,
  };
}

export function buildStoppedTaskResponse(
  req: Request,
  session: SessionToken,
  taskId: string
): TaskResponse {
  const sandboxUrl = buildSandboxUrl(req, session.viewToken);
  return withRecoveryGuidance({
    taskId,
    sandboxId: session.sandboxId,
    sandboxToken: encodeSessionToken(session),
    sessionId: encodeSessionToken(session),
    status: "stopped",
    phase: "stopped",
    phaseDetail: "Session is no longer available.",
    isComplete: true,
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
    completedAt: session.createdAt,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: "Session is no longer available.",
    consoleTail: null,
    sandboxUrl,
    logsUrl: sandboxUrl,
    sessionUrl: sandboxUrl,
    authUrl: null,
    errorCode: "sandbox_stopped",
    recoveryAction: "start_new_sandbox",
    recoveryHint:
      "This sandbox is no longer available. Start a new sandbox if you want to retry the work.",
    retryAfterMs: null,
    error: "Session is no longer available.",
  });
}

export function buildStoppedSessionResponse(
  req: Request,
  session: SessionToken
): TaskResponse {
  const sandboxUrl = buildSandboxUrl(req, session.viewToken);
  return withRecoveryGuidance({
    taskId: "",
    sandboxId: session.sandboxId,
    sandboxToken: encodeSessionToken(session),
    sessionId: encodeSessionToken(session),
    status: "stopped",
    phase: "stopped",
    phaseDetail: "Session is no longer available.",
    isComplete: true,
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
    completedAt: session.createdAt,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: "Session is no longer available.",
    consoleTail: null,
    sandboxUrl,
    logsUrl: sandboxUrl,
    sessionUrl: sandboxUrl,
    authUrl: null,
    errorCode: "sandbox_stopped",
    recoveryAction: "start_new_sandbox",
    recoveryHint:
      "This sandbox is no longer available. Start a new sandbox if you want to retry the work.",
    retryAfterMs: null,
    error: "Session is no longer available.",
  });
}

export async function buildPreviewUrls(
  sandbox: Sandbox,
  ports: number[]
): Promise<SessionViewPreview[]> {
  const previews: SessionViewPreview[] = [];

  for (const port of ports) {
    try {
      previews.push({
        port,
        url: sandbox.domain(port),
      });
    } catch {
      // The port may not have a running service yet.
    }
  }

  return previews;
}

export function refreshedSessionToken(
  session: SessionToken,
  state: SessionState
): string {
  return encodeSessionToken({
    ...session,
    agentSessionId: state.agentSessionId,
  });
}

export async function buildTaskResponse(
  req: Request,
  sandbox: Sandbox,
  session: SessionToken,
  taskId: string
): Promise<TaskResponse> {
  const state = await reconcileSessionState(sandbox, session);
  const task = state.tasks.find((item) => item.taskId === taskId) ?? null;
  const previews = await buildPreviewUrls(sandbox, state.ports);
  const sandboxUrl = buildSandboxUrl(req, session.viewToken);
  const responseTask = task ?? getResponseTask(state);
  const status = task?.status ?? (task == null ? "failed" : getSessionStatus(state));
  const phase = task ? getResponsePhase(task, status) : "failed";
  const previewState = buildPreviewState(previews, responseTask);
  const telemetry =
    responseTask != null
      ? summarizeTaskTelemetry(
          responseTask,
          await readAgentLogs(sandbox, responseTask.taskFileId)
        )
      : null;
  const consoleText = telemetry ? buildConsoleText(telemetry.entries) : "";

  return withRecoveryGuidance({
    taskId,
    sandboxId: session.sandboxId,
    sandboxToken: refreshedSessionToken(session, state),
    sessionId: refreshedSessionToken(session, state),
    status,
    phase,
    phaseDetail:
      task?.phaseDetail ??
      (task == null
        ? "The requested task is no longer present in this sandbox."
        : null),
    isComplete: isTerminalStatus(status),
    createdAt: task?.createdAt ?? null,
    updatedAt: task?.updatedAt ?? responseTask?.updatedAt ?? null,
    completedAt: task?.completedAt ?? null,
    lastLogAt: task?.lastLogAt ?? responseTask?.lastLogAt ?? null,
    result: task?.result ?? null,
    previewUrl: getDefaultPreviewUrl(previews),
    previewStatus: previewState.previewStatus,
    previewHint: previewState.previewHint,
    consoleTail: buildConsoleTail(consoleText),
    sandboxUrl,
    logsUrl: sandboxUrl,
    sessionUrl: sandboxUrl,
    authUrl: null,
    errorCode: task == null ? "task_not_found" : null,
    recoveryAction: "none",
    recoveryHint: null,
    retryAfterMs: null,
    error:
      task?.error ??
      (task == null
        ? `Task ${taskId} is no longer present in this sandbox.`
        : null),
  });
}

export async function buildSessionStatusResponse(
  req: Request,
  sandbox: Sandbox,
  session: SessionToken
): Promise<TaskResponse> {
  const state = await reconcileSessionState(sandbox, session);
  const task = getResponseTask(state);
  const previews = await buildPreviewUrls(sandbox, state.ports);
  const sandboxUrl = buildSandboxUrl(req, session.viewToken);
  const status = getSessionStatus(state);
  const phase = getResponsePhase(task, status);
  const previewState = buildPreviewState(previews, task);
  const telemetry =
    task != null
      ? summarizeTaskTelemetry(
          task,
          await readAgentLogs(sandbox, task.taskFileId)
        )
      : null;
  const consoleText = telemetry ? buildConsoleText(telemetry.entries) : "";

  return withRecoveryGuidance({
    taskId: task?.taskId ?? "",
    sandboxId: session.sandboxId,
    sandboxToken: refreshedSessionToken(session, state),
    sessionId: refreshedSessionToken(session, state),
    status,
    phase,
    phaseDetail: task?.phaseDetail ?? null,
    isComplete: isTerminalStatus(status),
    createdAt: task?.createdAt ?? null,
    updatedAt: task?.updatedAt ?? null,
    completedAt: task?.completedAt ?? null,
    lastLogAt: task?.lastLogAt ?? null,
    result: task?.result ?? null,
    previewUrl: getDefaultPreviewUrl(previews),
    previewStatus: previewState.previewStatus,
    previewHint: previewState.previewHint,
    consoleTail: buildConsoleTail(consoleText),
    sandboxUrl,
    logsUrl: sandboxUrl,
    sessionUrl: sandboxUrl,
    authUrl: null,
    errorCode: null,
    recoveryAction: "none",
    recoveryHint: null,
    retryAfterMs: null,
    error: task?.error ?? null,
  });
}

export async function buildBusySessionResponse(
  req: Request,
  sandbox: Sandbox,
  session: SessionToken
): Promise<TaskResponse> {
  const response = await buildSessionStatusResponse(req, sandbox, session);
  return withRecoveryGuidance(
    {
      ...response,
      error:
        response.error ??
        "This sandbox is already handling another task.",
    },
    {
      errorCode: "sandbox_busy",
      recoveryAction: "wait",
      recoveryHint:
        "This sandbox is already handling another task. Wait for it to finish, then retry the follow-up prompt.",
      retryAfterMs: BUSY_RETRY_AFTER_MS,
    }
  );
}

export async function buildSessionView(
  req: Request,
  sandbox: Sandbox,
  session: SessionToken
): Promise<SessionViewResponse> {
  const state = await reconcileSessionState(sandbox, session);
  const currentTask = findCurrentTask(state);
  const latestTask = state.tasks[state.tasks.length - 1] ?? null;
  const responseTask = currentTask ?? latestTask;
  const previews = await buildPreviewUrls(sandbox, state.ports);
  const rawLogs = responseTask
    ? await readAgentLogs(sandbox, responseTask.taskFileId)
    : null;
  const telemetry = responseTask
    ? summarizeTaskTelemetry(responseTask, rawLogs)
    : null;
  const status = getSessionStatus(state);
  const phase = getResponsePhase(responseTask, status);
  const previewState = buildPreviewState(previews, responseTask);
  const consoleText = telemetry ? buildConsoleText(telemetry.entries) : "";

  return {
    sessionKey: session.sessionKey,
    sandboxId: session.sandboxId,
    sandboxUrl: buildSandboxUrl(req, session.viewToken),
    templateSlug: null,
    templateName: null,
    envKeys: [],
    status,
    phase,
    phaseDetail: responseTask?.phaseDetail ?? null,
    currentTaskId: currentTask?.taskId ?? null,
    latestPrompt: latestTask?.prompt ?? null,
    createdAt: responseTask?.createdAt ?? null,
    updatedAt: responseTask?.updatedAt ?? null,
    lastLogAt: responseTask?.lastLogAt ?? telemetry?.lastLogAt ?? null,
    previewUrl: getDefaultPreviewUrl(previews),
    previewUrls: previews,
    previewStatus: previewState.previewStatus,
    previewHint: previewState.previewHint,
    result: latestTask?.result ?? null,
    error: latestTask?.error ?? null,
    consoleText,
    consoleTail: buildConsoleTail(consoleText),
    liveThinking: telemetry ? buildLiveStream(telemetry.entries, "thinking_delta") : null,
    liveResponse: telemetry ? buildLiveStream(telemetry.entries, "response_delta") : null,
    logEntries: telemetry?.entries ?? [],
    tasks: state.tasks.map((task) => ({
      taskId: task.taskId,
      prompt: task.prompt,
      status: task.status,
      phase: task.phase,
      phaseDetail: task.phaseDetail,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      lastLogAt: task.lastLogAt,
      result: task.result,
      error: task.error,
    })),
  };
}
