import { validateTemplateServiceInternalAuth } from "@/lib/auth";
import {
  resolveTemplateById,
  resolveTemplateBySlug,
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

export async function POST(req: Request) {
  const authError = validateTemplateServiceInternalAuth(req as never);
  if (authError) {
    return authError;
  }

  let body: {
    templateId?: string;
    slug?: string;
    ownerUserId?: string | null;
  };

  try {
    body = (await req.json()) as {
      templateId?: string;
      slug?: string;
      ownerUserId?: string | null;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  try {
    const resolved = body.templateId
      ? await resolveTemplateById(body.templateId)
      : body.slug
        ? await resolveTemplateBySlug(body.slug, body.ownerUserId ?? null)
        : null;

    if (!resolved) {
      return Response.json(
        { error: "Template could not be resolved." },
        { status: 404 }
      );
    }

    return Response.json(resolved, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
