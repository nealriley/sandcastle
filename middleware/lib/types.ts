export type RuntimeName = "node24" | "node22" | "python3.13";

export type TaskStatus =
  | "accepted"
  | "running"
  | "complete"
  | "failed"
  | "stopped";

export type TaskPhase =
  | "queued"
  | "booting"
  | "prompting"
  | "thinking"
  | "coding"
  | "installing"
  | "preview-starting"
  | "waiting-for-input"
  | "stalled"
  | "complete"
  | "failed"
  | "stopped";

export type PreviewStatus = "not-ready" | "starting" | "ready";
export type TaskErrorCode =
  | "auth_required"
  | "invalid_auth_code"
  | "sandbox_busy"
  | "sandbox_stopped"
  | "task_not_found"
  | "task_failed";
export type TaskRecoveryAction =
  | "none"
  | "authenticate"
  | "wait"
  | "retry_prompt"
  | "check_sandbox"
  | "start_new_sandbox";
export type OwnedSandboxStatus = "active" | "stopped";
export type TemplateSourceKind = "runtime" | "snapshot";

export interface TemplateSummary {
  slug: string;
  name: string;
  summary: string;
  purpose: string;
  status: "live" | "planned";
  sourceKind: TemplateSourceKind;
  defaultRuntime: RuntimeName;
  supportedRuntimes: RuntimeName[];
  launchLabel: string;
}

export interface TemplateListResponse {
  templates: TemplateSummary[];
  defaultTemplateSlug: string;
}

/**
 * Encoded into the sessionId token. Contains everything needed
 * to reconnect to an active sandbox and resume the Claude agent session.
 */
export interface SessionToken {
  /** Stable logical session key used for ownership and browser access */
  sessionKey: string;
  /** Vercel Sandbox ID (sb_xxx) */
  sandboxId: string;
  /** Claude Agent SDK session ID (set after queries complete) */
  agentSessionId: string | null;
  /** Runtime used for this session */
  runtime: RuntimeName;
  /** Ports exposed on the sandbox */
  ports: number[];
  /** Unix timestamp when session was created */
  createdAt: number;
  /** Signed browser token for the sandbox console */
  viewToken: string;
  /** Website user who owns this session */
  ownerUserId: string;
  /** GitHub login for the owner, when known */
  ownerLogin: string | null;
}

/**
 * Encoded into the taskId token. Contains everything needed
 * to check the status of a detached command in a sandbox.
 */
export interface TaskToken {
  /** Session snapshot used for task polling and stopped-session fallback */
  session: SessionToken;
  /** Command ID from detached runCommand */
  cmdId: string;
  /** The task ID portion of the result file name */
  taskFileId: string;
  /** Unix timestamp when the task token was created */
  createdAt: number;
}

/**
 * Encoded into public browser sandbox links.
 */
export interface ViewToken {
  /** Stable logical session key */
  sessionKey: string;
  /** Vercel Sandbox ID */
  sandboxId: string;
  /** Website user who owns this session */
  ownerUserId: string;
  /** Unix timestamp when the view token was created */
  createdAt: number;
}

/**
 * Short-lived credential used only to reach the middleware Anthropic proxy.
 * This prevents the real upstream Anthropic key from ever entering the sandbox.
 */
export interface AnthropicProxyToken {
  /** Vercel Sandbox ID the task belongs to */
  sandboxId: string;
  /** Task file ID for basic auditing/scoping */
  taskFileId: string;
}

/**
 * Persisted inside the sandbox so the browser console can render
 * task history without a separate database.
 */
export interface SessionTaskRecord {
  taskId: string;
  taskFileId: string;
  cmdId: string;
  prompt: string;
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastLogAt: number | null;
  lastLogType: string | null;
  artifactsPrunedAt: number | null;
  result: string | null;
  error: string | null;
}

export interface SessionState {
  sessionKey: string;
  ownerUserId: string;
  ownerLogin: string | null;
  createdAt: number;
  updatedAt: number;
  agentSessionId: string | null;
  runtime: RuntimeName;
  ports: number[];
  stoppedAt: number | null;
  tasks: SessionTaskRecord[];
}

/**
 * Uniform response shape returned by task/session control APIs.
 * The Pack's TaskResultSchema mirrors this.
 */
export interface TaskResponse {
  taskId: string;
  sandboxId: string;
  sandboxToken: string;
  sessionId: string;
  templateSlug?: string | null;
  templateName?: string | null;
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  isComplete: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  lastLogAt: number | null;
  result: string | null;
  previewUrl: string | null;
  previewStatus: PreviewStatus;
  previewHint: string | null;
  consoleTail: string | null;
  sandboxUrl: string | null;
  logsUrl: string | null;
  sessionUrl: string | null;
  authUrl: string | null;
  errorCode: TaskErrorCode | null;
  recoveryAction: TaskRecoveryAction;
  recoveryHint: string | null;
  retryAfterMs: number | null;
  error: string | null;
}

export interface SessionViewPreview {
  port: number;
  url: string;
}

export interface SessionViewTask {
  taskId: string;
  prompt: string;
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastLogAt: number | null;
  result: string | null;
  error: string | null;
}

export interface SessionLogEntry {
  ts: number;
  type: string;
  phase: TaskPhase | null;
  text: string;
  input: string | null;
  idleMs: number | null;
}

export interface SessionViewResponse {
  sessionKey: string;
  sandboxId: string;
  sandboxUrl: string;
  templateSlug: string | null;
  templateName: string | null;
  envKeys: string[];
  status: TaskStatus;
  phase: TaskPhase;
  phaseDetail: string | null;
  currentTaskId: string | null;
  latestPrompt: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  lastLogAt: number | null;
  previewUrl: string | null;
  previewUrls: SessionViewPreview[];
  previewStatus: PreviewStatus;
  previewHint: string | null;
  result: string | null;
  error: string | null;
  consoleText: string;
  consoleTail: string | null;
  liveThinking: string | null;
  liveResponse: string | null;
  logEntries: SessionLogEntry[];
  tasks: SessionViewTask[];
}

export interface SessionOwnershipRecord {
  sessionKey: string;
  ownerUserId: string;
  ownerLogin: string | null;
  sandboxId: string;
  templateSlug?: string | null;
  templateName?: string | null;
  envKeys?: string[];
  runtime: RuntimeName;
  ports: number[];
  createdAt: number;
  updatedAt: number;
  latestViewToken: string;
  latestPrompt: string | null;
  status: OwnedSandboxStatus;
}

export interface SandboxSummary {
  sandboxId: string;
  sandboxToken: string;
  sandboxUrl: string;
  status: OwnedSandboxStatus;
  templateSlug?: string | null;
  templateName?: string | null;
  runtime: RuntimeName;
  createdAt: number;
  updatedAt: number;
  latestPrompt: string | null;
}

export interface SandboxListResponse {
  sandboxes: SandboxSummary[];
  templates?: TemplateSummary[];
  authUrl: string | null;
  errorCode: TaskErrorCode | null;
  error: string | null;
}

export interface PairingCodeRecord {
  code: string;
  userId: string;
  userLogin: string | null;
  expiresAt: number;
}

export interface PairingUserRecord {
  code: string;
  expiresAt: number;
}
