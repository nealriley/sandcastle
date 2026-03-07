import {
  DEFAULT_TEMPLATE_SLUG,
  listSandcastleTemplateSummaries,
} from "@/lib/templates";
import type { TemplateListResponse } from "@/lib/types";

export async function GET() {
  const response: TemplateListResponse = {
    templates: listSandcastleTemplateSummaries(),
    defaultTemplateSlug: DEFAULT_TEMPLATE_SLUG,
  };

  return Response.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
