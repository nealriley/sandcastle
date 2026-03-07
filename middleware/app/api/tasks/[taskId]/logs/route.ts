import { NextRequest } from "next/server";
import { invalidTokenResponse } from "@/lib/auth";
import { decodeTaskToken } from "@/lib/tokens";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId: taskIdParam } = await params;

  try {
    decodeTaskToken(taskIdParam);
  } catch (error) {
    return invalidTokenResponse(error, "Invalid task token");
  }

  return Response.json(
    {
      error:
        "The legacy task logs endpoint has been retired. Use the Sandcastle sandbox console instead.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
