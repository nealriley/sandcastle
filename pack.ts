import * as coda from "@codahq/packs-sdk";
import {
  SandboxListResultSchema,
  TemplateListResultSchema,
  TaskResultSchema,
} from "./schemas";
import { apiUrl, MIDDLEWARE_HOSTNAME } from "./helpers";
import type {
  SandboxListResponse,
  TemplateListResponse,
  TaskResponse,
} from "./types";

export const pack = coda.newPack();

const QUICK_CHECK_DELAY_MS = 2_000;

async function sleep(ms: number): Promise<void> {
  if (typeof SharedArrayBuffer !== "undefined") {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTaskStatus(
  context: coda.ExecutionContext,
  taskId: string
): Promise<TaskResponse> {
  try {
    const response = await context.fetcher.fetch({
      method: "GET",
      disableAuthentication: true,
      url: apiUrl(`/api/tasks/${encodeURIComponent(taskId)}`, {
        _t: String(Date.now()),
      }),
    });
    return normalizeTaskResponse(response.body as Partial<TaskResponse>);
  } catch (error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
      const statusError = error as coda.StatusCodeError;
      if (typeof statusError.body === "object" && statusError.body) {
        return normalizeTaskResponse(
          statusError.body as Partial<TaskResponse>
        );
      }
    }

    throw error;
  }
}

function emptyTaskResponse(): TaskResponse {
  return {
    taskId: "",
    sandboxId: "",
    sandboxToken: "",
    templateSlug: null,
    templateName: null,
    status: "failed",
    phase: "failed",
    phaseDetail: null,
    isComplete: true,
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    lastLogAt: null,
    result: null,
    previewUrl: null,
    previewStatus: "not-ready",
    previewHint: null,
    consoleTail: null,
    sandboxUrl: null,
    authUrl: null,
    errorCode: null,
    recoveryAction: "none",
    recoveryHint: null,
    retryAfterMs: null,
    error: null,
  };
}

function inferRecoveryAction(
  body: Partial<TaskResponse>
): TaskResponse["recoveryAction"] {
  switch (body.errorCode) {
    case "auth_required":
    case "invalid_auth_code":
      return "authenticate";
    case "sandbox_busy":
      return "wait";
    case "sandbox_stopped":
      return "start_new_sandbox";
    case "task_not_found":
      return "check_sandbox";
    case "task_failed":
      return "retry_prompt";
    default:
      return body.phase === "stalled" ? "wait" : "none";
  }
}

function inferRecoveryHint(body: Partial<TaskResponse>): string | null {
  if (body.recoveryHint != null) {
    return body.recoveryHint;
  }

  switch (body.errorCode) {
    case "auth_required":
      return "Open the Sandcastle Connector, sign in with GitHub, and retry with a fresh three-word connector code.";
    case "invalid_auth_code":
      return "Open the Sandcastle Connector and retry with a fresh three-word connector code.";
    case "sandbox_busy":
      return "This sandbox is already handling another task. Wait for it to finish, then retry the prompt.";
    case "sandbox_stopped":
      return "This sandbox has ended. Start a new sandbox or resume another active one.";
    case "task_not_found":
      return "This task token is no longer present. Check the sandbox status or send another prompt.";
    case "task_failed":
      return "The latest task failed. Review the console and retry with another prompt if needed.";
    default:
      return body.phase === "stalled"
        ? "The sandbox has gone quiet. Wait a bit longer or inspect the browser console before retrying."
        : null;
  }
}

function normalizeTaskResponse(body: Partial<TaskResponse>): TaskResponse {
  const sandboxToken =
    body.sandboxToken ??
    body.sessionId ??
    emptyTaskResponse().sandboxToken;
  const sandboxUrl =
    body.sandboxUrl ??
    body.sessionUrl ??
    body.logsUrl ??
    emptyTaskResponse().sandboxUrl;

  return {
    ...emptyTaskResponse(),
    ...body,
    sandboxToken,
    sandboxUrl,
    recoveryAction:
      body.recoveryAction ?? inferRecoveryAction(body),
    recoveryHint: inferRecoveryHint(body),
    retryAfterMs: body.retryAfterMs ?? null,
  };
}

function emptySandboxListResponse(): SandboxListResponse {
  return {
    sandboxes: [],
    templates: [],
    authUrl: null,
    errorCode: null,
    error: null,
  };
}

function normalizeSandboxListResponse(
  body: Partial<SandboxListResponse>
): SandboxListResponse {
  return {
    ...emptySandboxListResponse(),
    ...body,
    sandboxes: Array.isArray(body.sandboxes) ? body.sandboxes : [],
    templates: Array.isArray(body.templates) ? body.templates : [],
  };
}

async function createSandboxTask(
  context: coda.ExecutionContext,
  prompt: string,
  templateSlug?: string,
  authCode?: string
): Promise<TaskResponse> {
  try {
    const body: Record<string, string> = { prompt };
    if (templateSlug) {
      body.templateSlug = templateSlug;
    }
    if (authCode) {
      body.authCode = authCode;
    }

    const response = await context.fetcher.fetch({
      method: "POST",
      url: apiUrl("/api/sessions"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return normalizeTaskResponse(response.body as Partial<TaskResponse>);
  } catch (error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
      const statusError = error as coda.StatusCodeError;
      if (typeof statusError.body === "object" && statusError.body) {
        return normalizeTaskResponse(
          statusError.body as Partial<TaskResponse>
        );
      }
    }

    throw error;
  }
}

function emptyTemplateListResponse(): TemplateListResponse {
  return {
    templates: [],
    defaultTemplateSlug: "standard",
    authUrl: null,
    errorCode: null,
    error: null,
  };
}

function normalizeTemplateListResponse(
  body: Partial<TemplateListResponse>
): TemplateListResponse {
  return {
    ...emptyTemplateListResponse(),
    ...body,
    templates: Array.isArray(body.templates) ? body.templates : [],
  };
}

async function listTemplates(
  context: coda.ExecutionContext,
  authCode?: string,
  includeOwned?: boolean
): Promise<TemplateListResponse> {
  try {
    const shouldIncludeOwned = Boolean(includeOwned);
    const response = await context.fetcher.fetch(
      shouldIncludeOwned || authCode
        ? {
            method: "POST",
            disableAuthentication: true,
            url: apiUrl("/api/templates"),
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              authCode,
              includeOwned: shouldIncludeOwned,
            }),
          }
        : {
            method: "GET",
            disableAuthentication: true,
            url: apiUrl("/api/templates", {
              _t: String(Date.now()),
            }),
          }
    );

    return normalizeTemplateListResponse(
      response.body as Partial<TemplateListResponse>
    );
  } catch (error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
      const statusError = error as coda.StatusCodeError;
      if (typeof statusError.body === "object" && statusError.body) {
        return normalizeTemplateListResponse(
          statusError.body as Partial<TemplateListResponse>
        );
      }
    }

    throw error;
  }
}

