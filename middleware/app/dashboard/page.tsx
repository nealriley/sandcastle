import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import { restoreOwnedSandboxSession } from "@/lib/owned-sandbox";
import { listOwnedSessions } from "@/lib/session-ownership";
import PageShell from "@/app/components/page-shell";
import DashboardSessions from "./dashboard-sessions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireWebsiteUser("/dashboard");
  const ownedSandboxes = await listOwnedSessions(user.id);

  const rows = await Promise.all(
    ownedSandboxes.map(async (sandbox) => {
      const restored =
        sandbox.status === "active"
          ? await restoreOwnedSandboxSession(sandbox)
          : null;
      const effectiveStatus =
        sandbox.status === "active" && !restored ? "stopped" : sandbox.status;

      return {
        sessionKey: sandbox.sessionKey,
        sandboxId: sandbox.sandboxId,
        runtime: restored?.runtime ?? sandbox.runtime,
        status: effectiveStatus as "active" | "stopped",
        latestPrompt: sandbox.latestPrompt,
        updatedAt: sandbox.updatedAt,
        settingsHref: `/sandboxes/${encodeURIComponent(sandbox.latestViewToken)}`,
      };
    })
  );

  return (
    <PageShell
      kicker="Dashboard"
      title="Sessions"
      actions={
        <>
          <Link href="/marketplace" className="button button--primary button--small">
            Launch new
          </Link>
          <Link href="/connect" className="button button--ghost button--small">
            Connect
          </Link>
        </>
      }
    >
      <DashboardSessions rows={rows} />
    </PageShell>
  );
}
