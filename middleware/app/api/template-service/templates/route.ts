import { getWebsiteUser } from "@/auth";
import {
  createUserTemplate,
  TemplateServiceError,
  listTemplateCatalog,
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

export async function GET() {
  try {
    const user = await getWebsiteUser();
    const response = await listTemplateCatalog(user?.id ?? null);
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  const user = await getWebsiteUser();
  if (!user) {
    return Response.json(
      { error: "Sign in with GitHub before creating a template." },
      { status: 401 }
    );
  }

  let body: {
    slug?: string;
    name?: string;
    summary?: string;
    purpose?: string;
    launchLabel?: string;
    spec?: unknown;
  };

  try {
    body = (await req.json()) as {
      slug?: string;
      name?: string;
      summary?: string;
      purpose?: string;
      launchLabel?: string;
      spec?: unknown;
    };
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 }
    );
  }

  try {
    const response = await createUserTemplate({
      ownerUserId: user.id,
      slug: body.slug ?? "",
      name: body.name ?? "",
      summary: body.summary ?? "",
      purpose: body.purpose ?? "",
      launchLabel: body.launchLabel,
      spec: body.spec,
    });

    return Response.json(response, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