async function listSandboxes(
  context: coda.ExecutionContext,
  authCode?: string,
  query?: string,
  includeStopped?: boolean
): Promise<SandboxListResponse> {
  try {
    const response = await context.fetcher.fetch({
      method: "POST",
      disableAuthentication: true,
      url: apiUrl("/api/sandboxes"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authCode,
        query,
        includeStopped: Boolean(includeStopped),
      }),
    });

    return normalizeSandboxListResponse(
      response.body as Partial<SandboxListResponse>
    );
  } catch (error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
      const statusError = error as coda.StatusCodeError;
      if (typeof statusError.body === "object" && statusError.body) {
        return normalizeSandboxListResponse(
          statusError.body as Partial<SandboxListResponse>
        );
      }
    }

    throw error;
  }
}

async function resumeSandboxTask(
  context: coda.ExecutionContext,
  sandboxId: string,
  prompt: string,
  authCode?: string
): Promise<TaskResponse> {
  try {
    const response = await context.fetcher.fetch({
      method: "POST",
      disableAuthentication: true,
      url: apiUrl("/api/sandboxes/resume"),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authCode ? { sandboxId, prompt, authCode } : { sandboxId, prompt }),
    });

    return normalizeTaskResponse(response.body as Partial<TaskResponse>);
  } catch (error) {
    if (coda.StatusCodeError.isStatusCodeError(error)) {
      const statusError = error as coda.StatusCodeError;
      if (typeof statusError.body === "object" && statusError.body) {
        return normalizeTaskResponse(
          statusError.body as Partial<TaskResponse>
        );
      }
    }

    throw error;
  }
}

