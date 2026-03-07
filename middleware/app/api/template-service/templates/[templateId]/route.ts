import { getWebsiteUser } from "@/auth";
import {
  getTemplateDetail,
  TemplateServiceError,
  updateUserTemplate,
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

export async function GET(
  _req: Request,
  context: { params: Promise<unknown> }
) {
  const { templateId } = (await context.params) as { templateId: string };

  try {
    const detail = await getTemplateDetail(templateId);
    if (!detail) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }

    const user = await getWebsiteUser();
    if (
      detail.template.ownerType === "user" &&
      detail.template.ownerUserId !== user?.id
    ) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }

    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<unknown> }
) {
  const user = await getWebsiteUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with GitHub before editing a template." },
      { status: 401 }
    );
  }

  const { templateId } = (await context.params) as { templateId: string };

  let body: {
    slug?: string;
    name?: string;
    summary?: string;
    purpose?: string;
    launchLabel?: string;
    status?: "active" | "archived";
  };

  try {
    body = (await req.json()) as {
      slug?: string;
      name?: string;
      summary?: string;
      purpose?: string;
      launchLabel?: string;
      status?: "active" | "archived";
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  try {
    const detail = await updateUserTemplate(user.id, templateId, body);
    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
