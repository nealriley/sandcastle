import { getWebsiteUser } from "@/auth";
import {
  createUserTemplateVersion,
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
      { error: "Sign in with GitHub before creating a template version." },
      { status: 401 }
    );
  }

  const { templateId } = (await context.params) as { templateId: string };

  try {
    const detail = await createUserTemplateVersion(user.id, templateId);
    return Response.json(detail, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
