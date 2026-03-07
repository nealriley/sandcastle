/**
 * Response shapes from the middleware API.
 */

export interface TaskResponse {
  taskId: string;
  sandboxId: string;
  sandboxToken: string;
  templateSlug?: string | null;
  templateName?: string | null;
  status: "accepted" | "running" | "complete" | "failed" | "stopped";
  phase:
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
  phaseDetail: string | null;
  isComplete: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  completedAt: number | null;
  lastLogAt: number | null;
  result: string | null;
  previewUrl: string | null;
  previewStatus: "not-ready" | "starting" | "ready";
  previewHint: string | null;
  consoleTail: string | null;
  sandboxUrl: string | null;
  authUrl: string | null;
  errorCode:
    | "auth_required"
    | "invalid_auth_code"
    | "sandbox_busy"
    | "sandbox_stopped"
    | "task_not_found"
    | "task_failed"
    | null;
  recoveryAction:
    | "none"
    | "authenticate"
    | "wait"
    | "retry_prompt"
    | "check_sandbox"
    | "start_new_sandbox";
  recoveryHint: string | null;
  retryAfterMs: number | null;
  error: string | null;

  // Legacy middleware aliases that the Pack can normalize away.
  sessionId?: string | null;
  sessionUrl?: string | null;
  logsUrl?: string | null;
}

export interface SandboxSummary {
  sandboxId: string;
  sandboxToken: string;
  sandboxUrl: string;
  status: "active" | "stopped";
  templateSlug?: string | null;
  templateName?: string | null;
  runtime: "node24" | "node22" | "python3.13";
  createdAt: number;
  updatedAt: number;
  latestPrompt: string | null;
}

export interface TemplateSummary {
  slug: string;
  name: string;
  summary: string;
  purpose: string;
  status: "live" | "planned";
  sourceKind: "runtime" | "snapshot";
  defaultRuntime: "node24" | "node22" | "python3.13";
  supportedRuntimes: Array<"node24" | "node22" | "python3.13">;
  launchLabel: string;
}

export interface SandboxListResponse {
  sandboxes: SandboxSummary[];
  templates?: TemplateSummary[];
  authUrl: string | null;
  errorCode: "auth_required" | "invalid_auth_code" | null;
  error: string | null;
}

export interface TemplateListResponse {
  templates: TemplateSummary[];
  defaultTemplateSlug: string;
}
