import type { SessionViewResponse, TaskResponse } from "./types.js";

type PresentedTask = Pick<
  TaskResponse,
  "sandboxId" | "sandboxUrl" | "previewUrl" | "logsUrl" | "sessionUrl"
>;

type PresentedSandbox = Pick<
  SessionViewResponse,
  "sandboxId" | "sandboxUrl" | "previewUrl" | "status"
>;

function fallbackUrl(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function buildMcpLaunchPresentation(task: PresentedTask) {
  const followAlongUrl = fallbackUrl(task.sandboxUrl, "not available yet");
  const previewUrl = fallbackUrl(task.previewUrl, "not ready yet");

  return {
    payload: {
      task,
      followAlongUrl: task.sandboxUrl,
      previewUrl: task.previewUrl,
      logsUrl: task.logsUrl,
      sessionUrl: task.sessionUrl,
      note:
        "Use followAlongUrl for the Sandcastle website. sandboxId is an internal identifier, not a browser URL.",
    },
    summary: [
      `Sandcastle follow-along URL: ${followAlongUrl}`,
      `Preview URL: ${previewUrl}`,
      `Sandbox ID: ${task.sandboxId}`,
      "Use the Sandcastle follow-along URL above for the website. Do not turn sandboxId into a browser URL.",
    ].join("\n"),
  };
}

export function buildMcpFollowUpPresentation(task: PresentedTask) {
  const followAlongUrl = fallbackUrl(task.sandboxUrl, "not available yet");
  const previewUrl = fallbackUrl(task.previewUrl, "not ready yet");

  return {
    payload: {
      task,
      followAlongUrl: task.sandboxUrl,
      previewUrl: task.previewUrl,
      logsUrl: task.logsUrl,
      sessionUrl: task.sessionUrl,
      note:
        "Use followAlongUrl for the Sandcastle website and sandcastle_get_sandbox to poll for updated status. sandboxId is an internal identifier, not a browser URL.",
    },
    summary: [
      "Follow-up queued for the existing sandbox.",
      `Sandcastle follow-along URL: ${followAlongUrl}`,
      `Preview URL: ${previewUrl}`,
      `Sandbox ID: ${task.sandboxId}`,
      "Use sandcastle_get_sandbox to check task progress. Do not turn sandboxId into a browser URL.",
    ].join("\n"),
  };
}

export function buildMcpSandboxPresentation(sandbox: PresentedSandbox) {
  const followAlongUrl = fallbackUrl(sandbox.sandboxUrl, "not available yet");
  const previewUrl = fallbackUrl(sandbox.previewUrl, "not ready yet");

  return {
    payload: {
      sandbox,
      followAlongUrl: sandbox.sandboxUrl,
      previewUrl: sandbox.previewUrl,
      note:
        "Use followAlongUrl for the Sandcastle website. sandboxId is an internal identifier, not a browser URL.",
    },
    summary: [
      `Sandcastle follow-along URL: ${followAlongUrl}`,
      `Preview URL: ${previewUrl}`,
      `Sandbox status: ${sandbox.status}`,
      `Sandbox ID: ${sandbox.sandboxId}`,
      "Use the Sandcastle follow-along URL above for the website. Do not turn sandboxId into a browser URL.",
    ].join("\n"),
  };
}