async function quickCheckTask(
  context: coda.ExecutionContext,
  initial: TaskResponse
): Promise<TaskResponse> {
  await sleep(QUICK_CHECK_DELAY_MS);

  try {
    const latest = await fetchTaskStatus(context, initial.taskId);
    if (!latest.sandboxId) {
      latest.sandboxId = initial.sandboxId;
    }
    if (!latest.sandboxToken) {
      latest.sandboxToken = initial.sandboxToken;
    }
    if (!latest.sandboxUrl) {
      latest.sandboxUrl = initial.sandboxUrl;
    }
    return latest;
  } catch {
    return initial;
  }
}

pack.addNetworkDomain(MIDDLEWARE_HOSTNAME);

pack.setSystemAuthentication({
  type: coda.AuthenticationType.CustomHeaderToken,
  headerName: "X-Agent-Key",
});

pack.setChatSkill({
  name: "AICodingAssistant",
  displayName: "AI Coding Assistant",
  description:
    "An AI coding assistant that builds and edits code in a live Sandcastle sandbox.",
  prompt: `
You are an AI coding assistant with live cloud sandboxes. You execute code,
run commands, build apps, and manage files in a real Linux environment.

## Your sandbox state

You keep ONE sandbox selected at a time, but the user may ask you to search
their owned sandboxes and switch back into an older one.

Track these values across the conversation:
- **Project name**: a short human-readable label you assign
- **SandboxId**: the human-visible sandbox id from tool results (starts with "sb_")
- **SandboxToken**: the opaque control token from tool results
- **TemplateSlug**: the template slug to use when starting a new sandbox, if the user chooses one
- **Pending operation**: if auth is required, remember whether you were trying to
  start a new sandbox, list sandboxes, or resume a specific sandbox by id
- **Pending request**: the original prompt/query for that pending operation

## Tool dispatch — FOLLOW THESE RULES EXACTLY

### Start a brand-new sandbox
If the user asks to build, run, create, execute, install, or do anything that
requires a new coding environment, call **CodeTask** with their request.
If the user named a template or selected one earlier, pass **TemplateSlug** too.
CodeTask starts the task immediately. It may finish very fast work inline, but
it usually returns an async acknowledgement plus a browser SandboxUrl where the
user can follow progress live.

If the user asks you to inspect, audit, diagnose, or summarize a webpage or URL
and wants a rendered HTML report, prefer TemplateSlug = **webpage-inspector**.
That template already includes scripts and a live report preview server for this workflow.

### List available templates
If the user asks what templates exist, which starter to use, or wants to choose
between sandbox setups, call **ListTemplates** and present the results showing
Name, Slug, OwnerType, Summary, SourceKind, and DefaultRuntime.
If the user asks for their custom templates or templates they created, set
IncludeOwned to true. If they already pasted a connector code, pass it as
AuthCode too.

### Continue the currently selected sandbox
If you already have a SandboxToken for the currently selected sandbox and the
user asks for more coding work in that same sandbox, call **ContinueSandbox**
with the SandboxToken and the new prompt.

### Search or list owned sandboxes
If the user asks "what sandboxes do I have?", "show active sandboxes",
"find my auth sandbox", or asks you to locate a sandbox by id/name/prompt,
call **ListSandboxes**.
- Pass the user's words as Query when useful
- Leave IncludeStopped false unless the user explicitly asks for stopped sandboxes
- Present the results as a short list showing SandboxId, TemplateName, Status,
  LatestPrompt, and UpdatedAt

### Resume work in a specific sandbox by id
If the user names a specific SandboxId and wants to start coding in it, call
**ResumeSandbox** with that SandboxId and the new prompt. Use this even if you
previously listed sandboxes; ResumeSandbox is the authoritative "jump back in"
tool for a user-provided sandbox id.

### User asks for status, progress, history, or logs
If you have a currently selected SandboxToken, call **GetSandboxStatus** with it.
Use the response to summarize the latest task state, always share SandboxUrl so
the user can watch the full browser console, and include ConsoleTail in a fenced
\`text\` block when it is present.

If the user asks for the status of a sandbox by SandboxId and you do NOT have
it currently selected, first call **ListSandboxes** with Query set to that
SandboxId. If you get exactly one matching sandbox, use its SandboxToken with
GetSandboxStatus.

### User asks about a specific task by TaskId
Call **CheckTask** with the TaskId. This is a one-shot status lookup.

### User asks to see a file
Call **ReadSandboxFile** with the SandboxToken and file path.

### User asks for the preview/live URL
Call **GetSandboxPreview** with the SandboxToken, or reuse PreviewUrl from a
recent status response if one is already present.

### User says "done", "stop", "end sandbox", or similar
Call **StopSandbox** with the SandboxToken to free resources.

## Auth handshake for new sandboxes and sandbox search

If CodeTask, ListTemplates, ListSandboxes, or ResumeSandbox returns ErrorCode =
"auth_required" or "invalid_auth_code":
- tell the user to open AuthUrl
- tell them to sign in with GitHub
- tell them to copy the three-word connector code shown on the Sandcastle website and paste it here
- keep the original Pending operation and its inputs
- do not pretend the sandbox request succeeded

If there is a Pending operation and the user sends a three-word code or says
they completed auth:
- retry the SAME tool that needed auth
- pass the pasted three-word connector code as AuthCode
- keep all the original prompt/query/sandbox id/template slug inputs the same

## CRITICAL: Field names are PascalCase

Task results:
TaskId, SandboxId, SandboxToken, TemplateSlug, TemplateName, Status, Phase, PhaseDetail, IsComplete,
CreatedAt, UpdatedAt, CompletedAt, LastLogAt, Result, PreviewUrl, PreviewStatus,
PreviewHint, ConsoleTail, SandboxUrl, AuthUrl, ErrorCode, Error

Sandbox list results:
Sandboxes, Templates, AuthUrl, ErrorCode, Error

Template list results:
Templates, DefaultTemplateSlug, AuthUrl, ErrorCode, Error

## When you present results

- If ErrorCode is "auth_required" or "invalid_auth_code": tell the user to open
  AuthUrl, sign in with GitHub, copy the three-word connector code, and paste
  it back into chat. Do not imply the sandbox request succeeded.
- If ErrorCode is "sandbox_busy": tell the user the sandbox is already handling
  another task, share SandboxUrl, summarize the current Phase, and include
  RecoveryHint if present.
- If ErrorCode is "sandbox_stopped": tell the user that sandbox has ended and
  they should start a new sandbox or resume another active one.
- If ErrorCode is "task_not_found": tell the user the task token is stale and
  fall back to GetSandboxStatus if a SandboxToken is available.
- If Status is Accepted or Running: confirm the task started, share SandboxId and
  SandboxUrl, mention TemplateName when present, summarize Phase and PhaseDetail,
  mention PreviewStatus if useful, share PreviewUrl if present, and tell the user
  they can keep chatting with you for updates while the browser console stays live
- If ConsoleTail is present for a status/progress request: include it in a
  fenced \`text\` block
- If Status is Complete: summarize what was built or changed
- Show key code in fenced code blocks (specify language) when Result is present
- If PreviewUrl is set, share it as a clickable link
- If SandboxUrl is set, share it as the main browser console
- If ListSandboxes returns results, show the sandbox ids clearly so the user can
  pick one and tell you which sandbox to continue
- If ListTemplates returns results, recommend the most suitable template briefly,
  show whether each one is system or user-owned when helpful, and show the exact
  template slug the user can ask for
- If Error is set, explain what went wrong
- If RecoveryHint is present, include it
- Always remind the user they can ask for more changes

## When NOT to use tools

Only skip tools for purely conceptual questions with zero execution component,
like "What is a REST API?" or "Explain async/await."
Everything else -> use the tools. When in doubt, USE THE TOOLS.
  `,
  tools: [{ type: coda.ToolType.Pack }],
});

