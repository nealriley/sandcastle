"use client";

import { useMemo, useState } from "react";
import { readError } from "@/lib/fetch-utils";
import {
  BLOCKED_ENV_PREFIXES,
  validateEnvironmentEntry,
} from "@/lib/environment-rules";
import type { UserEnvironmentVariable } from "@/lib/types";

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function maskValue(value: string): string {
  return value.length > 0 ? "\u2022".repeat(Math.min(Math.max(value.length, 8), 20)) : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
}

export default function EnvironmentManager({
  initialVariables,
}: {
  initialVariables: UserEnvironmentVariable[];
}) {
  const [variables, setVariables] = useState<UserEnvironmentVariable[]>(
    initialVariables
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    key: "",
    value: "",
    secret: true,
  });
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "neutral" | "danger";
    text: string;
  } | null>(null);

  const sortedVariables = useMemo(
    () => [...variables].sort((left, right) => left.key.localeCompare(right.key)),
    [variables]
  );

  function resetDraft() {
    setEditingKey(null);
    setDraft({
      key: "",
      value: "",
      secret: true,
    });
  }

  function beginEdit(variable: UserEnvironmentVariable) {
    setEditingKey(variable.key);
    setDraft({
      key: variable.key,
      value: variable.value,
      secret: variable.secret,
    });
    setFeedback(null);
  }

  async function handleSave() {
    try {
      validateEnvironmentEntry({
        key: draft.key,
        value: draft.value,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Invalid environment variable.",
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as {
        variables?: UserEnvironmentVariable[];
      };
      setVariables(body.variables ?? []);
      setFeedback({
        tone: "neutral",
        text: editingKey
          ? `Updated ${draft.key.trim().toUpperCase()}.`
          : `Saved ${draft.key.trim().toUpperCase()}.`,
      });
      resetDraft();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Failed to save environment variable.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(key: string) {
    const confirmed = window.confirm(`Delete ${key}?`);
    if (!confirmed) {
      return;
    }

    setBusyKey(key);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/environment?key=${encodeURIComponent(key)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as {
        variables?: UserEnvironmentVariable[];
      };
      setVariables(body.variables ?? []);
      setRevealedKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (editingKey === key) {
        resetDraft();
      }
      setFeedback({
        tone: "neutral",
        text: `Deleted ${key}.`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Failed to delete environment variable.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel panel--muted">
        <div className="panel__header">
          <div>
            <p className="page-kicker">Store once</p>
            <h2 className="panel__title">Reusable launch-time variables</h2>
          </div>
        </div>
        <p className="panel__description">
          Sandcastle matches these saved variables by key and pre-fills template
          launch fields in the marketplace. Reserved prefixes are blocked:
          {" "}
          {BLOCKED_ENV_PREFIXES.join(", ")}
        </p>

        <div className="create-sandbox-panel">
          {feedback && (
            <div
              className={
                feedback.tone === "danger"
                  ? "alert alert--error"
                  : "alert alert--neutral"
              }
            >
              {feedback.text}
            </div>
          )}

          <div className="env-row-list">
            <div className="env-row">
              <label className="form-field form-field--compact">
                <span className="form-label">Key</span>
                <input
                  value={draft.key}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      key: event.target.value,
                    }))
                  }
                  placeholder="OPENAI_API_KEY"
                  disabled={saving || editingKey !== null}
                />
              </label>
              <label className="form-field form-field--compact">
                <span className="form-label">Value</span>
                <input
                  type="password"
                  value={draft.value}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      value: event.target.value,
                    }))
                  }
                  placeholder="Secret value"
                  disabled={saving}
                />
              </label>
              <div className="env-row__actions">
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? (
                    <>
                      <span className="button__spinner" aria-hidden="true" />
                      Saving...
                    </>
                  ) : editingKey ? (
                    "Update"
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.secret}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    secret: event.target.checked,
                  }))
                }
                disabled={saving}
              />
              <span>Mask this value in the UI</span>
            </label>

            {editingKey && (
              <div className="action-strip">
                <span className="table-note">
                  Editing {editingKey}. Rename by deleting it and saving a new key.
                </span>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={resetDraft}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="table-toolbar">
          <div className="table-toolbar__copy">
            <div className="table-toolbar__title">Saved variables</div>
            <div className="table-toolbar__meta">
              {sortedVariables.length} stored
            </div>
          </div>
        </div>

        {sortedVariables.length === 0 ? (
          <div className="empty-state">
            No saved environment variables yet.
          </div>
        ) : (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Display</th>
                  <th>Updated</th>
                  <th className="data-table__actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedVariables.map((variable) => {
                  const revealed = Boolean(revealedKeys[variable.key]);
                  const deleting = busyKey === variable.key;

                  return (
                    <tr key={variable.key}>
                      <td className="data-table__primary">
                        <div className="table-primary">{variable.key}</div>
                      </td>
                      <td className="secret-value">
                        {variable.secret && !revealed
                          ? maskValue(variable.value)
                          : variable.value || "\u2014"}
                      </td>
                      <td>
                        <span className="tag tag--muted">
                          {variable.secret ? "Masked" : "Plain text"}
                        </span>
                      </td>
                      <td>{formatDateTime(variable.updatedAt)}</td>
                      <td className="data-table__actions">
                        <div className="table-actions">
                          {variable.secret && (
                            <button
                              type="button"
                              className="button button--ghost button--small"
                              onClick={() =>
                                setRevealedKeys((current) => ({
                                  ...current,
                                  [variable.key]: !current[variable.key],
                                }))
                              }
                              disabled={deleting}
                            >
                              {revealed ? "Hide" : "Reveal"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={() => beginEdit(variable)}
                            disabled={deleting || saving}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button button--danger button--small"
                            onClick={() => void handleDelete(variable.key)}
                            disabled={deleting || saving}
                          >
                            {deleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
