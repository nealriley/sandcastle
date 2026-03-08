"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readError } from "@/lib/fetch-utils";
import {
  StatusBadge,
  statusToVariant,
  PhaseBadge,
  phaseToVariant,
} from "@/app/components/status-badge";

/* ─── Types ─────────────────────────────────────────────────────────── */

type TaskStatus = "accepted" | "running" | "complete" | "failed" | "stopped";

type TaskPhase =
  | "queued" | "booting" | "prompting" | "thinking" | "coding"
  | "installing" | "preview-starting" | "waiting-for-input"
  | "stalled" | "complete" | "failed" | "stopped";

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
  executionStrategyKind: "claude-agent" | "codex-agent" | "shell-command" | null;
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
  previewStatus: "not-ready" | "starting" | "ready";
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

/* ─── Helpers ───────────────────────────────────────────────────────── */

const POLL_MS = 2500;

const phaseLabels: Record<TaskPhase, string> = {
  queued: "Queued",
  booting: "Booting",
  prompting: "Starting agent",
  thinking: "Thinking",
  coding: "Coding",
  installing: "Installing deps",
  "preview-starting": "Starting preview",
  "waiting-for-input": "Waiting for input",
  stalled: "Stalled",
  complete: "Complete",
  failed: "Failed",
  stopped: "Stopped",
};

function statusLabel(s: TaskStatus): string {
  return { accepted: "Accepted", running: "Running", complete: "Complete", failed: "Failed", stopped: "Stopped" }[s];
}

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${Math.max(s, 1)}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function formatDuration(startMs: number | null): string {
  if (!startMs) return "\u2014";
  const s = Math.floor((Date.now() - startMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function truncate(v: string | null, n = 120): string {
  if (!v) return "\u2014";
  return v.length > n ? `${v.slice(0, n - 3)}\u2026` : v;
}

function logTypeLabel(type: string): string {
  const map: Record<string, string> = {
    thinking_delta: "think", response_delta: "resp", tool_input_delta: "input",
    assistant: "asst", tool_use: "tool", sdk_status: "sdk", sdk_system: "sys",
    task_progress: "task", tool_progress: "tool", runner_warning: "warn", error: "err",
  };
  return map[type] ?? type;
}

function isAlive(s?: TaskStatus): boolean {
  return s === "accepted" || s === "running";
}

function dotVariant(s: TaskStatus): string {
  if (isAlive(s)) return "active";
  if (s === "complete") return "complete";
  if (s === "failed") return "error";
  return "idle";
}

function phaseIcon(phase: TaskPhase): string {
  switch (phase) {
    case "thinking": return "\u25C6";
    case "coding": return "\u27E8\u27E9";
    case "installing": return "\u2193";
    case "preview-starting": return "\u25CE";
    case "waiting-for-input": return "\u23F8";
    case "complete": return "\u2713";
    case "failed": return "\u2715";
    case "stopped": return "\u25A0";
    default: return "\u25CF";
  }
}

function getPhaseColor(phase?: TaskPhase): string {
  switch (phase) {
    case "thinking": return "#bc8cff";
    case "coding": return "#58a6ff";
    case "installing": return "#d29922";
    case "preview-starting": case "waiting-for-input": return "#58a6ff";
    case "complete": return "#3fb950";
    case "failed": case "stalled": return "#f85149";
    case "stopped": return "#6e7681";
    default: return "#58a6ff";
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function asPreviewArray(value: unknown): SessionViewPreview[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const port = (item as { port?: unknown }).port;
    const url = (item as { url?: unknown }).url;
    if (typeof port !== "number" || typeof url !== "string") {
      return [];
    }

    return [{ port, url }];
  });
}

function asLogEntryArray(value: unknown): SessionLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const entry = item as Record<string, unknown>;
    if (
      typeof entry.ts !== "number" ||
      typeof entry.type !== "string" ||
      typeof entry.text !== "string"
    ) {
      return [];
    }

    return [
      {
        ts: entry.ts,
        type: entry.type,
        phase:
          entry.phase === "queued" ||
          entry.phase === "booting" ||
          entry.phase === "prompting" ||
          entry.phase === "thinking" ||
          entry.phase === "coding" ||
          entry.phase === "installing" ||
          entry.phase === "preview-starting" ||
          entry.phase === "waiting-for-input" ||
          entry.phase === "stalled" ||
          entry.phase === "complete" ||
          entry.phase === "failed" ||
          entry.phase === "stopped"
            ? entry.phase
            : null,
        input: typeof entry.input === "string" ? entry.input : null,
        idleMs: typeof entry.idleMs === "number" ? entry.idleMs : null,
        text: entry.text,
      },
    ];
  });
}