pack.setBenchInitializationSkill({
  name: "Welcome",
  displayName: "Welcome",
  description: "Welcome the user when they open the agent.",
  prompt: `
Greet the user briefly. Tell them you can help build software in a live
Sandcastle sandbox. Give 2-3 example prompts they could try:
- "Build a Next.js landing page with a hero section"
- "Show my active sandboxes"
- "Inspect https://news.ycombinator.com and render an HTML report"
Keep it to 2-3 sentences total.
  `,
  tools: [],
});

pack.addFormula({
  name: "CodeTask",
  description:
    "Create a new coding sandbox and start a task. Returns a browser sandbox URL immediately for long-running work.",
  instructions: `
Creates a brand-new sandbox and starts the task immediately. For very fast
tasks, it may return a completed result. Otherwise it returns an async
acknowledgement with Status, SandboxUrl, SandboxId, and the latest TaskId.
ALWAYS save the SandboxToken from the response for follow-up requests.
  `,
  isAction: true,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "prompt",
      description: "What to build, run, or do.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "templateSlug",
      description:
        "Optional template slug, such as standard or shell-scripts-validation.",
      optional: true,
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "authCode",
      description:
        "Optional three-word connector code copied from the Sandcastle Connector page.",
      optional: true,
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TaskResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [prompt, templateSlug, authCode] = args;
    const createBody = await createSandboxTask(
      context,
      prompt,
      templateSlug,
      authCode
    );
    if (
      createBody.errorCode ||
      createBody.status === "failed" ||
      !createBody.taskId ||
      !createBody.sandboxToken
    ) {
      return createBody;
    }
    return await quickCheckTask(context, createBody);
  },
});

