import { getWebsiteUser } from "@/auth";
import {
  TemplateServiceError,
  updateUserTemplateVersion,
} from "@/lib/template-service";

function errorResponse(error: unknown): Response {
  if (error instanceof TemplateServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json(
    { error: error instanceof Error ? error.message : "Template request failed." },
    { status: 500 }
  );
}

export async function PATCH(
  req: Request,
  context: { params: Promise<unknown> }
) {
  const user = await getWebsiteUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with GitHub before editing a template version." },
      { status: 401 }
    );
  }

  const { versionId } = (await context.params) as { versionId: string };

  let body: {
    spec?: unknown;
    changelog?: string | null;
  };
  try {
    body = (await req.json()) as {
      spec?: unknown;
      changelog?: string | null;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  try {
    const detail = await updateUserTemplateVersion(user.id, versionId, body);
    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