function asTaskArray(value: unknown): SessionViewTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const task = item as Record<string, unknown>;
    if (
      typeof task.taskId !== "string" ||
      typeof task.prompt !== "string" ||
      typeof task.createdAt !== "number" ||
      typeof task.updatedAt !== "number"
    ) {
      return [];
    }

    const status =
      task.status === "accepted" ||
      task.status === "running" ||
      task.status === "complete" ||
      task.status === "failed" ||
      task.status === "stopped"
        ? task.status
        : "failed";
    const phase =
      task.phase === "queued" ||
      task.phase === "booting" ||
      task.phase === "prompting" ||
      task.phase === "thinking" ||
      task.phase === "coding" ||
      task.phase === "installing" ||
      task.phase === "preview-starting" ||
      task.phase === "waiting-for-input" ||
      task.phase === "stalled" ||
      task.phase === "complete" ||
      task.phase === "failed" ||
      task.phase === "stopped"
        ? task.phase
        : "failed";

    return [
      {
        taskId: task.taskId,
        prompt: task.prompt,
        status,
        phase,
        phaseDetail: typeof task.phaseDetail === "string" ? task.phaseDetail : null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt:
          typeof task.completedAt === "number" ? task.completedAt : null,
        lastLogAt: typeof task.lastLogAt === "number" ? task.lastLogAt : null,
        result: typeof task.result === "string" ? task.result : null,
        error: typeof task.error === "string" ? task.error : null,
      },
    ];
  });
}

function normalizeSessionViewResponse(raw: unknown): SessionViewResponse {
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const status =
    data.status === "accepted" ||
    data.status === "running" ||
    data.status === "complete" ||
    data.status === "failed" ||
    data.status === "stopped"
      ? data.status
      : "failed";
  const phase =
    data.phase === "queued" ||
    data.phase === "booting" ||
    data.phase === "prompting" ||
    data.phase === "thinking" ||
    data.phase === "coding" ||
    data.phase === "installing" ||
    data.phase === "preview-starting" ||
    data.phase === "waiting-for-input" ||
    data.phase === "stalled" ||
    data.phase === "complete" ||
    data.phase === "failed" ||
    data.phase === "stopped"
      ? data.phase
      : "failed";

  return {
    sessionKey: typeof data.sessionKey === "string" ? data.sessionKey : "",
    sandboxId: typeof data.sandboxId === "string" ? data.sandboxId : "",
    sandboxUrl: typeof data.sandboxUrl === "string" ? data.sandboxUrl : "",
    templateSlug: typeof data.templateSlug === "string" ? data.templateSlug : null,
    templateName: typeof data.templateName === "string" ? data.templateName : null,
    executionStrategyKind:
      data.executionStrategyKind === "claude-agent" ||
      data.executionStrategyKind === "codex-agent" ||
      data.executionStrategyKind === "shell-command"
        ? data.executionStrategyKind
        : null,
    envKeys: asStringArray(data.envKeys),
    status,
    phase,
    phaseDetail: typeof data.phaseDetail === "string" ? data.phaseDetail : null,
    currentTaskId: typeof data.currentTaskId === "string" ? data.currentTaskId : null,
    latestPrompt: typeof data.latestPrompt === "string" ? data.latestPrompt : null,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : null,
    lastLogAt: typeof data.lastLogAt === "number" ? data.lastLogAt : null,
    previewUrl: typeof data.previewUrl === "string" ? data.previewUrl : null,
    previewUrls: asPreviewArray(data.previewUrls),
    previewStatus:
      data.previewStatus === "ready" ||
      data.previewStatus === "starting" ||
      data.previewStatus === "not-ready"
        ? data.previewStatus
        : "not-ready",
    previewHint: typeof data.previewHint === "string" ? data.previewHint : null,
    result: typeof data.result === "string" ? data.result : null,
    error: typeof data.error === "string" ? data.error : null,
    consoleText: typeof data.consoleText === "string" ? data.consoleText : "",
    consoleTail: typeof data.consoleTail === "string" ? data.consoleTail : null,
    liveThinking: typeof data.liveThinking === "string" ? data.liveThinking : null,
    liveResponse: typeof data.liveResponse === "string" ? data.liveResponse : null,
    logEntries: asLogEntryArray(data.logEntries),
    tasks: asTaskArray(data.tasks),
  };
}

