import type { Metadata } from "next";
import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import { listSandcastleTemplateCatalog } from "@/lib/templates";
import TemplatesCatalog from "./templates-catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Templates — Sandcastle",
  description: "Built-in Sandcastle sandbox templates and rollout status",
};

export default async function TemplatesPage() {
  const user = await requireWebsiteUser("/templates");
  const templates = listSandcastleTemplateCatalog();

  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-header__copy">
          <p className="page-kicker">Templates</p>
          <h1 className="page-title">Sandcastle template catalog</h1>
          <p className="page-subtitle">
            Signed in as @{user.login ?? user.name ?? user.id}. This catalog
            defines the sandbox starting points we are taking into 1.0. Choose
            a live template here before creating a new sandbox.
          </p>
        </div>

        <div className="page-header__actions">
          <Link href="/sandboxes" className="button button--secondary">
            Back to sandboxes
          </Link>
          <Link href="/connector" className="button button--ghost">
            Open Connector
          </Link>
        </div>
      </section>
      <TemplatesCatalog templates={templates} />
    </div>
  );
}
