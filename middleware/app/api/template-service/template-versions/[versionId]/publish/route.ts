import { getWebsiteUser } from "@/auth";
import {
  publishUserTemplateVersion,
  TemplateServiceError,
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

export async function POST(
  _req: Request,
  context: { params: Promise<unknown> }
) {
  const user = await getWebsiteUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with GitHub before publishing a template version." },
      { status: 401 }
    );
  }

  const { versionId } = (await context.params) as { versionId: string };

  try {
    const detail = await publishUserTemplateVersion(user.id, versionId);
    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
