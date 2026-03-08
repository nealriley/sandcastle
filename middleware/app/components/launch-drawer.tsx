"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateCatalogEntry } from "@/lib/template-service-types";
import type { RuntimeName, UserEnvironmentVariable } from "@/lib/types";
import { readError } from "@/lib/fetch-utils";

type EnvironmentRow = {
  id: string;
  key: string;
  value: string;
};

type SchemaEnvironmentValues = Record<string, string>;

function makeRowId(): string {
  return Math.random().toString(36).slice(2, 10);
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

function parseSandboxPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function buildStoredValueMap(
  storedEnvironment: UserEnvironmentVariable[]
): Map<string, string> {
  return new Map(
    storedEnvironment.map((variable) => [variable.key, variable.value])
  );
}

function buildInitialSchemaEnvironmentValues(
  template: TemplateCatalogEntry,
  storedEnvironment: UserEnvironmentVariable[]
): SchemaEnvironmentValues {
  const storedValues = buildStoredValueMap(storedEnvironment);
  return Object.fromEntries(
    template.environmentSchema.map((field) => [
      field.key,
      storedValues.get(field.key) ?? field.defaultValue ?? "",
    ])
  );
}

export default function LaunchDrawer({
  template,
  storedEnvironment,
  onClose,
}: {
  template: TemplateCatalogEntry;
  storedEnvironment: UserEnvironmentVariable[];
  onClose: () => void;
}) {
  const router = useRouter();
  const acceptsPrompts = template.acceptsPrompts;
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<RuntimeName>(template.defaultRuntime);
  const [schemaEnvironmentValues, setSchemaEnvironmentValues] =
    useState<SchemaEnvironmentValues>(
      buildInitialSchemaEnvironmentValues(template, storedEnvironment)
    );
  const [customEnvironmentRows, setCustomEnvironmentRows] = useState<EnvironmentRow[]>(
    []
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = isCreating || isPending;

  useEffect(() => {
    if (!template.supportedRuntimes.includes(runtime)) {
      setRuntime(template.defaultRuntime);
    }
  }, [template, runtime]);

  useEffect(() => {
    setSchemaEnvironmentValues(
      buildInitialSchemaEnvironmentValues(template, storedEnvironment)
    );
    setCustomEnvironmentRows([]);
  }, [template, storedEnvironment]);

  async function handleCreate() {
    if (isBusy) {
      return;
    }

    const nextPrompt = prompt.trim();
    if (acceptsPrompts && !nextPrompt && !template.defaultPrompt) {
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
          ...(acceptsPrompts ? { prompt: nextPrompt } : {}),
          runtime,
          templateSlug: template.slug,
          environment: [
            ...template.environmentSchema.map((field) => ({
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

      const body = (await response.json()) as { sandboxUrl?: string | null };
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

  function updateRow(id: string, field: "key" | "value", value: string) {
    setCustomEnvironmentRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  function removeRow(id: string) {
    setCustomEnvironmentRows((rows) => rows.filter((r) => r.id !== id));
  }

  function addRow() {
    setCustomEnvironmentRows((rows) => [
      ...rows,
      {
        id: makeRowId(),
        key: "",
        value: "",
      },
    ]);
  }

  function updateSchemaEnvironmentValue(key: string, value: string) {
    setSchemaEnvironmentValues((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <>
      <div
        className="drawer-overlay"
        onClick={() => {
          if (!isBusy) {
            onClose();
          }
        }}
      />
      <div className="drawer" role="dialog" aria-label={`Launch ${template.name}`}>
        <div className="drawer__header">
          <div>
            <p className="page-kicker">Launch template</p>
            <h2 className="panel__title">{template.name}</h2>
          </div>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={onClose}
            disabled={isBusy}
          >
            Close
          </button>
        </div>

        <div className="drawer__body">
          <p className="panel__description">{template.summary}</p>

          {acceptsPrompts ? (
            <label className="form-field">
              <span className="form-label">Initial prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={template.promptPlaceholder}
                rows={4}
                disabled={isBusy}
              />
            </label>
          ) : (
            <p className="table-note">
              This template runs a fixed shell command and does not accept prompts.
            </p>
          )}

          <label className="form-field form-field--compact">
            <span className="form-label">Runtime</span>
            <select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as RuntimeName)}
              disabled={isBusy}
            >
              {template.supportedRuntimes.map((rt) => (
                <option key={rt} value={rt}>
                  {runtimeLabel(rt)}
                </option>
              ))}
            </select>
          </label>

          {(template.environmentSchema.length > 0 ||
            customEnvironmentRows.length > 0) && (
            <div className="template-env-panel">
              <div className="panel__header panel__header--split">
                <div>
                  <p className="page-kicker">Environment</p>
                  <h3 className="panel__title">Launch-time variables</h3>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => addRow()}
                  disabled={isBusy}
                >
                  Add custom variable
                </button>
              </div>

              {template.environmentSchema.length > 0 && (
                <div className="env-row-list">
                  {template.environmentSchema.map((field) => (
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
              )}

              {customEnvironmentRows.length > 0 ? (
                <div className="env-row-list">
                  {customEnvironmentRows.map((row) => (
                    <div key={row.id} className="env-row">
                      <label className="form-field form-field--compact">
                        <span className="form-label">Key</span>
                        <input
                          value={row.key}
                          onChange={(e) => updateRow(row.id, "key", e.target.value)}
                          placeholder="EXAMPLE_API_KEY"
                          disabled={isBusy}
                        />
                      </label>
                      <label className="form-field form-field--compact">
                        <span className="form-label">Value</span>
                        <input
                          value={row.value}
                          onChange={(e) => updateRow(row.id, "value", e.target.value)}
                          placeholder="Secret value"
                          type="password"
                          disabled={isBusy}
                        />
                      </label>
                      <div className="env-row__actions">
                        <button
                          type="button"
                          className="button button--ghost button--tiny"
                          onClick={() => removeRow(row.id)}
                          disabled={isBusy}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : template.environmentSchema.length === 0 ? (
                <div className="empty-state">No environment variables configured.</div>
              ) : null}
            </div>
          )}

          {feedback && <div className="alert alert--error">{feedback}</div>}
        </div>

        <div className="drawer__footer">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </button>
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
            ) : template.defaultPrompt && !prompt.trim() ? (
              "Launch with default prompt"
            ) : (
              "Launch sandbox"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
