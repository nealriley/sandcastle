import { validateTemplateServiceInternalAuth } from "@/lib/auth";
import { listTemplateCatalog, TemplateServiceError } from "@/lib/template-service";

function errorResponse(error: unknown): Response {
  if (error instanceof TemplateServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json(
    { error: error instanceof Error ? error.message : "Template request failed." },
    { status: 500 }
  );
}

export async function GET(req: Request) {
  const authError = validateTemplateServiceInternalAuth(req as never);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const ownerUserId = url.searchParams.get("ownerUserId");

  try {
    const response = await listTemplateCatalog(ownerUserId);
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
