import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import { restoreOwnedSandboxSession } from "@/lib/owned-sandbox";
import { listOwnedSessions } from "@/lib/session-ownership";
import SandboxesTable, { type SandboxTableRow } from "./sandboxes-table";

export const dynamic = "force-dynamic";

export default async function SandboxesIndexPage() {
  const user = await requireWebsiteUser("/sandboxes");
  const ownedSandboxes = await listOwnedSessions(user.id);

  const rows: SandboxTableRow[] = await Promise.all(
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
        status: effectiveStatus,
        latestPrompt: sandbox.latestPrompt,
        updatedAt: sandbox.updatedAt,
        settingsHref: `/sandboxes/${encodeURIComponent(sandbox.latestViewToken)}`,
      };
    })
  );

  const activeCount = rows.filter((row) => row.status === "active").length;
  const stoppedCount = rows.filter((row) => row.status === "stopped").length;

  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-header__copy">
          <p className="page-kicker">Sandboxes</p>
          <h1 className="page-title">Owned sandboxes</h1>
          <p className="page-subtitle">
            Signed in as @{user.login ?? user.name ?? user.id}. Start a sandbox
            from Sandcastle, or use Connector when SHGO needs to create one for
            you.
          </p>
        </div>

        <div className="page-header__actions">
          <Link href="/templates" className="button button--secondary">
            Browse templates
          </Link>
          <Link href="/connector" className="button button--ghost">
            Open Connector
          </Link>
        </div>
      </section>

      <div className="stat-grid stat-grid--triple">
        <div className="stat-card">
          <div className="stat-card__label">Total</div>
          <div className="stat-card__value">{rows.length}</div>
          <div className="stat-card__detail">All sandboxes owned by this account.</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Active</div>
          <div className="stat-card__value">{activeCount}</div>
          <div className="stat-card__detail">Ready for prompts or live inspection.</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Stopped</div>
          <div className="stat-card__value">{stoppedCount}</div>
          <div className="stat-card__detail">Ended sandboxes kept for historical context.</div>
        </div>
      </div>

      <section className="panel panel--muted">
        <div className="panel__header panel__header--split">
          <div>
            <p className="page-kicker">New sandbox</p>
            <h2 className="panel__title">Create from Templates</h2>
          </div>
          <Link href="/templates" className="button button--primary button--small">
            Choose template
          </Link>
        </div>
        <p className="panel__description">
          Sandcastle now starts new sandboxes from the Templates surface.
          Choose the template first, then launch the sandbox from there.
        </p>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="page-kicker">Inventory</p>
            <h2 className="panel__title">All sandboxes</h2>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            No owned sandboxes yet. Create one here, or start in SHGO after
            generating a phrase from <Link href="/connector">Connector</Link>,
            and it will appear in this table automatically.
          </div>
        ) : (
          <SandboxesTable rows={rows} />
        )}
      </section>
    </div>
  );
}
