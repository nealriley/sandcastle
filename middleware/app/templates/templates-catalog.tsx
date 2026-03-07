"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RuntimeName } from "@/lib/types";
import type { SandcastleTemplateCatalogEntry } from "@/lib/templates";
import { summarizeTemplateRuntimes } from "@/lib/templates";

type CreateSandboxResponse = {
  sandboxUrl?: string | null;
  error?: string | null;
};

type EnvironmentRow = {
  id: string;
  key: string;
  value: string;
};

function parseSandboxPath(
  sandboxUrl: string | null | undefined
): string | null {
  if (!sandboxUrl) {
    return null;
  }

  try {
    return new URL(sandboxUrl).pathname;
  } catch {
    return sandboxUrl;
  }
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${response.status}`;
}

function runtimeLabel(runtime: RuntimeName): string {
  switch (runtime) {
    case "node24":
      return "Node 24";
    case "node22":
      return "Node 22";
    default:
      return "Python 3.13";
  }
}

function makeRowId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildDefaultEnvironmentRows(
  template: SandcastleTemplateCatalogEntry | null
): EnvironmentRow[] {
  if (!template || template.envHints.length === 0) {
    return [];
  }

  return template.envHints.map((hint) => ({
    id: makeRowId(),
    key: hint.key,
    value: "",
  }));
}

export default function TemplatesCatalog({
  templates,
}: {
  templates: SandcastleTemplateCatalogEntry[];
}) {
  const router = useRouter();
  const liveTemplates = useMemo(
    () => templates.filter((template) => template.status === "live"),
    [templates]
  );
  const [selectedTemplateSlug, setSelectedTemplateSlug] = useState<string | null>(
    liveTemplates[0]?.slug ?? null
  );
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<RuntimeName>(
    liveTemplates[0]?.defaultRuntime ?? "node24"
  );
  const [environmentRows, setEnvironmentRows] = useState<EnvironmentRow[]>(
    buildDefaultEnvironmentRows(liveTemplates[0] ?? null)
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.slug === selectedTemplateSlug) ?? null,
    [selectedTemplateSlug, templates]
  );

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    if (!selectedTemplate.supportedRuntimes.includes(runtime)) {
      setRuntime(selectedTemplate.defaultRuntime);
    }
  }, [runtime, selectedTemplate]);

  useEffect(() => {
    setEnvironmentRows(buildDefaultEnvironmentRows(selectedTemplate));
  }, [selectedTemplate?.slug]);

  async function handleCreate() {
    const nextPrompt = prompt.trim();
    if (!selectedTemplate || selectedTemplate.status !== "live") {
      setFeedback("Choose a live template before creating a sandbox.");
      return;
    }

    if (!nextPrompt && !selectedTemplate.defaultPrompt) {
      setFeedback("Add an initial prompt before creating a sandbox.");
      return;
    }

    setFeedback(null);

    try {
      const response = await fetch("/api/sandboxes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: nextPrompt,
          runtime,
          templateSlug: selectedTemplate.slug,
          environment: environmentRows.map((row) => ({
            key: row.key,
            value: row.value,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const body = (await response.json()) as CreateSandboxResponse;
      const nextPath = parseSandboxPath(body.sandboxUrl);
      if (!nextPath) {
        throw new Error("Sandbox created, but no settings URL was returned.");
      }

      startTransition(() => {
        router.push(nextPath);
        router.refresh();
      });
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Failed to create sandbox."
      );
    }
  }

  function updateEnvironmentRow(
    id: string,
    field: "key" | "value",
    value: string
  ) {
    setEnvironmentRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  function removeEnvironmentRow(id: string) {
    setEnvironmentRows((current) => current.filter((row) => row.id !== id));
  }

  function addEnvironmentRow(prefill?: string) {
    setEnvironmentRows((current) => [
      ...current,
      { id: makeRowId(), key: prefill ?? "", value: "" },
    ]);
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="page-kicker">Catalog</p>
            <h2 className="panel__title">Built-in templates</h2>
          </div>
        </div>

        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Status</th>
                <th>Runtimes</th>
                <th>Purpose</th>
                <th className="data-table__actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const isLive = template.status === "live";
                const isSelected = template.slug === selectedTemplateSlug;
                return (
                  <tr key={template.slug}>
                    <td className="data-table__primary">
                      <div className="table-primary">{template.name}</div>
                      <div className="table-note">{template.summary}</div>
                    </td>
                    <td>
                      <span
                        className={`status-chip status-chip--${
                          isLive ? "active" : "planned"
                        }`}
                      >
                        {isLive ? "Live" : "Planned"}
                      </span>
                    </td>
                    <td>{summarizeTemplateRuntimes(template)}</td>
                    <td>{template.purpose}</td>
                    <td className="data-table__actions">
                      {isLive ? (
                        <button
                          type="button"
                          className={
                            isSelected
                              ? "button button--primary button--small"
                              : "button button--ghost button--small"
                          }
                          onClick={() => {
                            setSelectedTemplateSlug(template.slug);
                            setFeedback(null);
                          }}
                        >
                          {isSelected ? "Selected" : template.launchLabel}
                        </button>
                      ) : (
                        <span className="table-note">{template.launchLabel}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel--muted">
        <div className="panel__header panel__header--split">
          <div>
            <p className="page-kicker">Create from template</p>
            <h2 className="panel__title">
              {selectedTemplate
                ? `${selectedTemplate.name} sandbox`
                : "No live template selected"}
            </h2>
          </div>
          {selectedTemplate ? (
            <div className="table-note">
              Default runtime: {runtimeLabel(selectedTemplate.defaultRuntime)}
            </div>
          ) : null}
        </div>

        <p className="panel__description">
          {selectedTemplate
            ? `${selectedTemplate.summary} New sandboxes launch from this template and then open directly into the sandbox settings view.`
            : "Live templates will appear here once they are ready for creation."}
        </p>

        {selectedTemplate ? (
          <div className="create-sandbox-panel">
            <label className="form-field">
              <span className="form-label">Initial prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={selectedTemplate.promptPlaceholder}
                rows={5}
                disabled={isPending}
              />
            </label>

            <div className="template-env-panel">
              <div className="panel__header panel__header--split">
                <div>
                  <p className="page-kicker">Environment</p>
                  <h3 className="panel__title">Launch-time variables</h3>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => addEnvironmentRow()}
                  disabled={isPending}
                >
                  Add variable
                </button>
              </div>

              <p className="panel__description">
                These values are injected once when the sandbox starts. Sandcastle
                stores only the key names in the UI, not the secret values.
              </p>

              {selectedTemplate.envHints.length > 0 ? (
                <div className="template-env-hints">
                  {selectedTemplate.envHints.map((hint) => (
                    <button
                      key={hint.key}
                      type="button"
                      className="button button--ghost button--tiny"
                      onClick={() => {
                        if (
                          environmentRows.some(
                            (row) => row.key.trim().toUpperCase() === hint.key
                          )
                        ) {
                          return;
                        }
                        addEnvironmentRow(hint.key);
                      }}
                      disabled={isPending}
                    >
                      {hint.key}
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedTemplate.envHints.length > 0 ? (
                <div className="table-note">
                  {selectedTemplate.envHints
                    .map((hint) => `${hint.key}: ${hint.description}`)
                    .join(" ")}
                </div>
              ) : null}

              {environmentRows.length > 0 ? (
                <div className="env-row-list">
                  {environmentRows.map((row) => (
                    <div key={row.id} className="env-row">
                      <label className="form-field form-field--compact">
                        <span className="form-label">Key</span>
                        <input
                          value={row.key}
                          onChange={(event) =>
                            updateEnvironmentRow(row.id, "key", event.target.value)
                          }
                          placeholder="EXAMPLE_API_KEY"
                          disabled={isPending}
                        />
                      </label>
                      <label className="form-field form-field--compact">
                        <span className="form-label">Value</span>
                        <input
                          value={row.value}
                          onChange={(event) =>
                            updateEnvironmentRow(row.id, "value", event.target.value)
                          }
                          placeholder="Secret value"
                          type="password"
                          disabled={isPending}
                        />
                      </label>
                      <div className="env-row__actions">
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={() => removeEnvironmentRow(row.id)}
                          disabled={isPending}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  No launch-time environment variables configured.
                </div>
              )}
            </div>

            <div className="create-sandbox-panel__footer">
              <label className="form-field form-field--compact">
                <span className="form-label">Runtime</span>
                <select
                  value={runtime}
                  onChange={(event) =>
                    setRuntime(event.target.value as RuntimeName)
                  }
                  disabled={isPending}
                >
                  {selectedTemplate.supportedRuntimes.map((option) => (
                    <option key={option} value={option}>
                      {runtimeLabel(option)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="action-strip">
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void handleCreate()}
                  disabled={isPending}
                >
                  {isPending
                    ? "Creating..."
                    : selectedTemplate.defaultPrompt && !prompt.trim()
                      ? "Create and run template flow"
                      : "Create and open sandbox"}
                </button>
              </div>
            </div>

            {feedback ? <div className="alert alert--error">{feedback}</div> : null}
          </div>
        ) : (
          <div className="empty-state">
            No live templates are available for creation yet.
          </div>
        )}
      </section>
    </div>
  );
}
