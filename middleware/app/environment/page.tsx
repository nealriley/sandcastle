import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import PageShell from "@/app/components/page-shell";
import EnvironmentManager from "./environment-manager";
import { listUserEnvironmentVariables } from "@/lib/user-environment";

export const dynamic = "force-dynamic";

export default async function EnvironmentPage() {
  const user = await requireWebsiteUser("/environment");
  const variables = await listUserEnvironmentVariables(user.id);

  return (
    <PageShell
      kicker="Environment"
      title="Saved variables"
      subtitle="Store reusable launch-time environment values and Sandcastle will prefill matching template fields when you launch a sandbox."
      actions={
        <>
          <Link href="/marketplace" className="button button--primary button--small">
            Open marketplace
          </Link>
          <Link href="/profile" className="button button--ghost button--small">
            Profile
          </Link>
        </>
      }
    >
      <EnvironmentManager initialVariables={variables} />
    </PageShell>
  );
}
