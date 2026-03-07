import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import {
  findCurrentTask,
  reconcileSessionState,
} from "@/lib/session-state";
import { startSandboxFollowUpTask } from "@/lib/sandbox-follow-up";
import { requireWebsiteOwnedSandbox } from "@/lib/website-owned-sandbox";

const MAX_PROMPT_LENGTH = 100_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionKey: string }> }
) {
  const { sessionKey } = await params;
  const owned = await requireWebsiteOwnedSandbox(sessionKey);
  if (!owned.ok) {
    return owned.response;
  }

  let body: { prompt?: string };
  try {
    body = (await req.json()) as { prompt?: string };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return Response.json(
      { error: "Missing or invalid 'prompt' field" },
      { status: 400 }
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
      { status: 413 }
    );
  }

  const { record, session } = owned.context;
  if (!session || record.status === "stopped") {
    return Response.json(
      { error: "Sandbox is no longer available." },
      { status: 410 }
    );
  }

  try {
    const sandbox = await Sandbox.get({ sandboxId: session.sandboxId });
    const state = await reconcileSessionState(sandbox, session);
    const currentTask = findCurrentTask(state);

    if (currentTask) {
      return Response.json(
        {
          error: "Sandbox is already handling another task. Wait for it to finish, then try again.",
          retryAfterMs: 15_000,
          currentTaskId: currentTask.taskId,
        },
        {
          status: 409,
          headers: {
            "Retry-After": "15",
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const task = await startSandboxFollowUpTask(req, session, prompt);
    return Response.json(
      {
        taskId: task.taskId,
        sandboxId: task.sandboxId,
        status: task.status,
      },
      {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("not found") || error.message.includes("ENOENT"))
    ) {
      return Response.json(
        { error: "Sandbox is no longer available." },
        { status: 410 }
      );
    }

    console.error("Failed to send website sandbox prompt:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to send prompt to sandbox",
      },
      { status: 500 }
    );
  }
}
