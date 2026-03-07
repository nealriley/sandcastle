import * as coda from "@codahq/packs-sdk";

/**
 * Schemas consumed by the Pack chat skill.
 *
 * IMPORTANT: Coda normalizes property names to PascalCase in output.
 * So "sandboxId" becomes "SandboxId", "sandboxToken" becomes "SandboxToken", etc.
 */

export const SandboxSummarySchema = coda.makeObjectSchema({
  properties: {
    sandboxId: {
      type: coda.ValueType.String,
      description:
        "Human-visible sandbox id (for example sb_xxx). Show this to the user when listing owned sandboxes.",
    },
    sandboxToken: {
      type: coda.ValueType.String,
      description:
        "Opaque control token for this sandbox. Save it for ContinueSandbox, GetSandboxStatus, ReadSandboxFile, GetSandboxPreview, and StopSandbox.",
    },
    sandboxUrl: {
      type: coda.ValueType.String,
      description:
        "Owner-only browser URL for the sandbox console.",
      codaType: coda.ValueHintType.Url,
    },
    status: {
      type: coda.ValueType.String,
      description:
        "Sandbox lifecycle status: active or stopped.",
    },
    templateSlug: {
      type: coda.ValueType.String,
      description:
        "Template slug used to create this sandbox, such as standard or shell-scripts-validation.",
    },
    templateName: {
      type: coda.ValueType.String,
      description:
        "Human-readable template name used to create this sandbox.",
    },
    runtime: {
      type: coda.ValueType.String,
      description: "Runtime used for the sandbox.",
    },
    createdAt: {
      type: coda.ValueType.Number,
      description: "Unix timestamp in milliseconds when the sandbox was created.",
    },
    updatedAt: {
      type: coda.ValueType.Number,
      description: "Unix timestamp in milliseconds for the latest owned-sandbox activity.",
    },
    latestPrompt: {
      type: coda.ValueType.String,
      description:
        "Most recent prompt recorded for this sandbox, if any.",
    },
  },
  displayProperty: "sandboxId",
});

export const TemplateSummarySchema = coda.makeObjectSchema({
  properties: {
    slug: {
      type: coda.ValueType.String,
      description:
        "Stable template slug, used when creating a new sandbox from this template.",
    },
    name: {
      type: coda.ValueType.String,
      description: "Human-readable template name.",
    },
    summary: {
      type: coda.ValueType.String,
      description: "Short summary of what this template is for.",
    },
    purpose: {
      type: coda.ValueType.String,
      description: "Longer explanation of the use case this template supports.",
    },
    status: {
      type: coda.ValueType.String,
      description: "Template availability status, such as live or planned.",
    },
    sourceKind: {
      type: coda.ValueType.String,
      description: "How the template launches its sandbox, such as snapshot or runtime.",
    },
    defaultRuntime: {
      type: coda.ValueType.String,
      description: "Default runtime used when the template is launched.",
    },
    supportedRuntimes: {
      type: coda.ValueType.Array,
      items: { type: coda.ValueType.String },
      description: "Runtimes this template supports.",
    },
    launchLabel: {
      type: coda.ValueType.String,
      description: "Suggested call-to-action label for launching the template.",
    },
  },
  displayProperty: "name",
});

export const SandboxListResultSchema = coda.makeObjectSchema({
  properties: {
    sandboxes: {
      type: coda.ValueType.Array,
      items: SandboxSummarySchema,
      description:
        "Owned sandboxes matching the query. Default behavior is active sandboxes only.",
    },
    templates: {
      type: coda.ValueType.Array,
      items: TemplateSummarySchema,
      description:
        "Built-in Sandcastle templates currently available for new sandbox creation.",
    },
    authUrl: {
      type: coda.ValueType.String,
      description:
        "Website URL where the user signs in with GitHub and gets a three-word Sandcastle Connector code.",
      codaType: coda.ValueHintType.Url,
    },
    errorCode: {
      type: coda.ValueType.String,
      description:
        "Structured auth/setup error code, such as auth_required or invalid_auth_code.",
    },
    error: {
      type: coda.ValueType.String,
      description:
        "Error message when sandbox listing could not be completed.",
    },
  },
  displayProperty: "error",
});

