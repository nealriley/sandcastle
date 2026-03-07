/**
 * GET /api/tasks/:taskId — Poll task completion status.
 *
 * Strategy: Try to read the result file that the agent runner writes on
 * completion. If the file exists, the task is done. If not, still running.
 *
 * Primary completion still comes from the result file the runner writes.
 * We also reconcile detached command exit state so a runner that exits
 * without producing a result surfaces as an explicit failure.
 */
import { NextRequest } from "next/server";
import { Sandbox } from "@vercel/sandbox";
import { invalidTokenResponse } from "@/lib/auth";
import {
  buildStoppedTaskResponse,
  buildTaskResponse,
} from "@/lib/session-state";
import { getOwnedSession } from "@/lib/session-ownership";
import { decodeSessionToken, decodeTaskToken, encodeTaskToken } from "@/lib/tokens";
import type { TaskResponse } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdParam } = await params;

  let taskData;
  try {
    taskData = decodeTaskToken(taskIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid task token");
  }

  try {
    const sessionData = taskData.session;
    const record = await getOwnedSession(sessionData.sessionKey);
    const sandbox = await Sandbox.get({ sandboxId: sessionData.sandboxId });
    const response = await buildTaskResponse(req, sandbox, sessionData, taskIdParam);
    response.taskId = encodeTaskToken({
      ...taskData,
      session: decodeSessionToken(response.sessionId),
    });
    response.templateSlug = record?.templateSlug ?? null;
    response.templateName = record?.templateName ?? null;

    return Response.json(response, {
      status: response.errorCode === "task_not_found" ? 404 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error) {
      try {
        const sessionData = taskData.session;
        if (error.message.includes("not found") || error.message.includes("ENOENT")) {
          const response = buildStoppedTaskResponse(req, sessionData, taskIdParam);
          const record = await getOwnedSession(sessionData.sessionKey);
          response.templateSlug = record?.templateSlug ?? null;
          response.templateName = record?.templateName ?? null;
          return Response.json(response, {
            headers: { "Cache-Control": "no-store" },
          });
        }
      } catch {
        // Fall through to the generic 500 response below.
      }
    }

    console.error("Failed to check task:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check task status",
      },
      { status: 500 }
    );
  }
}
