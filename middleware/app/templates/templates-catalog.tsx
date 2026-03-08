"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateCatalogEntry } from "@/lib/template-service-types";
import type { RuntimeName } from "@/lib/types";
import { summarizeTemplateRuntimes } from "@/lib/templates";
import { readError } from "@/lib/fetch-utils";

type CreateSandboxResponse = {
  sandboxUrl?: string | null;
  error?: string | null;
};

type EnvironmentRow = {
  id: string;
  key: string;
  value: string;
};

type SchemaEnvironmentValues = Record<string, string>;

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

function buildDefaultSchemaEnvironmentValues(
  template: TemplateCatalogEntry | null
): SchemaEnvironmentValues {
  if (!template || template.environmentSchema.length === 0) {
    return {};
  }

  return Object.fromEntries(
    template.environmentSchema.map((field) => [
      field.key,
      field.defaultValue ?? "",
    ])
  );
}

function isLaunchableTemplate(template: TemplateCatalogEntry): boolean {
  return (
    template.templateStatus === "active" &&
    template.latestVersionState === "published"
  );
}

export default function TemplatesCatalog({
  templates,
}: {
  templates: TemplateCatalogEntry[];
}) {
  const router = useRouter();
  const liveTemplates = useMemo(
    () => templates.filter(isLaunchableTemplate),
    [templates]
  );
  const [selectedTemplateSlug, setSelectedTemplateSlug] = useState<string | null>(
    liveTemplates[0]?.slug ?? null
  );
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<RuntimeName>(
    liveTemplates[0]?.defaultRuntime ?? "node24"
  );
  const [schemaEnvironmentValues, setSchemaEnvironmentValues] =
    useState<SchemaEnvironmentValues>(
      buildDefaultSchemaEnvironmentValues(liveTemplates[0] ?? null)
    );
  const [customEnvironmentRows, setCustomEnvironmentRows] = useState<EnvironmentRow[]>(
    []
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = isCreating || isPending;

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
    setSchemaEnvironmentValues(
      buildDefaultSchemaEnvironmentValues(selectedTemplate)
    );
    setCustomEnvironmentRows([]);
  }, [selectedTemplate?.slug]);

  async function handleCreate() {
    if (isBusy) {
      return;
    }

    const nextPrompt = prompt.trim();
    if (!selectedTemplate || !isLaunchableTemplate(selectedTemplate)) {
      setFeedback("Choose a published template before creating a sandbox.");
      return;
    }

    if (
      selectedTemplate.acceptsPrompts &&
      !nextPrompt &&
      !selectedTemplate.defaultPrompt
    ) {
      setFeedback("Add an initial prompt before creating a sandbox.");
      return;
    }

    setIsCreating(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/sandboxes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedTemplate.acceptsPrompts ? { prompt: nextPrompt } : {}),
          runtime,
          templateSlug: selectedTemplate.slug,
          environment: [
            ...selectedTemplate.environmentSchema.map((field) => ({
              key: field.key,
              value: schemaEnvironmentValues[field.key] ?? "",
            })),
            ...customEnvironmentRows.map((row) => ({
              key: row.key,
              value: row.value,
            })),
          ],
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
      setIsCreating(false);
    }
  }

  function updateEnvironmentRow(
    id: string,
    field: "key" | "value",
    value: string
  ) {
    setCustomEnvironmentRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  }

  function removeEnvironmentRow(id: string) {
    setCustomEnvironmentRows((current) =>
      current.filter((row) => row.id !== id)
    );
  }

  function addEnvironmentRow() {
    setCustomEnvironmentRows((current) => [
      ...current,
      { id: makeRowId(), key: "", value: "" },
    ]);
  }

  function updateSchemaEnvironmentValue(key: string, value: string) {
    setSchemaEnvironmentValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="page-kicker">Catalog</p>
            <h2 className="panel__title">Available templates</h2>
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
                const isLive = isLaunchableTemplate(template);
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
                        {isLive
                          ? "Live"
                          : template.latestVersionState === "draft"
                            ? "Draft"
                            : "Unavailable"}
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
                          disabled={isBusy}
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
            {selectedTemplate.acceptsPrompts ? (
              <label className="form-field">
                <span className="form-label">Initial prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={selectedTemplate.promptPlaceholder}
                  rows={5}
                  disabled={isBusy}
                />
              </label>
            ) : (
              <p className="table-note">
                This template runs a fixed shell command and does not accept prompts.
              </p>
            )}

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
                  disabled={isBusy}
                >
                  Add custom variable
                </button>
              </div>

              <p className="panel__description">
                These values are injected once when the sandbox starts. Sandcastle
                stores only the key names in the UI, not the secret values.
              </p>

              {selectedTemplate.environmentSchema.length > 0 ? (
                <div className="env-row-list">
                  {selectedTemplate.environmentSchema.map((field) => (
                    <div key={field.key} className="env-row">
                      <label className="form-field form-field--compact">
                        <span className="form-label">{field.label}</span>
                        {field.inputType === "select" ? (
                          <select
                            value={schemaEnvironmentValues[field.key] ?? ""}
                            onChange={(event) =>
                              updateSchemaEnvironmentValue(
                                field.key,
                                event.target.value
                              )
                            }
                            disabled={isBusy}
                          >
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={schemaEnvironmentValues[field.key] ?? ""}
                            onChange={(event) =>
                              updateSchemaEnvironmentValue(
                                field.key,
                                event.target.value
                              )
                            }
                            placeholder={field.defaultValue ?? field.key}
                            type={field.secret ? "password" : "text"}
                            disabled={isBusy}
                          />
                        )}
                        <span className="table-note">
                          <strong>{field.key}</strong>
                          {": "}
                          {field.description}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}

              {customEnvironmentRows.length > 0 ? (
                <div className="env-row-list">
                  {customEnvironmentRows.map((row) => (
                    <div key={row.id} className="env-row">
                      <label className="form-field form-field--compact">
                        <span className="form-label">Key</span>
                        <input
                          value={row.key}
                          onChange={(event) =>
                            updateEnvironmentRow(row.id, "key", event.target.value)
                          }
                          placeholder="EXAMPLE_API_KEY"
                          disabled={isBusy}
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
                          disabled={isBusy}
                        />
                      </label>
                      <div className="env-row__actions">
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={() => removeEnvironmentRow(row.id)}
                          disabled={isBusy}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : selectedTemplate.environmentSchema.length === 0 ? (
                <div className="empty-state">
                  No launch-time environment variables configured.
                </div>
              ) : null}
            </div>

            <div className="create-sandbox-panel__footer">
              <label className="form-field form-field--compact">
                <span className="form-label">Runtime</span>
                <select
                  value={runtime}
                  onChange={(event) =>
                    setRuntime(event.target.value as RuntimeName)
                  }
                  disabled={isBusy}
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
                  disabled={isBusy}
                  aria-busy={isBusy}
                >
                  {isBusy ? (
                    <>
                      <span className="button__spinner" aria-hidden="true" />
                      Creating sandbox...
                    </>
                  ) : selectedTemplate.acceptsPrompts &&
                    selectedTemplate.defaultPrompt &&
                    !prompt.trim() ? (
                    "Create and run template flow"
                  ) : (
                    "Create and open sandbox"
                  )}
                </button>
              </div>
            </div>

            {feedback ? <div className="alert alert--error">{feedback}</div> : null}
          </div>
        ) : (
          <div className="empty-state">
            No published templates are available for creation yet.
          </div>
        )}
      </section>
    </div>
  );
}
