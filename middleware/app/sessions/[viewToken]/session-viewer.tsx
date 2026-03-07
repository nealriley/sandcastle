"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type TaskStatus =
  | "accepted"
  | "running"
  | "complete"
  | "failed"
  | "stopped";

type TaskPhase =
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

type PreviewStatus = "not-ready" | "starting" | "ready";
type ViewTab = "console" | "thinking" | "response" | "activity";

interface SessionViewTask {
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

interface SessionViewPreview {
  port: number;
  url: string;
}

interface SessionLogEntry {
  ts: number;
  type: string;
  phase: TaskPhase | null;
  text: string;
  input: string | null;
  idleMs: number | null;
}

interface SessionViewResponse {
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

type FeedbackState = {
  tone: "neutral" | "danger";
  text: string;
} | null;

const POLL_INTERVAL_MS = 2500;

const phaseLabels: Record<TaskPhase, string> = {
  queued: "Queued",
  booting: "Booting sandbox",
  prompting: "Starting Claude",
  thinking: "Thinking",
  coding: "Coding",
  installing: "Installing dependencies",
  "preview-starting": "Starting preview",
  "waiting-for-input": "Waiting for input",
  stalled: "Stalled",
  complete: "Complete",
  failed: "Failed",
  stopped: "Stopped",
};

const previewLabels: Record<PreviewStatus, string> = {
  "not-ready": "Not ready",
  starting: "Starting",
  ready: "Ready",
};

function formatDateTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(ts: number | null): string {
  if (!ts) return "—";

  const totalSeconds = Math.floor((Date.now() - ts) / 1000);
  if (totalSeconds < 60) return `${Math.max(totalSeconds, 1)}s ago`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m ago`
    : `${hours}h ago`;
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "running":
      return "Running";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return "Stopped";
  }
}

function statusColor(status: TaskStatus): string {
  switch (status) {
    case "accepted":
    case "running":
      return "#2563eb";
    case "complete":
      return "#0f766e";
    case "failed":
      return "#dc2626";
    default:
      return "#475569";
  }
}

function phaseColor(phase: TaskPhase): string {
  switch (phase) {
    case "thinking":
      return "#7c3aed";
    case "preview-starting":
      return "#2563eb";
    case "complete":
      return "#0f766e";
    case "failed":
    case "stalled":
      return "#dc2626";
    default:
      return "#475569";
  }
}

function badgeStyle(color: string): CSSProperties {
  return {
    color,
    borderColor: `${color}33`,
    backgroundColor: `${color}12`,
  };
}

function truncate(value: string | null, maxLength = 120): string {
  if (!value) {
    return "—";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatEnvKeys(keys: string[] | null | undefined): string {
  if (!keys || keys.length === 0) {
    return "None";
  }

  return keys.join(", ");
}

function logTypeLabel(type: string): string {
  switch (type) {
    case "thinking_delta":
      return "Thinking";
    case "response_delta":
      return "Response";
    case "tool_input_delta":
      return "Tool input";
    case "assistant":
      return "Assistant";
    case "tool_use":
      return "Tool";
    case "sdk_status":
      return "SDK status";
    case "sdk_system":
      return "SDK system";
    case "task_progress":
      return "Task progress";
    case "tool_progress":
      return "Tool progress";
    case "runner_warning":
      return "Runner warning";
    case "error":
      return "Error";
    default:
      return type;
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${response.status}`;
}

export default function SessionViewer({ viewToken }: { viewToken: string }) {
  const [data, setData] = useState<SessionViewResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [busyAction, setBusyAction] = useState<"prompt" | "kill" | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("console");
  const consoleRef = useRef<HTMLPreElement | null>(null);

  async function loadState() {
    try {
      const response = await fetch(
        `/api/view/${encodeURIComponent(viewToken)}?_t=${Date.now()}`
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const next = (await response.json()) as SessionViewResponse;
      setData(next);
      setFetchError(null);
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Network error"
      );
    }
  }

  useEffect(() => {
    let active = true;

    async function loadIfActive() {
      if (!active) {
        return;
      }
      await loadState();
    }

    void loadIfActive();
    const interval = setInterval(() => {
      void loadIfActive();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [viewToken]);

  useEffect(() => {
    if (activeTab !== "console") {
      return;
    }

    const element = consoleRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [activeTab, data?.consoleText]);

  const focusTask = data
    ? data.currentTaskId
      ? data.tasks.find((task) => task.taskId === data.currentTaskId) ?? null
      : data.tasks[data.tasks.length - 1] ?? null
    : null;
  const recentEntries = data ? [...data.logEntries].slice(-10).reverse() : [];
  const previewReady = Boolean(data?.previewUrl);

  async function handlePromptSubmit() {
    if (!data?.sessionKey) {
      return;
    }

    const prompt = promptDraft.trim();
    if (!prompt) {
      setFeedback({
        tone: "danger",
        text: "Enter a prompt before sending it to the sandbox.",
      });
      return;
    }

    setBusyAction("prompt");
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(data.sessionKey)}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setPromptDraft("");
      setFeedback({
        tone: "neutral",
        text: `Started a new task in sandbox ${data.sandboxId}.`,
      });
      await loadState();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "Failed to send sandbox prompt.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleKill() {
    if (!data?.sessionKey) {
      return;
    }

    const confirmed = window.confirm(
      `Kill sandbox ${data.sandboxId}? This stops the sandbox immediately.`
    );
    if (!confirmed) {
      return;
    }

    setBusyAction("kill");
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(data.sessionKey)}/stop`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setFeedback({
        tone: "neutral",
        text: `Sandbox ${data.sandboxId} was stopped.`,
      });
      await loadState();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "Failed to stop sandbox.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function renderTabContent() {
    if (activeTab === "console") {
      return (
        <pre ref={consoleRef} className="console-output">
          {data?.consoleText || "Waiting for console output from the sandbox..."}
        </pre>
      );
    }

    if (activeTab === "thinking") {
      return (
        <pre className="stream-output">
          {data?.liveThinking ?? "No visible thinking stream yet."}
        </pre>
      );
    }

    if (activeTab === "response") {
      return (
        <pre className="stream-output">
          {data?.liveResponse ?? "No visible response stream yet."}
        </pre>
      );
    }

    if (recentEntries.length === 0) {
      return <div className="empty-state">No structured events yet.</div>;
    }

    return (
      <div className="activity-feed">
        {recentEntries.map((entry, index) => (
          <div key={`${entry.ts}-${entry.type}-${index}`} className="activity-item">
            <div className="activity-item__header">
              <div>
                <div className="table-note">{logTypeLabel(entry.type)}</div>
                <div className="activity-item__title">{formatTime(entry.ts)}</div>
              </div>
              {entry.phase ? (
                <Tag color={phaseColor(entry.phase)}>
                  {phaseLabels[entry.phase]}
                </Tag>
              ) : null}
            </div>
            <div className="activity-item__body">
              {entry.text || "No text payload"}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-header__copy">
          <div className="page-header__badges">
            <Tag color={statusColor(data?.status ?? "stopped")}>
              {data ? statusLabel(data.status) : "Loading"}
            </Tag>
            <Tag color={phaseColor(data?.phase ?? "queued")}>
              {data ? phaseLabels[data.phase] : "Loading phase"}
            </Tag>
          </div>
          <p className="page-kicker">Sandbox</p>
          <h1 className="page-title">{data?.sandboxId ?? "Loading sandbox"}</h1>
          <p className="page-subtitle">
            {data?.phaseDetail ?? "Waiting for the latest sandbox update."}
          </p>
        </div>

        <div className="page-header__actions">
          <a href="/sandboxes" className="button button--ghost">
            Back to sandboxes
          </a>
          {previewReady ? (
            <a
              href={data?.previewUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="button button--secondary"
            >
              Open preview
            </a>
          ) : null}
          <button
            type="button"
            className="button button--danger"
            onClick={() => void handleKill()}
            disabled={
              !data?.sessionKey ||
              data?.status === "stopped" ||
              busyAction === "kill"
            }
          >
            {busyAction === "kill" ? "Killing..." : "Kill sandbox"}
          </button>
        </div>
      </section>

      {fetchError ? <div className="alert alert--error">{fetchError}</div> : null}
      {feedback ? (
        <div
          className={
            feedback.tone === "danger"
              ? "alert alert--error"
              : "alert alert--neutral"
          }
        >
          {feedback.text}
        </div>
      ) : null}

      <div className="detail-grid">
        <section className="panel panel--console">
          <div className="panel__header panel__header--split">
            <div>
              <p className="page-kicker">Workspace</p>
              <h2 className="panel__title">Live sandbox console</h2>
            </div>
            <div className="panel-meta">
              <span>Updated {timeAgo(data?.updatedAt ?? null)}</span>
              <span>Last log {timeAgo(data?.lastLogAt ?? null)}</span>
            </div>
          </div>

          <div className="tab-bar">
            {(["console", "thinking", "response", "activity"] as ViewTab[]).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  className="tab-button"
                  data-active={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "console"
                    ? "Console"
                    : tab === "thinking"
                      ? "Thinking"
                      : tab === "response"
                        ? "Response"
                        : "Activity"}
                </button>
              )
            )}
          </div>

          {data?.error || data?.result ? (
            <div className={data.error ? "alert alert--error" : "alert alert--success"}>
              <strong>{data.error ? "Latest error" : "Latest result"}</strong>
              <div>{data.error ?? data.result}</div>
            </div>
          ) : null}

          <div className="console-shell">{renderTabContent()}</div>

          <div className="prompt-composer">
            <div className="panel__header">
              <div>
                <p className="page-kicker">Prompt</p>
                <h2 className="panel__title">Continue this sandbox</h2>
              </div>
            </div>

            <label className="form-field">
              <span className="form-label">Follow-up prompt</span>
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                placeholder={`Send a follow-up prompt to ${data?.sandboxId ?? "this sandbox"}`}
                rows={4}
                disabled={
                  !data?.sessionKey ||
                  busyAction === "prompt" ||
                  data?.status === "stopped"
                }
              />
            </label>

            <div className="page-header__actions">
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void handlePromptSubmit()}
                disabled={
                  !data?.sessionKey ||
                  busyAction === "prompt" ||
                  data?.status === "stopped"
                }
              >
                {busyAction === "prompt" ? "Sending..." : "Send prompt"}
              </button>
            </div>
          </div>
        </section>

        <aside className="side-rail">
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="page-kicker">Overview</p>
                <h2 className="panel__title">Current state</h2>
              </div>
            </div>

            <dl className="key-value-list">
              <div>
                <dt>Status</dt>
                <dd>{data ? statusLabel(data.status) : "Loading"}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>{data?.templateName ?? "Standard"}</dd>
              </div>
              <div>
                <dt>Phase</dt>
                <dd>{data ? phaseLabels[data.phase] : "Loading"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatDateTime(data?.updatedAt ?? null)}</dd>
              </div>
              <div>
                <dt>Last log</dt>
                <dd>{formatDateTime(data?.lastLogAt ?? null)}</dd>
              </div>
              <div>
                <dt>Current task</dt>
                <dd>{data?.currentTaskId ?? "No active task"}</dd>
              </div>
              <div>
                <dt>Task count</dt>
                <dd>{data ? String(data.tasks.length) : "0"}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{formatEnvKeys(data?.envKeys)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="page-kicker">Preview</p>
                <h2 className="panel__title">Endpoints</h2>
              </div>
            </div>

            {data && data.previewUrls.length > 0 ? (
              <div className="preview-list">
                {data.previewUrls.map((preview) => (
                  <a
                    key={`${preview.port}-${preview.url}`}
                    href={preview.url}
                    target="_blank"
                    rel="noreferrer"
                    className="preview-link"
                  >
                    <span className="preview-link__label">Port {preview.port}</span>
                    <span className="preview-link__value">{preview.url}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                {data?.previewHint ?? "No preview is live yet."}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="page-kicker">Latest task</p>
                <h2 className="panel__title">Most recent instruction</h2>
              </div>
            </div>

            <div className="task-summary">
              <div className="task-summary__prompt">
                {truncate(focusTask?.prompt ?? data?.latestPrompt ?? null, 180)}
              </div>
              <div className="task-summary__meta">
                {focusTask?.error ??
                  focusTask?.result ??
                  focusTask?.phaseDetail ??
                  "Waiting for the next task update."}
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="panel">
        <div className="panel__header panel__header--split">
          <div>
            <p className="page-kicker">History</p>
            <h2 className="panel__title">Task history</h2>
          </div>
          <div className="panel-meta">Most recent tasks in this sandbox</div>
        </div>

        {data && data.tasks.length > 0 ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks
                  .slice()
                  .reverse()
                  .map((task) => (
                    <tr key={task.taskId}>
                      <td className="data-table__primary">
                        <div className="table-primary">
                          {truncate(task.prompt, 120)}
                        </div>
                        <div className="table-note">{phaseLabels[task.phase]}</div>
                      </td>
                      <td>
                        <span
                          className={`status-chip status-chip--${
                            task.status === "complete"
                              ? "complete"
                              : task.status === "failed" || task.status === "stopped"
                                ? "stopped"
                                : "active"
                          }`}
                        >
                          {statusLabel(task.status)}
                        </span>
                      </td>
                      <td>{formatDateTime(task.updatedAt)}</td>
                      <td className="data-table__summary">
                        {truncate(
                          task.error ?? task.result ?? task.phaseDetail ?? "—",
                          160
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Waiting for the first recorded task.</div>
        )}
      </section>
    </div>
  );
}

function Tag(props: { color: string; children: ReactNode }) {
  return (
    <span className="tag" style={badgeStyle(props.color)}>
      {props.children}
    </span>
  );
}