/* ─── Component ─────────────────────────────────────────────────────── */

export default function SessionViewer({ viewToken }: { viewToken: string }) {
  const [data, setData] = useState<SessionViewResponse | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [tab, setTab] = useState<ViewTab>("console");
  const [killing, setKilling] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [promptFb, setPromptFb] = useState<{ err: boolean; text: string } | null>(null);

  const consoleRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /* ── Polling ── */
  const loadState = useCallback(async () => {
    try {
      const r = await fetch(`/api/view/${encodeURIComponent(viewToken)}?_t=${Date.now()}`);
      if (!r.ok) throw new Error(await readError(r));
      setData(normalizeSessionViewResponse(await r.json()));
      setFetchErr(null);
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : "Network error");
    }
  }, [viewToken]);

  useEffect(() => {
    let active = true;
    const poll = () => { if (active) void loadState(); };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [loadState]);

  /* Duration ticker — re-renders every second while session is alive */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!data?.createdAt || !isAlive(data.status)) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [data?.createdAt, data?.status]);

  /* Auto-scroll console */
  useEffect(() => {
    if (tab !== "console") return;
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab, data?.consoleText]);

  /* Auto-resize textarea */
  function handleDraftChange(value: string) {
    setDraft(value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
    }
  }

  /* ── Actions ── */
  async function handleKill() {
    if (!data?.sessionKey) return;
    if (!window.confirm(`Stop sandbox ${data.sandboxId}?`)) return;
    setKilling(true);
    try {
      const r = await fetch(`/api/sandboxes/${encodeURIComponent(data.sessionKey)}/stop`, { method: "POST" });
      if (!r.ok) throw new Error(await readError(r));
      await loadState();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      setKilling(false);
    }
  }

  async function handleSend() {
    const prompt = draft.trim();
    if (!prompt || !data?.sessionKey) {
      setPromptFb({ err: true, text: "Enter a prompt first." });
      return;
    }
    setSending(true);
    setPromptFb(null);
    try {
      const r = await fetch(`/api/sandboxes/${encodeURIComponent(data.sessionKey)}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) throw new Error(await readError(r));
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setPromptFb({ err: false, text: "Task started." });
      await loadState();
    } catch (e) {
      setPromptFb({ err: true, text: e instanceof Error ? e.message : "Send failed." });
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  /* ── Derived ── */
  const alive = isAlive(data?.status);
  const acceptsFollowUps = data?.executionStrategyKind !== "shell-command";
  const recentEntries = data ? [...data.logEntries].slice(-20).reverse() : [];

  /* ── Console content renderer ── */
  function renderConsoleContent() {
    if (tab === "console") {
      const hasContent = Boolean(data?.consoleText);
      return (
        <div className={`sv-pane ${hasContent ? "" : "sv-pane--empty"}`}>
          <pre ref={consoleRef}>
            {data?.consoleText || "Waiting for console output\u2026"}
          </pre>
        </div>
      );
    }

    if (tab === "thinking") {
      const has = Boolean(data?.liveThinking);
      return (
        <div className={`sv-pane ${has ? "" : "sv-pane--empty"}`}>
          <pre>{data?.liveThinking ?? "No thinking stream yet."}</pre>
        </div>
      );
    }

    if (tab === "response") {
      const has = Boolean(data?.liveResponse);
      return (
        <div className={`sv-pane ${has ? "" : "sv-pane--empty"}`}>
          <pre>{data?.liveResponse ?? "No response stream yet."}</pre>
        </div>
      );
    }

    /* Activity */
    if (recentEntries.length === 0) {
      return (
        <div className="sv-pane sv-pane--empty">
          <pre>No structured events yet.</pre>
        </div>
      );
    }

    return (
      <div className="sv-feed">
        {recentEntries.map((e, i) => (
          <div key={`${e.ts}-${i}`} className="sv-feed__row">
            <span className="sv-feed__time">{fmtTime(e.ts)}</span>
            <span className={`sv-feed__type sv-feed__type--${e.type.replace(/_/g, "-")}`}>{logTypeLabel(e.type)}</span>
            <span className="sv-feed__text">{e.text || "\u2014"}</span>
            {e.phase && <span className="sv-feed__phase">{phaseLabels[e.phase]}</span>}
          </div>
        ))}
      </div>
    );
  }

  /* ── Main render ── */
  return (
    <div
      className="sv"
      style={{ "--sv-phase-color": getPhaseColor(data?.phase) } as React.CSSProperties}
    >
      {/* ── Phase accent bar (rendered via ::before in CSS) ── */}

      {/* ── Header ── */}
      <header className="sv-header">
        <div className="sv-header__left">
          <a href="/dashboard" className="sv-back" title="Back to Dashboard">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
          </a>
          <div className="sv-header__identity">
            <span className={`sv-dot sv-dot--${data ? dotVariant(data.status) : "idle"}`} />
            <h1 className="sv-header__id">{data?.sandboxId ?? "Loading\u2026"}</h1>
          </div>
          {data?.templateName && (
            <>
              <span className="sv-header__sep" />
              <span className="sv-header__template">{data.templateName}</span>
            </>
          )}
        </div>

        <div className="sv-header__right">
          {data && (
            <div className={`sv-phase sv-phase--${phaseToVariant(data.phase)}`}>
              <span className="sv-phase__icon">{phaseIcon(data.phase)}</span>
              <span className="sv-phase__label">{phaseLabels[data.phase]}</span>
              {data.phaseDetail && (
                <span className="sv-phase__detail">{data.phaseDetail}</span>
              )}
            </div>
          )}

          {data && data.previewUrls.length > 0 && (
            <div className="sv-header__previews">
              {data.previewUrls.map((p) => (
                <a
                  key={`${p.port}-${p.url}`}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="sv-pill"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2h8v8M14 2L6 10" />
                  </svg>
                  :{p.port}
                </a>
              ))}
            </div>
          )}

          {alive && (
            <button
              type="button"
              className="sv-btn sv-btn--stop"
              onClick={() => void handleKill()}
              disabled={killing}
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="2" />
              </svg>
              {killing ? "Stopping\u2026" : "Stop"}
            </button>
          )}
        </div>
      </header>

      {/* ── Fetch error ── */}
      {fetchErr && <div className="sv-alert">{fetchErr}</div>}

      {/* ── Body: Console + Sidebar ── */}
      <div className="sv-body">
        {/* Console workspace */}
        <div className="sv-console">
          <div className="sv-tabs">
            {(["console", "thinking", "response", "activity"] as ViewTab[]).map((t) => (
              <button
                key={t}
                type="button"
                className="sv-tabs__btn"
                data-active={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "console" && alive && <span className="sv-tabs__live" />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
            <div className="sv-tabs__meta">
              {data?.lastLogAt && <span>Last log {timeAgo(data.lastLogAt)}</span>}
            </div>
          </div>

          {renderConsoleContent()}

          {/* Result / error banner */}
          {data?.error && (
            <div className="sv-banner sv-banner--error">
              <span className="sv-banner__icon">{"\u2715"}</span>
              <div>
                <strong className="sv-banner__label">Error</strong>
                <p className="sv-banner__text">{data.error}</p>
              </div>
            </div>
          )}
          {data?.result && !data.error && (
            <div className="sv-banner sv-banner--success">
              <span className="sv-banner__icon">{"\u2713"}</span>
              <div>
                <strong className="sv-banner__label">Result</strong>
                <p className="sv-banner__text">{data.result}</p>
              </div>
            </div>
          )}

          {/* Prompt input */}
          {data?.sessionKey && alive && acceptsFollowUps && (
            <div className="sv-input">
              <span className="sv-input__chevron">&gt;</span>
              <textarea
                ref={textareaRef}
                className="sv-input__field"
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a follow-up\u2026"
                rows={1}
                disabled={sending}
              />
              <button
                type="button"
                className="sv-input__send"
                onClick={() => void handleSend()}
                disabled={sending || !draft.trim()}
                title="Send (Enter)"
              >
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3.105 2.29a.75.75 0 0 1 .814-.12l13.5 6.75a.75.75 0 0 1 0 1.341l-13.5 6.75a.75.75 0 0 1-1.064-.843L4.38 10.5H9.75a.75.75 0 0 0 0-1.5H4.38L2.855 3.233a.75.75 0 0 1 .25-.943Z" />
                </svg>
              </button>
            </div>
          )}
          {data?.sessionKey && alive && !acceptsFollowUps && (
            <div className="sv-input__fb">
              This template runs a fixed shell command and does not accept follow-up prompts.
            </div>
          )}
          {promptFb && (
            <div className={`sv-input__fb ${promptFb.err ? "sv-input__fb--err" : ""}`}>
              {promptFb.text}
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <aside className="sv-aside">
          {/* Session details */}
          <section className="sv-aside__section">
            <h3 className="sv-aside__heading">Session</h3>
            <dl className="sv-meta">
              <div className="sv-meta__row">
                <dt>Status</dt>
                <dd>
                  {data ? (
                    <StatusBadge variant={statusToVariant(data.status)} pulse={alive}>
                      {statusLabel(data.status)}
                    </StatusBadge>
                  ) : "\u2014"}
                </dd>
              </div>
              <div className="sv-meta__row">
                <dt>Phase</dt>
                <dd>
                  {data ? (
                    <PhaseBadge phase={phaseToVariant(data.phase)}>
                      {phaseLabels[data.phase]}
                    </PhaseBadge>
                  ) : "\u2014"}
                </dd>
              </div>
              <div className="sv-meta__row">
                <dt>Template</dt>
                <dd>{data?.templateName ?? "Unknown"}</dd>
              </div>
              <div className="sv-meta__row">
                <dt>Sandbox</dt>
                <dd className="sv-meta__mono">{data?.sandboxId ?? "\u2014"}</dd>
              </div>
              <div className="sv-meta__row">
                <dt>Created</dt>
                <dd>{data?.createdAt ? timeAgo(data.createdAt) : "\u2014"}</dd>
              </div>
              <div className="sv-meta__row">
                <dt>Duration</dt>
                <dd className="sv-meta__mono">{formatDuration(data?.createdAt ?? null)}</dd>
              </div>
              <div className="sv-meta__row">
                <dt>Last activity</dt>
                <dd>{data?.lastLogAt ? timeAgo(data.lastLogAt) : "\u2014"}</dd>
              </div>
              {data && data.envKeys.length > 0 && (
                <div className="sv-meta__row sv-meta__row--wrap">
                  <dt>Environment</dt>
                  <dd>
                    <div className="sv-env-tags">
                      {data.envKeys.map((k) => (
                        <span key={k} className="sv-env-tag">{k}</span>
                      ))}
                    </div>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Preview links */}
          {data && data.previewUrls.length > 0 && (
            <section className="sv-aside__section">
              <h3 className="sv-aside__heading">
                Previews
                {data.previewStatus === "ready" && (
                  <span className="sv-aside__badge sv-aside__badge--live">Live</span>
                )}
                {data.previewStatus === "starting" && (
                  <span className="sv-aside__badge">Starting</span>
                )}
              </h3>
              <div className="sv-preview-list">
                {data.previewUrls.map((p) => (
                  <a
                    key={`side-${p.port}-${p.url}`}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="sv-preview-card"
                  >
                    <div className="sv-preview-card__top">
                      <span className="sv-preview-card__port">:{p.port}</span>
                      <svg className="sv-preview-card__arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 2h8v8M14 2L6 10" />
                      </svg>
                    </div>
                    <span className="sv-preview-card__url">
                      {p.url.replace(/^https?:\/\//, "").slice(0, 42)}
                    </span>
                  </a>
                ))}
              </div>
              {data.previewHint && (
                <p className="sv-preview-hint">{data.previewHint}</p>
              )}
            </section>
          )}

          {/* Task history */}
          {data && data.tasks.length > 0 && (
            <section className="sv-aside__section sv-aside__section--grow">
              <h3 className="sv-aside__heading">
                Tasks
                <span className="sv-aside__count">{data.tasks.length}</span>
              </h3>
              <div className="sv-tasks">
                {data.tasks.slice().reverse().map((task) => (
                  <div
                    key={task.taskId}
                    className={`sv-task sv-task--${dotVariant(task.status)}`}
                  >
                    <div className="sv-task__header">
                      <span className={`sv-dot sv-dot--sm sv-dot--${dotVariant(task.status)}`} />
                      <span className="sv-task__prompt">{truncate(task.prompt, 80)}</span>
                    </div>
                    <div className="sv-task__meta">
                      <span>{statusLabel(task.status)}</span>
                      <span className="sv-task__sep">{"\u00B7"}</span>
                      <span>{phaseLabels[task.phase]}</span>
                      <span className="sv-task__sep">{"\u00B7"}</span>
                      <span>{fmtTime(task.updatedAt)}</span>
                    </div>
                    {(task.error || task.result) && (
                      <div className={`sv-task__result ${task.error ? "sv-task__result--err" : ""}`}>
                        {truncate(task.error ?? task.result, 120)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
