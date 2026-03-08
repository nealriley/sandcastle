import type { Metadata } from "next";
import Link from "next/link";
import { requireWebsiteUser } from "@/auth";
import Panel from "@/app/components/panel";
import PageShell from "@/app/components/page-shell";
import { listConnectors } from "@/lib/connectors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connectors — Sandcastle",
  description: "Connect external tools and MCP clients to your Sandcastle account",
};

export default async function ConnectPage() {
  await requireWebsiteUser("/connect");
  const connectors = listConnectors();

  return (
    <PageShell
      kicker="Connectors"
      title="Connect external tools"
      subtitle="Choose how you want to reach your owned Sandcastle sandboxes."
      actions={
        <Link href="/dashboard" className="button button--ghost button--small">
          Back to dashboard
        </Link>
      }
    >
      <div className="connector-grid">
        {connectors.map((connector) => (
          <Panel
            key={connector.slug}
            title={connector.name}
            description={connector.summary}
            actions={
              <span className="status-badge status-badge--neutral">
                {connector.status}
              </span>
            }
            className="connector-card"
          >
            <dl className="key-value-list">
              <div>
                <dt>Auth</dt>
                <dd>{connector.authModel}</dd>
              </div>
            </dl>

            <ul className="connector-card__capabilities">
              {connector.capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>

            <div className="connector-card__footer">
              <Link
                href={connector.detailPath}
                className="button button--primary button--small"
              >
                Open {connector.shortLabel}
              </Link>
            </div>
          </Panel>
        ))}
      </div>
    </PageShell>
  );
}
