"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export type SandboxTableRow = {
  sessionKey: string;
  sandboxId: string;
  runtime: string;
  status: "active" | "stopped";
  latestPrompt: string | null;
  updatedAt: number;
  settingsHref: string;
};

type FeedbackState = {
  tone: "neutral" | "danger";
  text: string;
} | null;

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncatePrompt(prompt: string | null): string {
  if (!prompt) {
    return "No prompt recorded yet";
  }

  return prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${response.status}`;
}

export default function SandboxesTable({
  rows,
}: {
  rows: SandboxTableRow[];
}) {
  const router = useRouter();
  const [showStopped, setShowStopped] = useState(false);
  const [promptRowKey, setPromptRowKey] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hasStoppedRows = rows.some((row) => row.status === "stopped");
  const visibleRows = showStopped
    ? rows
    : rows.filter((row) => row.status === "active");
  const stoppedCount = rows.length - visibleRows.length;

  async function handleKill(row: SandboxTableRow) {
    const confirmed = window.confirm(
      `Kill sandbox ${row.sandboxId}? This stops the sandbox immediately.`
    );
    if (!confirmed) {
      return;
    }

    setActiveRowKey(`kill:${row.sessionKey}`);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(row.sessionKey)}/stop`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setFeedback({
        tone: "neutral",
        text: `Sandbox ${row.sandboxId} was stopped.`,
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "Failed to stop sandbox.",
      });
    } finally {
      setActiveRowKey(null);
    }
  }

  async function handlePromptSubmit(row: SandboxTableRow) {
    const prompt = (promptDrafts[row.sessionKey] ?? "").trim();
    if (!prompt) {
      setFeedback({
        tone: "danger",
        text: "Enter a prompt before sending it to the sandbox.",
      });
      return;
    }

    setActiveRowKey(`prompt:${row.sessionKey}`);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(row.sessionKey)}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setPromptDrafts((current) => ({ ...current, [row.sessionKey]: "" }));
      setPromptRowKey(null);
      setFeedback({
        tone: "neutral",
        text: `Started a new task in sandbox ${row.sandboxId}.`,
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error ? error.message : "Failed to send sandbox prompt.",
      });
    } finally {
      setActiveRowKey(null);
    }
  }

  return (
    <div className="table-area">
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

      <div className="table-toolbar">
        <div className="table-toolbar__copy">
          <div className="table-toolbar__title">
            {showStopped ? "All sandboxes" : "Active sandboxes"}
          </div>
          <div className="table-toolbar__meta">
            {showStopped
              ? `${rows.length} sandboxes shown`
              : `${visibleRows.length} active sandboxes shown`}
            {!showStopped && stoppedCount > 0
              ? `, ${stoppedCount} stopped hidden`
              : ""}
          </div>
        </div>

        {hasStoppedRows ? (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setShowStopped((current) => !current)}
          >
            {showStopped ? "Hide stopped" : "Show stopped"}
          </button>
        ) : null}
      </div>

      {visibleRows.length === 0 ? (
        <div className="empty-state">
          {rows.length === 0
            ? "No sandboxes found."
            : "No active sandboxes are visible right now. Show stopped sandboxes to inspect older runs."}
        </div>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sandbox</th>
                <th>Runtime</th>
                <th>Status</th>
                <th>Updated</th>
                <th className="data-table__actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isPromptOpen = promptRowKey === row.sessionKey;
                const promptBusy = activeRowKey === `prompt:${row.sessionKey}`;
                const killBusy = activeRowKey === `kill:${row.sessionKey}`;
                const actionsDisabled = isPending || promptBusy || killBusy;

                return (
                  <Fragment key={row.sessionKey}>
                    <tr>
                      <td className="data-table__primary">
                        <div className="table-primary">{row.sandboxId}</div>
                        <div className="table-note">
                          {truncatePrompt(row.latestPrompt)}
                        </div>
                      </td>
                      <td>{row.runtime}</td>
                      <td>
                        <span className={`status-chip status-chip--${row.status}`}>
                          {row.status}
                        </span>
                      </td>
                      <td>{formatTimestamp(row.updatedAt)}</td>
                      <td className="data-table__actions">
                        <div className="table-actions">
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() =>
                              setPromptRowKey((current) =>
                                current === row.sessionKey ? null : row.sessionKey
                              )
                            }
                            disabled={
                              row.status !== "active" ||
                              actionsDisabled
                            }
                          >
                            Prompt
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--small button--danger"
                            onClick={() => void handleKill(row)}
                            disabled={
                              row.status !== "active" ||
                              actionsDisabled
                            }
                          >
                            {killBusy ? "Killing..." : "Kill"}
                          </button>
                          <Link
                            href={row.settingsHref}
                            className="button button--secondary button--small"
                          >
                            Settings
                          </Link>
                        </div>
                      </td>
                    </tr>

                    {isPromptOpen ? (
                      <tr className="data-table__prompt-row">
                        <td colSpan={5}>
                          <div className="prompt-inline">
                            <label className="form-field prompt-inline__field">
                              <span className="form-label">
                                Send a follow-up prompt to {row.sandboxId}
                              </span>
                              <textarea
                                value={promptDrafts[row.sessionKey] ?? ""}
                                onChange={(event) =>
                                  setPromptDrafts((current) => ({
                                    ...current,
                                    [row.sessionKey]: event.target.value,
                                  }))
                                }
                                placeholder={`Ask ${row.sandboxId} to continue working`}
                                rows={3}
                                disabled={promptBusy}
                              />
                            </label>

                            <div className="table-actions">
                              <button
                                type="button"
                                className="button button--primary button--small"
                                onClick={() => void handlePromptSubmit(row)}
                                disabled={promptBusy}
                              >
                                {promptBusy ? "Sending..." : "Send prompt"}
                              </button>
                              <button
                                type="button"
                                className="button button--ghost button--small"
                                onClick={() => setPromptRowKey(null)}
                                disabled={promptBusy}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