export const TemplateListResultSchema = coda.makeObjectSchema({
  properties: {
    templates: {
      type: coda.ValueType.Array,
      items: TemplateSummarySchema,
      description: "Built-in Sandcastle templates available for new sandboxes.",
    },
    defaultTemplateSlug: {
      type: coda.ValueType.String,
      description: "Default template slug for standard new sandboxes.",
    },
  },
  displayProperty: "defaultTemplateSlug",
});

export const TaskResultSchema = coda.makeObjectSchema({
  properties: {
    taskId: {
      type: coda.ValueType.String,
      description:
        "Opaque task token for the latest task in the sandbox.",
    },
    sandboxId: {
      type: coda.ValueType.String,
      description:
        "Human-visible sandbox id (for example sb_xxx). Share this when the user wants to pick a sandbox later.",
    },
    sandboxToken: {
      type: coda.ValueType.String,
      description:
        "Opaque sandbox control token. Save this for ContinueSandbox, GetSandboxStatus, ReadSandboxFile, GetSandboxPreview, and StopSandbox.",
    },
    templateSlug: {
      type: coda.ValueType.String,
      description:
        "Template slug for the sandbox associated with this task, if known.",
    },
    templateName: {
      type: coda.ValueType.String,
      description:
        "Human-readable template name for the sandbox associated with this task, if known.",
    },
    status: {
      type: coda.ValueType.String,
      description:
        "Current task or sandbox status: accepted, running, complete, failed, or stopped.",
    },
    phase: {
      type: coda.ValueType.String,
      description:
        "Detailed task phase: queued, booting, prompting, thinking, coding, installing, preview-starting, waiting-for-input, stalled, complete, failed, or stopped.",
    },
    phaseDetail: {
      type: coda.ValueType.String,
      description:
        "Human-readable detail about what the sandbox is doing right now.",
    },
    isComplete: {
      type: coda.ValueType.Boolean,
      description:
        "True when the latest task is complete, failed, or the sandbox is stopped.",
    },
    createdAt: {
      type: coda.ValueType.Number,
      description: "Unix timestamp in milliseconds when the latest task started.",
    },
    updatedAt: {
      type: coda.ValueType.Number,
      description:
        "Unix timestamp in milliseconds for the latest meaningful task progress.",
    },
    completedAt: {
      type: coda.ValueType.Number,
      description:
        "Unix timestamp in milliseconds when the latest task completed, if it has finished.",
    },
    lastLogAt: {
      type: coda.ValueType.Number,
      description:
        "Unix timestamp in milliseconds for the latest log or heartbeat event.",
    },
    result: {
      type: coda.ValueType.String,
      description:
        "Final response text from the latest completed task, if available.",
    },
    previewUrl: {
      type: coda.ValueType.String,
      description:
        "Public URL for a dev server running in the sandbox (if any).",
      codaType: coda.ValueHintType.Url,
    },
    previewStatus: {
      type: coda.ValueType.String,
      description:
        "Preview state: not-ready, starting, or ready.",
    },
    previewHint: {
      type: coda.ValueType.String,
      description:
        "Human-readable detail about whether a preview exists yet.",
    },
    consoleTail: {
      type: coda.ValueType.String,
      description:
        "The last 20 lines of the sandbox console, suitable for status updates.",
    },
    sandboxUrl: {
      type: coda.ValueType.String,
      description:
        "Primary browser URL for the sandbox console, including prompt history, logs, and preview links.",
      codaType: coda.ValueHintType.Url,
    },
    authUrl: {
      type: coda.ValueType.String,
      description:
        "Website URL where the user signs in with GitHub and gets a three-word Sandcastle Connector code.",
      codaType: coda.ValueHintType.Url,
    },
    errorCode: {
      type: coda.ValueType.String,
      description:
        "Structured recovery code, such as auth_required, sandbox_busy, sandbox_stopped, task_not_found, or task_failed.",
    },
    recoveryAction: {
      type: coda.ValueType.String,
      description:
        "Recommended next step after this response, such as wait, retry_prompt, check_sandbox, start_new_sandbox, or authenticate.",
    },
    recoveryHint: {
      type: coda.ValueType.String,
      description:
        "Human-readable guidance for how to recover or what to do next.",
    },
    retryAfterMs: {
      type: coda.ValueType.Number,
      description:
        "Suggested minimum wait in milliseconds before retrying, when applicable.",
    },
    error: {
      type: coda.ValueType.String,
        description: "Error message if the task failed.",
    },
  },
  displayProperty: "status",
});