pack.addFormula({
  name: "ListTemplates",
  description:
    "List the Sandcastle templates available for new sandbox creation.",
  instructions: `
Use this when the user wants to choose a starting point for a new sandbox.
Show the exact template Slug so the user can ask you to create a sandbox from it.
Set IncludeOwned to true when the user asks for their custom templates. When
IncludeOwned is true, pass AuthCode too if the user has already provided a
three-word connector code.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "authCode",
      description:
        "Optional three-word connector code copied from the Sandcastle Connector page.",
      optional: true,
    }),
    coda.makeParameter({
      type: coda.ParameterType.Boolean,
      name: "includeOwned",
      description:
        "Set to true when the user wants their own custom templates included alongside system templates.",
      optional: true,
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TemplateListResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [authCode, includeOwned] = args;
    return await listTemplates(context, authCode, includeOwned);
  },
});

pack.addFormula({
  name: "ContinueSandbox",
  description:
    "Send a follow-up prompt into an existing sandbox. Returns an immediate acknowledgement for long-running work.",
  instructions: `
Sends a new prompt to a running sandbox. The agent resumes with full context
of previous work. For very fast tasks it may return a completed result.
Otherwise it returns an async acknowledgement with Status, SandboxUrl, SandboxId,
and the latest TaskId. ALWAYS update your saved SandboxToken from the response.
  `,
  isAction: true,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxToken",
      description: "The SandboxToken from a previous CodeTask, ContinueSandbox, or ListSandboxes result.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "prompt",
      description: "The follow-up instruction or question.",
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TaskResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxToken, prompt] = args;
    try {
      const sendResp = await context.fetcher.fetch({
        method: "POST",
        disableAuthentication: true,
        url: apiUrl(`/api/sessions/${encodeURIComponent(sandboxToken)}/prompt`),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      return await quickCheckTask(
        context,
        normalizeTaskResponse(sendResp.body as Partial<TaskResponse>)
      );
    } catch (error) {
      if (coda.StatusCodeError.isStatusCodeError(error)) {
        const statusError = error as coda.StatusCodeError;
        if (typeof statusError.body === "object" && statusError.body) {
          return normalizeTaskResponse(
            statusError.body as Partial<TaskResponse>
          ) as unknown as Record<string, unknown>;
        }
      }

      throw error;
    }
  },
});

pack.addFormula({
  name: "ListSandboxes",
  description:
    "Search owned sandboxes and return the active matches the user can choose from.",
  instructions: `
Lists owned sandboxes for the authenticated website user. Default behavior is
active sandboxes only. Use Query to filter by sandbox id or recent prompt text.
If the user wants stopped sandboxes too, set IncludeStopped to true.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "authCode",
      description:
        "Optional three-word connector code copied from the Sandcastle Connector page.",
      optional: true,
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "query",
      description:
        "Optional search text, such as a sandbox id or a remembered prompt fragment.",
      optional: true,
    }),
    coda.makeParameter({
      type: coda.ParameterType.Boolean,
      name: "includeStopped",
      description: "Whether to include stopped sandboxes in the results.",
      optional: true,
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: SandboxListResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [authCode, query, includeStopped] = args;
    return await listSandboxes(context, authCode, query, includeStopped);
  },
});

pack.addFormula({
  name: "ResumeSandbox",
  description:
    "Resume work in an owned sandbox by sandbox id, even if it is not the currently selected one.",
  instructions: `
Use this when the user gives you a SandboxId and wants to start coding in that
existing sandbox again. This route resolves the sandbox id back into a live
control token and starts the next task immediately.
  `,
  isAction: true,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxId",
      description: "The user-visible sandbox id, such as sb_xxx.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "prompt",
      description: "What to do next in that sandbox.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "authCode",
      description:
        "Optional three-word connector code copied from the Sandcastle Connector page.",
      optional: true,
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TaskResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxId, prompt, authCode] = args;
    const response = await resumeSandboxTask(context, sandboxId, prompt, authCode);
    if (
      response.errorCode ||
      response.status === "failed" ||
      !response.taskId ||
      !response.sandboxToken
    ) {
      return response;
    }
    return await quickCheckTask(context, response);
  },
});

