import type { Metadata } from "next";
import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import { listTemplateCatalog } from "@/lib/template-service";
import { listUserEnvironmentVariables } from "@/lib/user-environment";
import PageShell from "@/app/components/page-shell";
import MarketplaceGrid from "./marketplace-grid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Marketplace — Sandcastle",
  description: "Browse and launch AI agent templates",
};

export default async function MarketplacePage() {
  const user = await requireWebsiteUser("/marketplace");
  const [templates, storedEnvironment] = await Promise.all([
    listTemplateCatalog(user.id),
    listUserEnvironmentVariables(user.id),
  ]);

  return (
    <PageShell
      kicker="Marketplace"
      title="Agent templates"
      subtitle="Choose a template and launch a sandbox."
      actions={
        <Link href="/dashboard" className="button button--ghost button--small">
          Back to dashboard
        </Link>
      }
    >
      <MarketplaceGrid
        templates={templates.templates}
        storedEnvironment={storedEnvironment}
      />
    </PageShell>
  );
}
