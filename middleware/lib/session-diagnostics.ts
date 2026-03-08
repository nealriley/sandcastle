import type {
  SessionOwnershipRecord,
  SessionState,
  SessionTaskRecord,
  SessionViewResponse,
} from "./types.js";

type DiagnosticLevel = "info" | "warn" | "error";

function shortId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function summarizeTask(task: SessionTaskRecord | null | undefined) {
  if (!task) {
    return null;
  }

  return {
    taskId: shortId(task.taskId),
    taskFileId: shortId(task.taskFileId),
    status: task.status,
    phase: task.phase,
    hasResult: Boolean(task.result),
    hasError: Boolean(task.error),
    lastLogAt: task.lastLogAt,
    updatedAt: task.updatedAt,
  };
}

export function summarizeSessionStateForDiagnostics(
  state: SessionState | null
) {
  if (!state) {
    return null;
  }

  const latestTask = state.tasks[state.tasks.length - 1] ?? null;
  return {
    sessionKey: shortId(state.sessionKey),
    ownerUserId: shortId(state.ownerUserId),
    runtime: state.runtime,
    taskCount: state.tasks.length,
    stoppedAt: state.stoppedAt,
    updatedAt: state.updatedAt,
    latestTask: summarizeTask(latestTask),
  };
}

export function summarizeSessionViewForDiagnostics(
  response: SessionViewResponse
) {
  return {
    sessionKey: shortId(response.sessionKey),
    sandboxId: shortId(response.sandboxId),
    status: response.status,
    phase: response.phase,
    executionStrategyKind: response.executionStrategyKind,
    currentTaskId: shortId(response.currentTaskId),
    taskCount: response.tasks.length,
    previewCount: response.previewUrls.length,
    hasError: Boolean(response.error),
    hasResult: Boolean(response.result),
    hasConsoleText: Boolean(response.consoleText.trim()),
    lastLogAt: response.lastLogAt,
    updatedAt: response.updatedAt,
  };
}

export function summarizeOwnedSessionRecordForDiagnostics(
  record: SessionOwnershipRecord | null
) {
  if (!record) {
    return null;
  }

  return {
    sessionKey: shortId(record.sessionKey),
    ownerUserId: shortId(record.ownerUserId),
    sandboxId: shortId(record.sandboxId),
    status: record.status,
    templateSlug: record.templateSlug ?? null,
    templateName: record.templateName ?? null,
    executionStrategyKind: record.executionStrategyKind ?? null,
    envKeyCount: record.envKeys?.length ?? 0,
    updatedAt: record.updatedAt,
  };
}

export function logSessionDiagnostic(args: {
  event: string;
  level?: DiagnosticLevel;
  data?: Record<string, unknown>;
}) {
  const level = args.level ?? "info";
  const payload = JSON.stringify({
    namespace: "sandcastle.session",
    ts: new Date().toISOString(),
    event: args.event,
    ...(args.data ?? {}),
  });

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.info(payload);
}