pack.addFormula({
  name: "CheckTask",
  description:
    "Read the latest status for a task without waiting.",
  instructions: `
Reads the latest status for a task exactly once. Use this when you already have
a TaskId and want to know whether that task is still running, complete, failed,
or stopped.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "taskId",
      description: "The TaskId from a previous coding action.",
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TaskResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [taskId] = args;
    return await fetchTaskStatus(context, taskId) as unknown as Record<string, unknown>;
  },
});

pack.addFormula({
  name: "GetSandboxStatus",
  description:
    "Read the latest sandbox status, task phase, recent console tail, browser console URL, and preview URL.",
  instructions: `
Returns the latest overall sandbox status without waiting. Use this when the
user asks for progress, current status, whether the task seems stalled, the
browser sandbox URL, the latest preview URL, or the latest console output.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxToken",
      description: "The SandboxToken from a previous coding action or ListSandboxes result.",
    }),
  ],
  resultType: coda.ValueType.Object,
  schema: TaskResultSchema,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxToken] = args;
    const response = await context.fetcher.fetch({
      method: "GET",
      disableAuthentication: true,
      url: apiUrl(`/api/sessions/${encodeURIComponent(sandboxToken)}/status`, {
        _t: String(Date.now()),
      }),
    });
    return normalizeTaskResponse(
      response.body as Partial<TaskResponse>
    ) as unknown as Record<string, unknown>;
  },
});

pack.addFormula({
  name: "ReadSandboxFile",
  description: "Read a file from the sandbox environment.",
  instructions: `
Returns the contents of a file in the sandbox. Use when the user asks
to see a specific text file. Path should be relative to /vercel/sandbox/
(e.g., "src/index.ts") or absolute (e.g., "/vercel/sandbox/package.json").
Do not use this for binary files, very large files, or internal control files
such as .task-*, .log-*, .result-*, or .shgo-session.json.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxToken",
      description: "The SandboxToken.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "filePath",
      description: "Path to the file inside the sandbox.",
    }),
  ],
  resultType: coda.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxToken, filePath] = args;
    const response = await context.fetcher.fetch({
      method: "GET",
      disableAuthentication: true,
      url: apiUrl(
        `/api/sessions/${encodeURIComponent(sandboxToken)}/file`,
        { path: filePath }
      ),
    });
    return response.body.content;
  },
});

pack.addFormula({
  name: "GetSandboxPreview",
  description: "Get the live preview URL for a sandbox dev server.",
  instructions: `
Returns the public URL where a dev server is running in the sandbox.
Default port is 3000. Only works if a server is actually running.
  `,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxToken",
      description: "The SandboxToken.",
    }),
    coda.makeParameter({
      type: coda.ParameterType.Number,
      name: "port",
      description: "The port number (default 3000).",
      optional: true,
    }),
  ],
  resultType: coda.ValueType.String,
  codaType: coda.ValueHintType.Url,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxToken, port] = args;
    const response = await context.fetcher.fetch({
      method: "GET",
      disableAuthentication: true,
      url: apiUrl(
        `/api/sessions/${encodeURIComponent(sandboxToken)}/preview`,
        { port: String(port || 3000) }
      ),
    });
    return response.body.url;
  },
});

pack.addFormula({
  name: "StopSandbox",
  description: "End the coding sandbox and free resources.",
  instructions: `
Stops the sandbox VM and frees resources. Call when the user says they
are done. The sandbox also auto-stops after ~30 minutes of inactivity.
  `,
  isAction: true,
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "sandboxToken",
      description: "The SandboxToken to end.",
    }),
  ],
  resultType: coda.ValueType.String,
  cacheTtlSecs: 0,
  execute: async function (args, context) {
    const [sandboxToken] = args;
    const response = await context.fetcher.fetch({
      method: "POST",
      disableAuthentication: true,
      url: apiUrl(`/api/sessions/${encodeURIComponent(sandboxToken)}/stop`),
    });
    return response.body.message;
  },
});
